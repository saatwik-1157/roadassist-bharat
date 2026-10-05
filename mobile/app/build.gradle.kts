import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// ── release signing ─────────────────────────────────────────────────────────
// The upload/release key lives OUTSIDE the repository, in a properties file
// that names the keystore and its passwords:
//   storeFile=..., storePassword=..., keyAlias=..., keyPassword=...
// Its path is RA_SIGNING_PROPS, or the default folder beside the repo. Neither
// the keystore nor that file is ever committed (.gitignore covers both).
//
// On a machine without it (CI, a classmate's laptop) the release build still
// works, signed with the debug key as before, and says so loudly: an APK
// signed that way installs for a demo but can never be updated by, or
// published as, the real release.
val signingPropsFile = file(
    System.getenv("RA_SIGNING_PROPS")?.takeIf { it.isNotBlank() }
        ?: "S:/PROJECTS/RoadAssist-Bharat-signing/keystore.properties",
)
val signingProps = Properties().apply {
    if (signingPropsFile.isFile) signingPropsFile.inputStream().use { load(it) }
}
val hasReleaseKey = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
    .all { !signingProps.getProperty(it).isNullOrBlank() } &&
    file(signingProps.getProperty("storeFile")).isFile

android {
    namespace = "in.roadassist.app"
    // 36 (Android 16) is the newest platform installed here. Raising the
    // target from 35 changed nothing this app relies on: edge-to-edge was
    // already enforced at 35 and every screen pads for the system bars (the
    // app never used the windowOptOutEdgeToEdgeEnforcement escape that 36
    // removes); predictive back is on by default at 36 and already opted into
    // in the manifest, with no onBackPressed override for it to skip; and no
    // activity locks orientation or resizability, which 36 ignores on large
    // screens. Smoke-tested on an API 36 emulator before it was raised.
    compileSdk = 36

    defaultConfig {
        applicationId = "in.roadassist.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 6
        versionName = "1.0.4"
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(signingProps.getProperty("storeFile"))
                storePassword = signingProps.getProperty("storePassword")
                keyAlias = signingProps.getProperty("keyAlias")
                keyPassword = signingProps.getProperty("keyPassword")
                // v1 for nothing (minSdk 26 verifies v2), v2 + v3 so a future
                // key rotation is possible without a new package name.
                enableV1Signing = false
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            // R8 in optimising mode. This is the single largest smoothness lever
            // available to this app: a debug build runs unoptimised bytecode with
            // Compose's diagnostic paths live, and on this project measured ~25%
            // janky frames against ~4% for the same code built here.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // The real release key when this machine has it (see the top of
            // this file); otherwise the debug key, with a warning, so the
            // build never fails for want of a secret that is not in git.
            signingConfig = if (hasReleaseKey) {
                signingConfigs.getByName("release")
            } else {
                logger.warn(
                    "WARNING: no release signing key at ${signingPropsFile.path} (set RA_SIGNING_PROPS). " +
                        "The release APK/AAB will be signed with the DEBUG key: installable for a demo, " +
                        "NOT release-signed, and not updatable by or publishable as the real release.",
                )
                signingConfigs.getByName("debug")
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }

    lint {
        // An error fails the build. The one that was failing — SEND_SMS without
        // a telephony <uses-feature required="false"> — was a real defect: Play
        // would have treated a radio as mandatory and hidden the app from every
        // tablet, which is the opposite of what this product claims.
        abortOnError = true

        // These three compare our pins against whatever is newest on the day the
        // check runs, so they turn CI red when someone ELSE publishes a release
        // and tell us nothing about this commit. Dependency freshness is a
        // deliberate decision with its own cadence, not a build failure.
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion")

        // CI reads the XML; a human reads the HTML.
        xmlReport = true
        htmlReport = true
    }
}

dependencies {
    // Deliberately lean: AndroidX + Compose only. Networking uses
    // HttpURLConnection and org.json from the platform — zero third-party
    // libraries, so the first build has the fewest possible failure modes.
    val composeBom = platform("androidx.compose:compose-bom:2024.09.03")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")

    // JVM unit tests only — never shipped. JUnit 4 rather than 5 because that is
    // what AGP's testDebugUnitTest task runs without extra wiring, and the tests
    // here need nothing JUnit 5 provides.
    testImplementation("junit:junit:4.13.2")
    // A REAL org.json for unit tests only. The Android SDK's org.json is a stub
    // on the JVM classpath — every method throws "not mocked" — so without this
    // the networking layer cannot be tested off-device at all, which is how a
    // concurrency bug in token rotation went unnoticed. Test-only, exactly like
    // JUnit above; the shipped app still uses the platform's own org.json.
    testImplementation("org.json:json:20240303")
    // WindowCompat — flips the status/navigation-bar icon polarity when the
    // in-app light/dark toggle changes. AndroidX, not a third-party library.
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    // Installs src/main/baseline-prof.txt into ART on first run, so the hot
    // startup and scroll paths are compiled ahead of time instead of being
    // interpreted until the JIT catches up. AndroidX, not a third-party library.
    implementation("androidx.profileinstaller:profileinstaller:1.4.1")
}
