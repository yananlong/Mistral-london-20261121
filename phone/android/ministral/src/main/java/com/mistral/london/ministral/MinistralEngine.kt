// MinistralEngine.kt -- Kotlin API over the JNI engine (llama.cpp b12606, CPU). Mirrors MinistralEngine.swift.
// UNCOMPILED. Written on Linux without Kotlin or the Android SDK; expect to fix typos in Android Studio.
//
// Threading: every native call runs on ONE dedicated thread (single-thread dispatcher). Public API is suspend.
// Cancel and deadline go through llama_set_abort_callback in C++ (CPU only; interrupts prefill and decode).
// Unconfirmed: cancel during the mtmd image-encode phase may only take effect when encoding finishes.
package com.mistral.london.ministral

import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

// ------------------------------------------------------------------ public types

class EngineConfig(
    val profile: EngineProfile,
    /** Directory holding the GGUF files. Prefer app-internal storage (see [ModelFiles.stageToInternal]). */
    val modelDir: File,
    val minHeadroomBytes: Long = 1_200_000_000L,
    /** Streaming SHA-256 of both files (cached by size+mtime). Slow on first launch (~10 s per GB); off by default. */
    val verifySHA256: Boolean = false,
    val useMmap: Boolean = true,
    val pinBigCores: Boolean = true,
) {
    val modelFile get() = File(modelDir, requireNotNull(profile.modelFile) { "speechOnly tier has no model" })
    val mmprojFile get() = profile.mmprojFile?.let { File(modelDir, it) }
}

class GenerationOptions(
    val systemPrompt: String = DEFAULT_SYSTEM_PROMPT,   // always non-empty (the Ministral template wants a system block)
    val maxNewTokens: Int = 256,
    val deadlineSeconds: Double = 45.0,
    val seed: Int = -1,                                  // LLAMA_DEFAULT_SEED (0xFFFFFFFF) = random
) {
    companion object {
        const val DEFAULT_SYSTEM_PROMPT =
            "You are a helpful, concise assistant running offline on a phone. Answer briefly and accurately."
    }
}

enum class StopReason { END_OF_GENERATION, MAX_TOKENS, CONTEXT_FULL, CANCELLED, DEADLINE }

data class Timings(
    val loadSeconds: Double = 0.0,
    val prefillSeconds: Double = 0.0,      // tokenize + image encode + prefill
    val timeToFirstToken: Double = 0.0,    // request start -> first token
    val decodeTokensPerSecond: Double = 0.0,
    val totalSeconds: Double = 0.0,
)

data class GenerationResult(
    val text: String,
    val stopReason: StopReason,
    val promptTokens: Int,                 // text + image
    val imageTokens: Int,
    val generatedTokens: Int,
    val timings: Timings,
    val peakRssBytes: Long,                // VmHWM from /proc/self/status
    val thermalStatus: Int,                // PowerManager.THERMAL_STATUS_*
)

class EngineException(val code: String, message: String) : RuntimeException(message) {
    // Called from JNI ThrowNew(String). Messages look like "E_PREFILL:-3".
    constructor(message: String) : this(message.substringBefore(':'), message)
}

sealed class EngineError(message: String) : RuntimeException(message) {
    class FileMissing(f: String) : EngineError("Model file missing: $f. Push it with adb (see README).")
    class SizeMismatch(f: String, expected: Long, actual: Long) : EngineError("$f: size $actual B, expected ~$expected B (incomplete push?)")
    class ChecksumMismatch(f: String) : EngineError("$f: SHA-256 mismatch")
    class InsufficientMemory(avail: Long, required: Long) : EngineError("Only ${avail / 1_000_000} MB available, need ${required / 1_000_000} MB")
    class ThermalSevere : EngineError("Device is too hot (thermal status SEVERE or worse)")
    class CoolingDown(val secondsLeft: Int) : EngineError("Cooling down, $secondsLeft s left")
    class NotReady : EngineError("Engine not loaded")
    class Busy : EngineError("Another request is running")
    class Backgrounded : EngineError("App is not in the foreground")
    class NoModel : EngineError("speechOnly tier: no model to load")
    class ImageConversion : EngineError("Image conversion failed")
    class Native(val code: String, msg: String) : EngineError(msg)
}

