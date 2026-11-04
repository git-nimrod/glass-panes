plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.nimrod.mirrorkiosk"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.nimrod.mirrorkiosk"
        minSdk = 23          // the mirror runs Android 6.0.1 (API 23)
        targetSdk = 23       // keeps old-Android behavior: permissions granted at install, plain HTTP allowed
        // The app's version is its OWN, separate from the Home Assistant integration's (see CONTRIBUTING.md). Raise it only when the
        // app's code changes. versionCode must ALWAYS go up (Android refuses to install a lower one over a higher one).
        versionCode = 1004
        versionName = "0.10.4"
        ndk { abiFilters += listOf("arm64-v8a") }   // the mirror's CPU; we only ship the 64-bit engine
    }

    // A release build normally runs Android's "lint" safety check first. With this project's mix of the Android Gradle Plugin and
    // GeckoView's newer Kotlin, the lint tool itself crashes (IncompatibleClassChangeError in its own code), which stopped the
    // first signed release. The app is small and CI compiles it on every push, so the release lint check is switched off.
    lint {
        checkReleaseBuilds = false
    }

    // Release signing. The key is NEVER in git: CI restores it from a GitHub secret and passes its location and passwords in
    // through these environment variables. Without them (a normal build on your own computer) no release key is used.
    signingConfigs {
        create("release") {
            val keystorePath = System.getenv("GP_KEYSTORE_FILE")
            if (keystorePath != null && file(keystorePath).exists()) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("GP_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("GP_KEY_ALIAS")
                keyPassword = System.getenv("GP_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release").takeIf { it.storeFile != null }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    packaging {
        // Firefox's own APK ships its native libraries extracted; do the same.
        jniLibs { useLegacyPackaging = true }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        // GeckoView is built with a newer Kotlin than some toolchains read; tolerate the newer metadata.
        freeCompilerArgs.add("-Xskip-metadata-version-check")
    }
}

dependencies {
    // Firefox 143's engine, 64-bit ARM only (same engine as the Firefox 143 that already runs on the mirror)
    implementation("org.mozilla.geckoview:geckoview-arm64-v8a:143.0.20251003115653")
}
