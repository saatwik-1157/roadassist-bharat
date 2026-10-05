# RoadAssist Bharat 1.0.5 — installing the Android app

| File | What it is |
|---|---|
| `RoadAssist-Bharat-1.0.5.apk` | The app, ready to install on a phone (Android 8.0 / API 26 or newer). |
| `RoadAssist-Bharat-1.0.5.aab` | The same build as an Android App Bundle, the format Google Play takes. It cannot be installed on a phone directly. |

Both are built from `mobile/` with `gradlew.bat :app:assembleRelease :app:bundleRelease`,
version 1.0.5 (versionCode 7), package `in.roadassist.app`, and signed with the
RoadAssist Bharat release key (certificate `CN=RoadAssist Bharat, OU=SWE4004,
O=VIT-AP University, C=IN`, APK Signature Scheme v2 + v3). The binaries are not
in git; rebuild them from source or take them from whoever holds this folder.

**What changed in 1.0.5.** The "Emergency open" card on Home said "Responders
have been alerted" for every escalated SOS, although the server only locates
the nearest unit and contacts none. It now says so only when the server reports
a responder was notified; otherwise it reads "Escalated — no responder has been
contacted. Call 112 if you need help now." A confirmed but not yet escalated
SOS no longer says contacts and responders are being alerted, and closing one
("I'm safe") no longer says responders will stop working on it: it says it
closes the emergency on the server.

This release build talks HTTPS only: it refuses plain `http://` server addresses
(the More → Server field says so). Pointing the app at a local development API
needs a debug build; see ENGINEERING-NOTES.md, "Reaching the API from the Android client".

> **This is a student demo, not a service for real emergencies.** The app talks
> to the live demo server at `https://app.roadassistbharat.online`. Sign-in uses
> a one-time code; on this demo server the code is shown on screen and filled
> in for you, so anyone with a number can sign in as it. Do not put real
> personal data in it, and in a real emergency call **112** directly. No real
> emergency dispatch is connected, and the SOS SMS number is a placeholder.

## 1. Install the APK on a phone

1. Copy `RoadAssist-Bharat-1.0.5.apk` to the phone (USB cable, Google Drive,
   a messaging app sent to yourself, or a download link).
2. Allow the app you will open it with to install apps. Android asks the first
   time: tap **Settings** on the prompt, then turn on **Allow from this source**
   for that app (Files / Files by Google, Chrome, Drive, …). The menu path is
   usually **Settings → Apps → Special app access → Install unknown apps**.
   You can turn it off again after installing.
3. Open the APK from that app and tap **Install**.
4. **Google Play Protect** may warn that the app is from an unknown developer
   or was not scanned. That is expected for an app that is not on Play: the
   developer has not registered with Google. Choose **More details → Install
   anyway** (wording varies by phone). If Play Protect offers to scan it, let it.
5. Open **RoadAssist**. It starts on the sign-in screen.

### Permissions it asks for, and why

The app asks at the moment a feature needs a permission, never all at once at
start-up. Each one can be refused; the app keeps working without it.

| Permission | When it is asked | What happens if you refuse |
|---|---|---|
| **Location** (precise) | When you arm SOS, report a road hazard, or book a mechanic | An SOS is still raised, marked "location unknown", and tells you to give 112 your position. A booking or hazard report is not sent at all rather than sent from a made-up place. |
| **SMS** (send) | When you arm SOS | SOS cannot fall back to a text message when there is no data. The fallback SMS number is a placeholder in this demo. |
| Phone calls | Never requested | "Call 112" and the helpline numbers open your dialer with the number filled in; you press call yourself. |
| Internet / network state | Granted at install, no prompt | — |

## 2. Updating

Install a newer `RoadAssist-Bharat-x.y.z.apk` over the old one the same way.
Android only accepts the update if it is signed with the **same release key**
and has a **higher versionCode**, so:

- Updates keep your sign-in and settings. Do not uninstall first unless told to.
- An APK signed with a different key (for example a debug build from Android
  Studio) will be refused with "App not installed" / "package conflicts". Only
  then uninstall the old app first, which clears its data.
- The release key is kept outside the repository, in
  `S:\PROJECTS\RoadAssist-Bharat-signing\` (see the README there). If it is
  lost, this app can never be updated in place again.

## 3. Publishing on Google Play later (with the AAB)

Play takes the `.aab`, not the `.apk`.

1. **Create a Google Play Console developer account** at
   <https://play.google.com/console>. This costs a one-time **US$25** fee and
   needs identity verification. It has to be done by the project owner; it is
   not something the build can do.
2. Create the app in Play Console (name, default language, free/paid).
3. Keep **Play App Signing** on (the default). The key in
   `RoadAssist-Bharat-signing` then becomes your *upload key*: Google re-signs
   the app for users, and a lost upload key can be reset through Play support.
4. Fill in the store listing, the content rating questionnaire, the target
   audience, and the **Data safety** form (the app sends phone number, location
   and hazard photos to the server). A privacy policy URL is required.
5. **SMS permission:** Google Play restricts `SEND_SMS` to apps whose core
   function needs it and requires a Permissions Declaration form. Check the
   current "SMS and Call Log permissions" policy before submitting; if the
   declaration is not accepted, the SMS fallback has to be removed from the
   Play build.
6. Upload `RoadAssist-Bharat-1.0.5.aab` to an **Internal testing** track first,
   add testers by email, and install from the opt-in link. New personal
   developer accounts must also run a closed test with testers for a period
   before production access is granted; follow what Play Console asks for.
7. Every later upload needs a higher `versionCode` in `mobile/app/build.gradle.kts`.

## 4. Checking a file before you share it

```
apksigner verify --print-certs RoadAssist-Bharat-1.0.5.apk
```

(`apksigner` is in the Android SDK under `build-tools\<version>\`.) It must say
`Verifies` and show the `CN=RoadAssist Bharat, OU=SWE4004, O=VIT-AP University, C=IN`
certificate. Compare the SHA-256 of the file with the one published alongside it
(`certutil -hashfile RoadAssist-Bharat-1.0.5.apk SHA256` on Windows).