// ------------------------------------------------------------------ JNI surface (names must match ministral_jni.cpp)

/** Result object filled in by C++ via SetXField. Needs a no-arg constructor: all defaults. */
class NativeResult(
    @JvmField var textBytes: ByteArray? = null,
    @JvmField var stopReason: Int = 0,
    @JvmField var promptTokens: Int = 0,
    @JvmField var imageTokens: Int = 0,
    @JvmField var generatedTokens: Int = 0,
    @JvmField var prefillSeconds: Double = 0.0,
    @JvmField var timeToFirstToken: Double = 0.0,
    @JvmField var decodeTokensPerSecond: Double = 0.0,
    @JvmField var totalSeconds: Double = 0.0,
    @JvmField var peakRssBytes: Long = 0,
    @JvmField var rssBytes: Long = 0,
)

/** C++ calls onBytes with UTF-8-complete chunks. Keep this class and method name (ProGuard: -keep). */
class TokenSink(private val f: (String) -> Unit) {
    fun onBytes(bytes: ByteArray) = f(String(bytes, Charsets.UTF_8))
}

object MinistralNative {
    init { System.loadLibrary("ministral_jni") }
    external fun nativeSystemInfo(): String
    external fun nativeLoad(
        modelPath: String, mmprojPath: String?, nCtx: Int, nBatch: Int, nUbatch: Int, kvType: Int, flashAttn: Int,
        imageMaxTokens: Int, warmup: Boolean, nThreads: Int, pin: Boolean, useMmap: Boolean,
    ): Long
    external fun nativeCancel(handle: Long)
    external fun nativeFree(handle: Long)
    external fun nativeProbeEncode(handle: Long, rgb: ByteArray, w: Int, h: Int): DoubleArray
    external fun nativeGenerate(
        handle: Long, system: String, prompt: String, rgb: ByteArray?, w: Int, h: Int, grammar: String?,
        maxNew: Int, deadlineMs: Long, seed: Int, sink: TokenSink,
    ): NativeResult
}

// ------------------------------------------------------------------ model files

object ModelFiles {
    /**
     * Copies the GGUFs that were `adb push`ed to getExternalFilesDir(null) into filesDir/models once.
     * Reason: mmap over the external-storage (FUSE) path may be slower on first touch (unconfirmed).
     * Returns the directory to use as EngineConfig.modelDir.
     */
    fun stageToInternal(context: Context, profile: EngineProfile, onProgress: ((String, Double) -> Unit)? = null): File {
        val dst = File(context.filesDir, "models").apply { mkdirs() }
        val src = context.getExternalFilesDir(null)
        val names = listOfNotNull(profile.modelFile, profile.mmprojFile)
        for (n in names) {
            val out = File(dst, n)
            val inn = if (src != null) File(src, n) else null
            if (inn != null && inn.isFile && (!out.isFile || out.length() != inn.length())) {
                val tmp = File(dst, "$n.part")
                FileInputStream(inn).use { i ->
                    FileOutputStream(tmp).use { o ->
                        val buf = ByteArray(8 shl 20); var done = 0L; val total = inn.length().coerceAtLeast(1)
                        while (true) {
                            val r = i.read(buf); if (r <= 0) break
                            o.write(buf, 0, r); done += r
                            onProgress?.invoke("copying $n", done.toDouble() / total)
                        }
                    }
                }
                if (!tmp.renameTo(out)) throw EngineError.FileMissing(n)
            }
        }
        return dst
    }

