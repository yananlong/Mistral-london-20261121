# UNCOMPILED. Written on Linux without cmake or an NDK; expect to fix typos on first configure.
# Builds llama.cpp b12606 (commit e412c6f468b7b9e0f16f2540244236f8ad68e9ae) CPU-only for arm64-v8a
# and our JNI library `ministral_jni`.
cmake_minimum_required(VERSION 3.22.1)
project(ministral_jni LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 11)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

if(NOT ANDROID_ABI STREQUAL "arm64-v8a")
    message(FATAL_ERROR "ministral_jni supports arm64-v8a only (got '${ANDROID_ABI}'). Set abiFilters to arm64-v8a.")
endif()

# ---- llama.cpp source -------------------------------------------------------
# Option A (default): FetchContent pinned to the commit (needs internet at build time, on the dev machine).
# Option B: -DLLAMA_CPP_SOURCE_DIR=/path/to/llama.cpp (a git submodule checked out at the same commit).
set(LLAMA_CPP_TAG    "b12606" CACHE STRING "informational tag")
set(LLAMA_CPP_COMMIT "e412c6f468b7b9e0f16f2540244236f8ad68e9ae" CACHE STRING "pinned commit of tag b12606")
set(LLAMA_CPP_SOURCE_DIR "" CACHE PATH "use a local checkout instead of FetchContent")

# ---- ggml / llama options ---------------------------------------------------
# Verified against b12606 CMake files: GGML_CPU_KLEIDIAI (default OFF), GGML_CPU_REPACK (ON),
# GGML_CPU_ARM_ARCH (CACHE STRING, appended as -march=), GGML_OPENMP (ON), GGML_LLAMAFILE, GGML_NATIVE.
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)          # static llama/ggml/mtmd linked into one .so
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)                # required when cross-compiling (docs/android.md)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)             # not supported on Android
set(GGML_OPENCL OFF CACHE BOOL "" FORCE)                # Adreno only; Pixel 9a has Mali
set(GGML_VULKAN OFF CACHE BOOL "" FORCE)                # unproven on Mali-G715; CPU only
set(GGML_METAL OFF CACHE BOOL "" FORCE)
set(GGML_CPU_REPACK ON CACHE BOOL "" FORCE)             # Q4_0 -> interleaved layout at load; automatic

# i8mm + dotprod are in every Tensor G4 core (Armv9.2). SVE is deliberately not enabled.
# If a device lacks i8mm the process dies with SIGILL: this build is for the Pixel 9a only.
set(GGML_CPU_ARM_ARCH "armv8.6-a+i8mm+dotprod+fp16" CACHE STRING "" FORCE)

# KleidiAI: A/B item (see DESIGN_PIXEL9A.md test plan). Runtime-dispatches dotprod/i8mm on this phone.
option(MINISTRAL_KLEIDIAI "enable GGML_CPU_KLEIDIAI" ON)
set(GGML_CPU_KLEIDIAI ${MINISTRAL_KLEIDIAI} CACHE BOOL "" FORCE)
# KleidiAI is downloaded at configure time as a pinned archive by ggml. For an offline dev box see README.

# OpenMP: off by default (docs/android.md); we use an explicit ggml threadpool with a core mask.
option(MINISTRAL_OPENMP "enable GGML_OPENMP (A/B only)" OFF)
set(GGML_OPENMP ${MINISTRAL_OPENMP} CACHE BOOL "" FORCE)

set(LLAMA_CURL OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)         # NOTE: if tools/ refuses to configure without common, set ON
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
# The `mtmd` library is added by tools/CMakeLists.txt (always, when tools are added), so tools must be ON.
# EXCLUDE_FROM_ALL below keeps the other tools from compiling unless we depend on them.
set(LLAMA_BUILD_TOOLS ON CACHE BOOL "" FORCE)
set(MTMD_VIDEO OFF CACHE BOOL "" FORCE)                 # needs an ffmpeg binary in PATH

if(LLAMA_CPP_SOURCE_DIR)
    add_subdirectory(${LLAMA_CPP_SOURCE_DIR} ${CMAKE_BINARY_DIR}/llama.cpp EXCLUDE_FROM_ALL)
    set(LLAMA_SRC_ROOT ${LLAMA_CPP_SOURCE_DIR})
else()
    include(FetchContent)
    FetchContent_Declare(llama_cpp
        GIT_REPOSITORY https://github.com/ggml-org/llama.cpp.git
        GIT_TAG        ${LLAMA_CPP_COMMIT}
        GIT_SHALLOW    FALSE)            # shallow clone of a bare commit hash is not reliable
    FetchContent_GetProperties(llama_cpp)
    if(NOT llama_cpp_POPULATED)
        FetchContent_Populate(llama_cpp)
        add_subdirectory(${llama_cpp_SOURCE_DIR} ${llama_cpp_BINARY_DIR} EXCLUDE_FROM_ALL)
    endif()
    set(LLAMA_SRC_ROOT ${llama_cpp_SOURCE_DIR})
endif()

# ---- JNI library ------------------------------------------------------------
add_library(ministral_jni SHARED ministral_jni.cpp)
target_include_directories(ministral_jni PRIVATE
    ${LLAMA_SRC_ROOT}/include
    ${LLAMA_SRC_ROOT}/ggml/include
    ${LLAMA_SRC_ROOT}/tools/mtmd)
target_link_libraries(ministral_jni PRIVATE llama mtmd ggml android log)
target_compile_options(ministral_jni PRIVATE -O2 -fvisibility=hidden)
# Keep JNI symbols visible (they are marked JNIEXPORT in the source).
set_target_properties(ministral_jni PROPERTIES LINK_FLAGS "-Wl,--gc-sections -Wl,-z,max-page-size=16384")
# 16 KB page alignment: required for new Android targets, harmless on the Pixel 9a (4 KB pages).
