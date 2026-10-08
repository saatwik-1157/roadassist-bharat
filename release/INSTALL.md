# RoadAssist Bharat 1.1.1 — installing the Android app

| File | What it is |
|---|---|
| `RoadAssist-Bharat-1.1.1.apk` | The app, ready to install on any phone (Android 8.0 / API 26 or newer). 50.3 MB: it carries the on-device detector for three CPU types. |
| `RoadAssist-Bharat-1.1.1-arm64-v8a.apk` | The same build for 64-bit ARM only (most phones of recent years). 24.6 MB. Use it when you know the phone; it will not install on a 32-bit one. |
| `RoadAssist-Bharat-1.1.1-armeabi-v7a.apk` | The same build for 32-bit ARM only (older and Android Go phones). 23.4 MB. |
| `RoadAssist-Bharat-1.1.1.aab` | The same build as an Android App Bundle, the format Google Play takes. It cannot be installed on a phone directly. Play sends each phone only its own CPU's part. |

All four are built from `mobile/` with
`gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleRelease bundleRelease`
(the per-CPU APKs with `gradlew.bat assembleRelease -PabiSplits`), version 1.1.1
(versionCode 10), package `in.roadassist.app`, and signed with the RoadAssist
Bharat release key (certificate `CN=RoadAssist Bharat, OU=SWE4004, O=VIT-AP
University, C=IN`, SHA-256 `f602bb634f6e5dfc76752aec42ac36bf1a35c081a1f04b545e3ab107dcf84359`,
APK Signature Scheme v2 + v3). The binaries are not in git; rebuild them from
source or take them from whoever holds this folder.

| File | SHA-256 |
|---|---|
| `RoadAssist-Bharat-1.1.1.apk` | `a1647cb2771d2e62acd5b3a077bb9b443f1b29d5d082dce16da4f4df329bdef5` |
| `RoadAssist-Bharat-1.1.1-arm64-v8a.apk` | `646df8d1b1f64e277d01fd1c908ad8bef3d875bdc50a5e72a0efa30711b1a998` |
| `RoadAssist-Bharat-1.1.1-armeabi-v7a.apk` | `f97294f7200f3c20bbc6dfbde14cd467b597e2b63c5005c7927dd1355f3a47f1` |
| `RoadAssist-Bharat-1.1.1.aab` | `1288cc3b81409e00d6ede1df08ecac27004dfe6ccbb0d37213db293702ea0596` |

**What changed in 1.1.1: SOS and session fixes, and a new detector.**

- **SOS from the sign-in screen.** After a restart, a crash or a sign-out the
  app opens on the sign-in screen, and that screen now has the SOS button and
  the emergency numbers too. Signed out, SOS skips the online step and goes
  straight to 112 and the copy saved on the phone.
- **You stay signed in across a restart.** The session is stored on the phone,
  encrypted with a key held in the Android Keystore. Online, it is checked
  with the server once at launch; offline it is trusted. A server error or a
  rate limit while renewing it no longer signs you out; a session the server
  rejects returns you to the sign-in screen with a message.
- **The SOS SMS fallback is off in this build.** It used to text a placeholder
  number and treat a sent text as the end of the SOS. Now there is no SMS
  number until a real one is provisioned (build with `-PraSmsNumber=`), and even
  then a text never ends the SOS: 112 and the saved copy always follow.
- **A saved SOS is sent when the network comes back**, on any screen, while
  the app is running and you are signed in (and at the next launch
  otherwise). One SOS the server refuses no longer holds up the rest, and a
  saved SOS is only sent under the account that raised it.
- **One SOS at a time.** Turning the phone or switching tabs while an SOS is
  being raised no longer re-enables the button, and the result stays on screen.
- **112 from the background.** Android does not let an app open the dialer
  from the background; the app now shows a tap-to-call notification and says
  so instead of claiming the dialer opened.
- **Bookings survive a tab switch** and are not created twice.
- **Detector:** RAKSHA YOLO11n `india-ft-gpu` at 416 px, mAP50 0.516
  (mAP50-95 0.245) on the held-out 4-country validation set (800 images) and
  0.449 (0.195) on a held-out India split (392 images), with
  4 classes: pothole, road damage, faded marking and manhole. Faded markings and
  manholes are shown for information; hazard reports take potholes and road
  damage.
- The SOS, hazard-dialog and Track text is now in all 8 languages (the 7
  non-English ones machine-translated and unreviewed).

