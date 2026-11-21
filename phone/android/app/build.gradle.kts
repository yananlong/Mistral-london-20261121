// Minimal test host for :ministral. Runs on the Pixel 9a or an arm64 emulator (Apple Silicon Mac).
// AGP 9 compiles Kotlin itself, so do NOT apply org.jetbrains.kotlin.android here.
plugins {
    id("com.android.application")
}

android {
    namespace = "com.mistral.london.ministral.demo"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.mistral.london.ministral.demo"
        minSdk = 31
        targetSdk = 37
        versionCode = 1
        versionName = "0.1"
        ndk { abiFilters += "arm64-v8a" }   // :ministral is arm64-only
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        jniLibs { useLegacyPackaging = false }   // keep .so uncompressed and page-aligned in the APK
    }
}

dependencies {
    implementation(project(":ministral"))
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
}