    fun sha256(f: File, onProgress: (Double) -> Unit = {}): String {
        val md = MessageDigest.getInstance("SHA-256")
        FileInputStream(f).use { i ->
            val buf = ByteArray(8 shl 20); var done = 0L; val total = f.length().coerceAtLeast(1)
            while (true) {
                val r = i.read(buf); if (r <= 0) break
                md.update(buf, 0, r); done += r; onProgress(done.toDouble() / total)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}

// ------------------------------------------------------------------ engine

class MinistralEngine(private val context: Context, val config: EngineConfig) {
    private val tag = "MinistralEngine"
    private val dispatcher: CoroutineDispatcher = Executors.newSingleThreadExecutor { r ->
        Thread({
            Process.setThreadPriority(Process.THREAD_PRIORITY_FOREGROUND)
            r.run()
        }, "ministral-llama")
    }.asCoroutineDispatcher()

    @Volatile private var handle = 0L           // only mutated on the dispatcher
    @Volatile var loadSeconds = 0.0; private set
    private val busy = AtomicBoolean(false)
    @Volatile private var suspended = false      // true while the Activity is stopped
    private var runsSinceCooldown = 0
    private var cooldownUntilMs = 0L
    private val app = context.applicationContext

    val isReady: Boolean get() = handle != 0L && !suspended

    private val trimCallbacks = object : ComponentCallbacks2 {
        override fun onTrimMemory(level: Int) {
            if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL) {
                Log.w(tag, "onTrimMemory($level): cancelling request")
                cancel()
            }
        }
        override fun onConfigurationChanged(newConfig: Configuration) {}
        @Deprecated("deprecated in API", ReplaceWith("")) override fun onLowMemory() { cancel() }
    }

    init { app.registerComponentCallbacks(trimCallbacks) }

    /**
     * Cancel the request when the Activity stops (screen off, app switched). Equivalent to calling
     * [onStop] from Activity.onStop and [onStart] from Activity.onStart.
     */
    fun bindTo(activity: Activity) {
        activity.application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityStopped(a: Activity) { if (a === activity) onStop() }
            override fun onActivityStarted(a: Activity) { if (a === activity) onStart() }
            override fun onActivityDestroyed(a: Activity) { if (a === activity) { a.application.unregisterActivityLifecycleCallbacks(this) } }
            override fun onActivityCreated(a: Activity, s: Bundle?) {}
            override fun onActivityResumed(a: Activity) {}
            override fun onActivityPaused(a: Activity) {}
            override fun onActivitySaveInstanceState(a: Activity, o: Bundle) {}
        })
    }
    fun onStop() { suspended = true; cancel() }
    fun onStart() { suspended = false }

    /** Cancels the running request, if any. Safe from any thread. */
    fun cancel() { val h = handle; if (h != 0L) MinistralNative.nativeCancel(h) }

    // ---- load

    /** Loads model and projector off the main thread. `progress` is 0..1 with a phase label (coarse). */
    suspend fun load(progress: ((Double, String) -> Unit)? = null) {
        val p = config.profile
        if (p.tier == Tier.SPEECH_ONLY) throw EngineError.NoModel()
        if (handle != 0L) return
        if (busy.getAndSet(true)) throw EngineError.Busy()
        try {
            withContext(dispatcher) {
                val t0 = SystemClock.elapsedRealtime()
                val rep = progress ?: { _, _ -> }
                rep(0.0, "checking files")
                val m = checkFile(config.modelFile, p.modelBytes, p.modelExactBytes, p.modelSHA256) { rep(0.05 + 0.1 * it, "hashing model") }
                val mm = config.mmprojFile
                val pb = if (mm != null) checkFile(mm, EngineProfile.MMPROJ_NOMINAL_BYTES, null, EngineProfile.MMPROJ_SHA) { rep(0.15 + 0.05 * it, "hashing projector") } else 0L
                // Refuse early rather than get killed by lmkd.
                val am = app.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
                val mi = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
                val need = m + pb + config.minHeadroomBytes
                Log.i(tag, "availMem=${mi.availMem} totalMem=${mi.totalMem} threshold=${mi.threshold} lowMemory=${mi.lowMemory} need=$need tier=${p.tier} thermal=${thermalStatus()}")
                if (mi.availMem < need) throw EngineError.InsufficientMemory(mi.availMem, need)
                if (thermalStatus() >= PowerManager.THERMAL_STATUS_SEVERE) throw EngineError.ThermalSevere()

                Log.i(tag, MinistralNative.nativeSystemInfo())
                rep(0.2, "loading model")
                try {
                    handle = MinistralNative.nativeLoad(
                        config.modelFile.path, mm?.path, p.nCtx, p.nBatch, p.nUbatch, p.kvType.jni,
                        if (p.forceFlashAttn) 1 else -1, p.imageMaxTokens, p.mtmdWarmup, p.nThreads,
                        config.pinBigCores, config.useMmap)
                } catch (e: EngineException) {
                    throw EngineError.Native(e.code, e.message ?: e.code)
                }
                loadSeconds = (SystemClock.elapsedRealtime() - t0) / 1000.0
                rep(1.0, "ready")
            }
        } finally { busy.set(false) }
    }

