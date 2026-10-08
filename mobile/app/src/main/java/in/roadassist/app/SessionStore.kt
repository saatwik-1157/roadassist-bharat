package `in`.roadassist.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.core.content.edit
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The session on disk, encrypted with a key that never leaves the Android
 * Keystore.
 *
 * The app's existing preferences ("roadassist", "ra.ui") are plain XML, so
 * they are not a place for a bearer token. EncryptedSharedPreferences would be
 * a new dependency (and is deprecated); the platform Keystore does the same job
 * here in a few lines: AES-256-GCM, the key generated inside the Keystore and
 * not exportable, the ciphertext in its own preferences file. allowBackup is
 * already off, and the key would not restore on another phone anyway, so a
 * copied preferences file is useless off this device.
 *
 * Nothing here logs, and nothing logs a token anywhere in the app. Any failure
 * to read (a key lost to a "clear credentials", a corrupted file) wipes the
 * stored copy and reads as signed out; it never crashes a launch.
 */
object SessionStore {
    private const val PREFS = "ra.session"
    private const val KEY = "session"
    private const val ALIAS = "ra.session.v1"
    private const val TRANSFORM = "AES/GCM/NoPadding"

    private val lock = Any()

    fun load(ctx: Context): StoredSession? = synchronized(lock) {
        val blob = prefs(ctx).getString(KEY, null) ?: return null
        val parts = SessionCodec.unpack(blob)
        val text = parts?.let { (iv, ct) ->
            try {
                val c = Cipher.getInstance(TRANSFORM)
                c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
                String(c.doFinal(ct), Charsets.UTF_8)
            } catch (_: Exception) { null }
        }
        val s = SessionCodec.decode(text)
        if (s == null) prefs(ctx).edit { remove(KEY) }
        s
    }

    /** Write the session, or remove it when [s] is null (sign-out, session lost). */
    fun save(ctx: Context, s: StoredSession?) = synchronized(lock) {
        if (s == null) {
            prefs(ctx).edit { remove(KEY) }
            return@synchronized
        }
        try {
            val c = Cipher.getInstance(TRANSFORM)
            c.init(Cipher.ENCRYPT_MODE, key())
            val ct = c.doFinal(SessionCodec.encode(s).toByteArray(Charsets.UTF_8))
            prefs(ctx).edit { putString(KEY, SessionCodec.pack(c.iv, ct)) }
        } catch (_: Exception) {
            // No Keystore (a broken ROM): keep the session in memory only, as
            // before, rather than writing a token in the clear.
            prefs(ctx).edit { remove(KEY) }
        }
    }

    /** Merge the display profile into whatever is stored now, atomically (SessionVault). */
    fun saveProfile(ctx: Context, msisdn: String?, vehicleId: String?, vehicleLabel: String?) =
        vault(ctx).saveProfile(msisdn, vehicleId, vehicleLabel)

    /** New tokens from Api (null: signed out), keeping the stored profile, atomically (SessionVault). */
    fun saveTokens(ctx: Context, s: StoredSession?) = vault(ctx).saveTokens(s)

    // load and save take the same lock, which is reentrant.
    private fun vault(ctx: Context) = SessionVault(lock, read = { load(ctx) }, write = { save(ctx, it) })

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }
}
