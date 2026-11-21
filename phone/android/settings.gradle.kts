// Standalone build of the :ministral library, for compile checks and the benchmark.
// In the React Native app or bitchat-android, include the module instead:
//   include(":ministral"); project(":ministral").projectDir = file("<path>/phone/android/ministral")
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "ministral-android"
include(":ministral")
include(":app")   // minimal test host: load the model, run a prompt or EngineBenchmark (emulator or Pixel)
