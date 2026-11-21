// Minimal host for :ministral. One screen: stage + load the model, ask a text prompt, run EngineBenchmark.
// Model files: adb push them to /sdcard/Android/data/com.mistral.london.ministral.demo/files/ (phone/android/README.md).
package com.mistral.london.ministral.demo

import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.text.method.ScrollingMovementMethod
import android.util.Log
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import com.mistral.london.ministral.EngineBenchmark
import com.mistral.london.ministral.EngineConfig
import com.mistral.london.ministral.EngineProfile
import com.mistral.london.ministral.MinistralEngine
import com.mistral.london.ministral.MinistralNative
import com.mistral.london.ministral.ModelFiles
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : Activity() {
    private val scope: CoroutineScope = MainScope()
    private var engine: MinistralEngine? = null
    private var job: Job? = null
    private lateinit var log: TextView
    private lateinit var prompt: EditText

    private val isEmulator: Boolean
        get() = Build.HARDWARE.contains("ranchu") || Build.FINGERPRINT.contains("generic") ||
            Build.PRODUCT.contains("sdk")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (16 * resources.displayMetrics.density).toInt()
        prompt = EditText(this).apply { setText("Say hello in French."); setSingleLine(false) }
        log = TextView(this).apply {
            movementMethod = ScrollingMovementMethod()
            setTextIsSelectable(true)
            textSize = 13f
        }
        fun button(label: String, onClick: () -> Unit) =
            Button(this).apply { text = label; setOnClickListener { onClick() } }

        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 2, pad, pad)
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(button("Load") { load() })
                addView(button("Ask") { ask() })
                addView(button("Bench") { bench() })
                addView(button("Stop") { job?.cancel(); engine?.cancel() })
            })
            addView(prompt, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            addView(log, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
        })

        append("device=${Build.MODEL} hw=${Build.HARDWARE} emulator=$isEmulator sdk=${Build.VERSION.SDK_INT}")
        append("model dir (adb push here): ${getExternalFilesDir(null)}")
        runCatching { MinistralNative.nativeSystemInfo() }
            .onSuccess { append("native: $it") }
            .onFailure { append("native lib failed to load: $it") }
    }

    private fun append(s: String) {
        Log.i(TAG, s)
        log.append(s + "\n")
    }

    private fun launchTask(block: suspend () -> Unit) {
        if (job?.isActive == true) { append("busy"); return }
        job = scope.launch {
            try { block() } catch (e: Throwable) { append("ERROR: $e"); Log.e(TAG, "task failed", e) }
        }
    }

    private fun load() = launchTask {
        if (engine?.isReady == true) { append("already loaded"); return@launchTask }
        val profile = EngineProfile.select(this, allowFullOn8GB = false)
        append("tier=${profile.tier} (${profile.reason})")
        val dir = withContext(Dispatchers.IO) {
            ModelFiles.stageToInternal(this@MainActivity, profile) { label, f ->
                if ((f * 100).toInt() % 10 == 0) runOnUiThread { append("$label ${(f * 100).toInt()}%") }
            }
        }
        // Emulator vCPU topology is not the Pixel's big/little layout, so don't pin threads there.
        val e = MinistralEngine(this, EngineConfig(profile, dir, pinBigCores = !isEmulator))
        e.bindTo(this)
        e.load { p, label -> runOnUiThread { append("load ${(p * 100).toInt()}% $label") } }
        engine = e
        append("loaded in ${"%.1f".format(e.loadSeconds)} s")
    }

    private fun ask() = launchTask {
        val e = engine?.takeIf { it.isReady } ?: run { append("press Load first"); return@launchTask }
        append("> ${prompt.text}")
        val r = e.generate(prompt.text.toString(), rgb = null) { tok -> runOnUiThread { log.append(tok) } }
        append("\n[${r.stopReason}] ${r.generatedTokens} tok, ttft ${"%.2f".format(r.timings.timeToFirstToken)} s, " +
            "${"%.1f".format(r.timings.decodeTokensPerSecond)} tok/s, peak RSS ${r.peakRssBytes / 1_000_000} MB")
    }

    private fun bench() = launchTask {
        val e = engine?.takeIf { it.isReady } ?: run { append("press Load first"); return@launchTask }
        append("benchmark running (needs files/golden/cases.json + photos)...")
        val summary = EngineBenchmark(
            this, e,
            EngineBenchmark.Config(device = if (isEmulator) "emulator" else Build.MODEL, tier = e.config.profile.tier.name.lowercase()),
        ).run()
        append(summary)
    }

    override fun onDestroy() {
        scope.cancel()
        engine?.close()
        super.onDestroy()
    }

    companion object { private const val TAG = "MinistralDemo" }
}