    suspend fun unload() {
        cancel()
        withContext(dispatcher) {   // queued behind any running request on the single thread
            val h = handle; handle = 0
            if (h != 0L) MinistralNative.nativeFree(h)
        }
    }

    private fun checkFile(f: File, nominal: Long, exact: Long?, sha: String?, progress: (Double) -> Unit): Long {
        if (!f.isFile) throw EngineError.FileMissing(f.name)
        val size = f.length()
        if (exact != null) { if (size != exact) throw EngineError.SizeMismatch(f.name, exact, size) }
        else if (kotlin.math.abs(size - nominal) > nominal / 10) throw EngineError.SizeMismatch(f.name, nominal, size)
        if (config.verifySHA256 && sha != null) {
            val prefs = app.getSharedPreferences("ministral_sha", Context.MODE_PRIVATE)
            val key = "${f.name}.$size.${f.lastModified()}"
            val got = prefs.getString(key, null) ?: ModelFiles.sha256(f, progress).also { prefs.edit().putString(key, it).apply() }
            if (got != sha) throw EngineError.ChecksumMismatch(f.name)
        }
        return size
    }

    // ---- generate

    /** Convenience: Bitmap (assumed upright; pass exifOrientation if it is not). */
    suspend fun generate(
        prompt: String, image: Bitmap?, grammar: String? = null, options: GenerationOptions = GenerationOptions(),
        exifOrientation: Int = android.media.ExifInterface.ORIENTATION_NORMAL, onToken: ((String) -> Unit)? = null,
    ): GenerationResult {
        val rgb = image?.let { ImagePrep.rgb(it, config.profile.maxImageSide, exifOrientation) ?: throw EngineError.ImageConversion() }
        return generate(prompt, rgb, grammar, options, onToken)
    }

    /** Convenience: image file (EXIF orientation applied). */
    suspend fun generate(
        prompt: String, imageFile: File, grammar: String? = null, options: GenerationOptions = GenerationOptions(),
        onToken: ((String) -> Unit)? = null,
    ): GenerationResult {
        val rgb = ImagePrep.rgb(imageFile, config.profile.maxImageSide) ?: throw EngineError.ImageConversion()
        return generate(prompt, rgb, grammar, options, onToken)
    }

