plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "in.roadassist.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "in.roadassist.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
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
            // Signed with the debug key so the fast build is installable on a
            // demo device without provisioning a keystore. This is NOT a
            // distribution build — publishing needs a real signing config.
            signingConfig = signingConfigs.getByName("debug")
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
