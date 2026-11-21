// UNBUILT. Written without an Android SDK, so check it on the first sync.
// Toolchain matches bitchat-android (AGP 9.3.1, Gradle 9.6.1, compileSdk 37). AGP 9 compiles Kotlin itself,
// so do NOT apply org.jetbrains.kotlin.android here.
plugins {
    id("com.android.library")
}

android {
    namespace = "com.mistral.london.ministral"
    compileSdk = 37
    // ndkVersion: leave unset to use AGP's default NDK. If you pin one, NDK r28+ aligns .so files to 16 KB by default;
    // CMakeLists.txt also passes -z max-page-size=16384.

    defaultConfig {
        minSdk = 31                                   // createOnDeviceSpeechRecognizer
        ndk {
            abiFilters += "arm64-v8a"                 // CMakeLists.txt refuses other ABIs
            // Emulator testing: -PministralEmulator=true builds arm64 without i8mm (Apple Silicon emulator);
            // -PministralEmulator=x86_64 also builds x86_64 (Intel host). Both pass -DMINISTRAL_EMULATOR=ON below.
            if (project.findProperty("ministralEmulator") == "x86_64") abiFilters += "x86_64"
        }
        externalNativeBuild {
            cmake {
                // Force optimized ggml/llama even in the debug variant: AGP's Debug build type is -O0, and llama.cpp
                // runs several times slower at -O0. CMakeLists.txt only sets -O2 on the JNI file itself.
                arguments += listOf("-DANDROID_STL=c++_shared", "-DCMAKE_BUILD_TYPE=Release")
                if (project.hasProperty("ministralEmulator")) arguments += "-DMINISTRAL_EMULATOR=ON"
                // Offline llama.cpp checkout instead of FetchContent (README "Build" step 2):
                // arguments += "-DLLAMA_CPP_SOURCE_DIR=/abs/path/to/llama.cpp"
                // KleidiAI A/B (DESIGN_PIXEL9A.md): arguments += "-DMINISTRAL_KLEIDIAI=OFF"
            }
        }
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            // Native code is built Release in both variants (see the cmake arguments above).
            isMinifyEnabled = false
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"                        // any installed CMake >= 3.22.1
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0") // same version as bitchat-android
}