    /**
     * Core entry point. One request at a time (a concurrent call throws [EngineError.Busy]).
     * `onToken` is invoked on the engine thread with valid UTF-8 text fragments; post to the UI thread yourself.
     * Cancelling the calling coroutine cancels the native request.
     */
    suspend fun generate(
        prompt: String, rgb: RGBImage?, grammar: String? = null, options: GenerationOptions = GenerationOptions(),
        onToken: ((String) -> Unit)? = null,
    ): GenerationResult = coroutineScope {
        if (handle == 0L) throw EngineError.NotReady()
        if (suspended) throw EngineError.Backgrounded()
        gateThermalAndCooldown()
        if (busy.getAndSet(true)) throw EngineError.Busy()
        val h = handle
        val job = async(dispatcher) {
            try {
                val sink = TokenSink { s -> onToken?.invoke(s) }
                val r = try {
                    MinistralNative.nativeGenerate(
                        h, options.systemPrompt, prompt, rgb?.data, rgb?.width ?: 0, rgb?.height ?: 0, grammar,
                        options.maxNewTokens.coerceAtMost(config.profile.maxNewTokens.coerceAtLeast(1)),
                        (options.deadlineSeconds * 1000).toLong(), options.seed, sink)
                } catch (e: EngineException) {
                    throw EngineError.Native(e.code, e.message ?: e.code)
                }
                val stop = when (r.stopReason) {
                    0 -> StopReason.END_OF_GENERATION
                    1 -> StopReason.MAX_TOKENS
                    2 -> StopReason.CONTEXT_FULL
                    3 -> StopReason.CANCELLED
                    else -> StopReason.DEADLINE
                }
                GenerationResult(
                    text = String(r.textBytes ?: ByteArray(0), Charsets.UTF_8), stopReason = stop,
                    promptTokens = r.promptTokens, imageTokens = r.imageTokens, generatedTokens = r.generatedTokens,
                    timings = Timings(loadSeconds, r.prefillSeconds, r.timeToFirstToken, r.decodeTokensPerSecond, r.totalSeconds),
                    peakRssBytes = r.peakRssBytes, thermalStatus = thermalStatus())
            } finally { busy.set(false) }
        }
        try {
            val res = job.await()
            runsSinceCooldown++
            res
        } catch (e: CancellationException) {
            cancel()                                   // abort callback stops the native loop promptly
            withContext(NonCancellable) { job.join() } // wait for the native call to return
            throw e
        }
    }

    /** Times the vision encoder alone. Returns (seconds, imageTokens). */
    suspend fun probeImageEncode(rgb: RGBImage): Pair<Double, Int> {
        if (handle == 0L) throw EngineError.NotReady()
        if (busy.getAndSet(true)) throw EngineError.Busy()
        try {
            return withContext(dispatcher) {
                try {
                    val a = MinistralNative.nativeProbeEncode(handle, rgb.data, rgb.width, rgb.height)
                    a[0] to a[1].toInt()
                } catch (e: EngineException) { throw EngineError.Native(e.code, e.message ?: e.code) }
            }
        } finally { busy.set(false) }
    }

    // ---- thermal

    fun thermalStatus(): Int {
        val pm = app.getSystemService(Context.POWER_SERVICE) as PowerManager
        return if (Build.VERSION.SDK_INT >= 29) pm.currentThermalStatus else PowerManager.THERMAL_STATUS_NONE
    }

    private fun gateThermalAndCooldown() {
        val st = thermalStatus()
        if (st >= PowerManager.THERMAL_STATUS_SEVERE) throw EngineError.ThermalSevere()
        if (st == PowerManager.THERMAL_STATUS_MODERATE) Log.w(tag, "thermal MODERATE: expect slower runs")
        val now = SystemClock.elapsedRealtime()
        val p = config.profile
        if (now < cooldownUntilMs) throw EngineError.CoolingDown(((cooldownUntilMs - now) / 1000).toInt() + 1)
        if (p.maxRunsBeforeCooldown > 0 && runsSinceCooldown >= p.maxRunsBeforeCooldown) {
            runsSinceCooldown = 0
            cooldownUntilMs = now + p.cooldownSeconds * 1000L
            throw EngineError.CoolingDown(p.cooldownSeconds)
        }
    }

    fun close() {
        app.unregisterComponentCallbacks(trimCallbacks)
        cancel()
        dispatcher.let { (it as? kotlinx.coroutines.ExecutorCoroutineDispatcher)?.close() }
    }
}
