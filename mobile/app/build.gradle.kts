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
    // WindowCompat — flips the status/navigation-bar icon polarity when the
    // in-app light/dark toggle changes. AndroidX, not a third-party library.
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    // Installs src/main/baseline-prof.txt into ART on first run, so the hot
    // startup and scroll paths are compiled ahead of time instead of being
    // interpreted until the JIT catches up. AndroidX, not a third-party library.
    implementation("androidx.profileinstaller:profileinstaller:1.4.1")
}