**1.1.0: Scan road.** A new Home card, *Scan the road*, opens
an on-device road-damage scanner. It runs the RAKSHA YOLO11n detector
(`yolo11n-multi-edge`, the `ai-weights-v1` release) on the phone with ONNX
Runtime 1.30, over the live camera or over a photo picked from the gallery,
and needs no internet at all. Boxes, class, confidence and severity are drawn
over the picture; the live view shows its frame rate. Every result is labelled
a model prediction, and the screen states the model's measured mAP50 (0.293 on
held-out RDD2022 validation images, from `ai/README.md`). Severity uses the
same box-area rule as `ai/road_damage/severity.py`. *Report hazard* opens the
usual hazard dialog filled in from the detection, with the frame attached as
the photo and the prediction and its confidence written into the note; the
report is sent only when you press Submit, and the app says it was reported
only when the server answered. Hazard reports have no offline queue (only SOS
does): with no connection the dialog says plainly that nothing was sent.

The model, its class list and its input size come from
`mobile/app/src/main/assets/detector/detector.json`, so a newer detector is a
one-file swap. The seven non-English languages of the new screen are
machine-translated and unreviewed, like the rest of the app.

Size: 1.0.6 was a 2.15 MB APK and a 3.94 MB AAB. The detector adds about
9.2 MB of model and about 12 MB of compressed ONNX Runtime per CPU type.

**ONNX Runtime's telemetry is removed.** The ONNX Runtime Android package
declares a component that starts with the app and sends usage telemetry, with
device identifiers, to a Microsoft collector. 1.1.0 removed it from the app's
manifest and switches the runtime's telemetry off, so nothing about the phone
leaves it on the runtime's account. Checked in the built APK's manifest.

1.0.6: the Emergency contacts section and the SOS screens say "logged, not
sent" for SMS and "located, not contacted" for the responder unless the server
reports otherwise. 1.0.5: the "Emergency open" card says "Responders have been
alerted" only when the server reports a responder was notified.

This release build talks HTTPS only: it refuses plain `http://` server addresses
(the More → Server field says so). Pointing the app at a local development API
needs a debug build; see ENGINEERING-NOTES.md, "Reaching the API from the Android client".

> **This is a student demo, not a service for real emergencies.** The app talks
> to the live demo server at `https://app.roadassistbharat.online`. Sign-in uses
> a one-time code; on this demo server the code is shown on screen and filled
> in for you, so anyone with a number can sign in as it. Do not put real
> personal data in it, and in a real emergency call **112** directly. No real
> emergency dispatch is connected, and this build has no SOS SMS number.

## 1. Install the APK on a phone

1. Copy `RoadAssist-Bharat-1.1.1.apk` to the phone (USB cable, Google Drive,
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
5. Open **RoadAssist**. It starts on the sign-in screen, which also has the SOS button and the emergency numbers.

### Permissions it asks for, and why

The app asks at the moment a feature needs a permission, never all at once at
start-up. Each one can be refused; the app keeps working without it.

| Permission | When it is asked | What happens if you refuse |
|---|---|---|
| **Location** (precise) | When you arm SOS, report a road hazard, or book a mechanic | An SOS is still raised, marked "location unknown", and tells you to give 112 your position. A booking or hazard report is not sent at all rather than sent from a made-up place. |
| **SMS** (send) | Not asked in this build (no SOS SMS number is set) | Only a build with a provisioned number asks, when you arm SOS; without it SOS cannot also text RoadAssist. |
| **Notifications** (Android 13+) | When you arm SOS | If SOS runs while the app is in the background, the tap-to-call-112 notification cannot be shown; the result then tells you to call 112 yourself. |
| **Camera** | When you tap *Use camera* in Scan road | The scanner explains why it asked, offers a button to the app's settings, and still works on a photo picked from the gallery. Frames stay on the phone unless you send a hazard report with one attached. |
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
6. Upload `RoadAssist-Bharat-1.1.1.aab` to an **Internal testing** track first,
   add testers by email, and install from the opt-in link. New personal
   developer accounts must also run a closed test with testers for a period
   before production access is granted; follow what Play Console asks for.
7. Every later upload needs a higher `versionCode` in `mobile/app/build.gradle.kts`.

## 4. Checking a file before you share it

```
apksigner verify --print-certs RoadAssist-Bharat-1.1.1.apk
```

(`apksigner` is in the Android SDK under `build-tools\<version>\`.) It must say
`Verifies` and show the `CN=RoadAssist Bharat, OU=SWE4004, O=VIT-AP University, C=IN`
certificate. Compare the SHA-256 of the file with the one published alongside it
(`certutil -hashfile RoadAssist-Bharat-1.1.1.apk SHA256` on Windows).
