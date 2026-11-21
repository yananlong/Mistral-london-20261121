// EngineBenchmark.kt -- go/no-go harness. UNCOMPILED. Mirrors EngineBenchmark.swift; the CSV columns are the SAME
// names in the SAME order (extra Android-only columns are appended at the end).
// Reads <externalFilesDir>/golden/cases.json ({"cases":[{"id","file","prompt",...}]}, see phone/test/golden/) plus the
// JPEGs it names; writes <externalFilesDir>/bench-<ts>.csv (adb pull /sdcard/Android/data/<pkg>/files/bench-*.csv).
// Plan, limits and CSV columns: phone/TEST_PLAN.md. Re-check HEADER against EngineBenchmark.swift if either changes.
package com.mistral.london.ministral

import android.app.ActivityManager
import android.content.Context
import android.util.Log
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.ceil
import kotlin.math.min

class EngineBenchmark(
    private val context: Context,
    private val engine: MinistralEngine,
    private val cfg: Config = Config(),
) {
    class Config(
        val repeats: Int = 1,
        val device: String = "pixel9a",
        val tier: String = "lean",                              // EngineProfile tier in use
        val seed: Int = 42,                                     // same on every device
        val maxNewTokens: Int = 128,
        val deadlineSeconds: Double = 60.0,
        val cooldownEvery: Int = 0,                             // soak pause after every N runs (0 = back to back, the gating run)
        val cooldownSeconds: Int = 60,
        val sweepSides: List<Int> = listOf(448, 640, 896),
        val defaultSide: Int = 640,
        val soakCount: Int = 20,
        /** The shared bar lives in phone/TEST_PLAN.md; set the value from there (Pixel 9a: see DESIGN_PIXEL9A.md). */
        val p95LimitSeconds: Double = 35.0,                     // Pixel bar in phone/TEST_PLAN.md
        val p95TtftLimitSeconds: Double = 20.0,
    )

    private class Row(val phase: String, val side: Int, val total: Double, val error: Boolean, val ttft: Double = 0.0)

    private val totals = mutableListOf<Row>()
    private var out: File? = null

    companion object {
        private const val TAG = "EngineBenchmark"
        // Same names and order as EngineBenchmark.swift. peakFootprintMB = peak RSS (VmHWM) on Android;
        // thermal = PowerManager.THERMAL_STATUS_* int. Android-only extras at the end.
        val HEADER = listOf(
            "timestamp", "device", "tier", "phase", "case_id", "file", "run", "maxImageSide", "prompt",
            "stopReason", "promptTokens", "imageTokens", "generatedTokens", "loadSec", "prefillSec",
            "ttftSec", "decodeTokPerSec", "totalSec", "imageEncodeProbeSec", "peakFootprintMB",
            "thermal", "battery_pct", "error", "answer", "usable",
        )
    }

    private fun csv(f: List<String>): String =
        f.joinToString(",", postfix = "\n") { "\"" + it.replace("\"", "\"\"").replace("\n", "\\n") + "\"" }

    private fun iso(): String {
        val f = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US); f.timeZone = TimeZone.getTimeZone("UTC")
        return f.format(Date())
    }

    @Suppress("unused")
    private fun availMb(): String {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val mi = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
        return (mi.availMem / 1_000_000).toString()
    }

    /**
     * CSV `thermal` is 0-3 like iOS ProcessInfo.ThermalState (nominal 0, fair 1, serious 2, critical 3).
     * From PowerManager.getCurrentThermalStatus(): NONE -> 0; LIGHT -> 1; MODERATE and SEVERE -> 2 (the engine refuses
     * at SEVERE, as iOS refuses at serious); CRITICAL, EMERGENCY, SHUTDOWN -> 3.
     */
    private fun thermal03(status: Int): Int = when {
        status <= 0 -> 0
        status == 1 -> 1
        status <= 3 -> 2
        else -> 3
    }

    private fun fmt(d: Double) = String.format(Locale.US, "%.3f", d)

    /** Returns the printed summary (also logged). */
    suspend fun run(): String {
        val dir = context.getExternalFilesDir(null) ?: throw EngineError.FileMissing("externalFilesDir")
        val golden = File(dir, "golden")
        val arr = JSONObject(File(golden, "cases.json").readText()).getJSONArray("cases")
        class Case(val id: String, val file: String, val prompt: String)
        val cases = (0 until arr.length()).map { arr.getJSONObject(it).let { o -> Case(o.getString("id"), o.getString("file"), o.getString("prompt")) } }
        require(cases.isNotEmpty()) { "cases.json has no cases" }
        val files = cases.map { it.file }
        val caseOf = cases.associateBy { it.file }
        val prompts = cases.associate { it.file to it.prompt }
        val ts = iso().replace(":", "")
        val outFile = File(dir, "bench-$ts.csv").also { out = it }
        outFile.writeText(csv(HEADER))   // rows are appended as we go, so a crash leaves a partial CSV

        val vision = engine.config.profile.visionEnabled
        if (vision) {
            for (side in cfg.sweepSides) {
                for (f in files) {
                    val rgb = ImagePrep.rgb(File(golden, f), side) ?: continue
                    var probe = -1.0
                    try {
                        val (secs, toks) = engine.probeImageEncode(rgb)
                        probe = secs
                        Log.i(TAG, "encode probe $f @${side}px: ${fmt(secs)}s, $toks image tokens" +
                            if (secs > 3) "  <-- slow (expected on CPU; see DESIGN_PIXEL9A.md)" else "")
                    } catch (_: Exception) {}
                    for (r in 1..cfg.repeats) one("sweep", f, caseOf.getValue(f).id, r, side, prompts.getValue(f), rgb, probe)
                }
            }
        }
        // Text-only sanity row.
        one("text-only", "", "", 1, 0, "Say hello in French.", null, -1.0)

        if (vision) {
            for (i in 0 until cfg.soakCount) {
                val f = files[i % files.size]
                val rgb = ImagePrep.rgb(File(golden, f), cfg.defaultSide)
                one("soak", f, caseOf.getValue(f).id, i + 1, cfg.defaultSide, prompts.getValue(f), rgb, -1.0)
                if (cfg.cooldownEvery > 0 && (i + 1) % cfg.cooldownEvery == 0 && i + 1 < cfg.soakCount) delay(cfg.cooldownSeconds * 1000L)
            }
        }
        return summary(outFile.path)
    }

    private suspend fun one(phase: String, file: String, caseId: String, run: Int, side: Int, prompt: String, rgb: RGBImage?, probe: Double) {
        val f = mutableListOf(iso(), cfg.device, cfg.tier, phase, caseId, file, "$run", "$side", prompt)
        val opts = GenerationOptions(maxNewTokens = cfg.maxNewTokens, deadlineSeconds = cfg.deadlineSeconds, seed = cfg.seed)
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as android.os.BatteryManager
        val battery = bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY).let { if (it in 0..100) "$it" else "-1" }
        var total = 0.0
        var ttft = 0.0
        var failed = false
        try {
            val r = engine.generate(prompt, rgb, null, opts)
            total = r.timings.totalSeconds
            ttft = r.timings.timeToFirstToken
            failed = r.stopReason == StopReason.DEADLINE || r.stopReason == StopReason.CANCELLED
            f += listOf(
                r.stopReason.name.lowercase(), "${r.promptTokens}", "${r.imageTokens}", "${r.generatedTokens}",
                fmt(r.timings.loadSeconds), fmt(r.timings.prefillSeconds), fmt(r.timings.timeToFirstToken),
                fmt(r.timings.decodeTokensPerSecond), fmt(total), fmt(probe),
                "${r.peakRssBytes / 1_000_000}", "${thermal03(r.thermalStatus)}", battery,
                if (failed) "stopped: ${r.stopReason.name.lowercase()}" else "", r.text, "")
        } catch (e: EngineError.CoolingDown) {
            // Not a failure of the engine: wait it out and record the row as an error.
            failed = true
            f += List(12) { "" } + listOf(battery, e.message ?: "cooling down", "", "")
            delay((e.secondsLeft + 1) * 1000L)
        } catch (e: Exception) {
            failed = true
            f += List(12) { "" } + listOf(battery, e.message ?: e.toString(), "", "")
        }
        while (f.size < HEADER.size) f += ""              // keep columns aligned with the header on the error path
        out?.appendText(csv(f))
        totals += Row(phase, side, total, failed, ttft)
        Log.i(TAG, "[$phase] $file run $run @$side: ${if (failed) "FAIL" else "ok"} ${fmt(total)}s")
    }

    /** Nearest-rank p95, same as the Swift version. */
    private fun p95(xs: List<Double>): Double {
        if (xs.isEmpty()) return Double.POSITIVE_INFINITY
        val s = xs.sorted()
        return s[min(s.size - 1, ceil(0.95 * s.size).toInt() - 1)]
    }

    private fun summary(csvPath: String): String {
        val soak = totals.filter { it.phase == "soak" }
        val soakErrors = soak.count { it.error }
        val soakP95 = p95(soak.filter { !it.error }.map { it.total })
        val lines = mutableListOf("=== Ministral engine benchmark (Android) ===")
        for (side in cfg.sweepSides) {
            val xs = totals.filter { it.phase == "sweep" && it.side == side && !it.error }.map { it.total }
            lines += "sweep ${side}px: n=${xs.size} p95=${fmt(p95(xs))}s (info only)"
        }
        val c1 = soak.size == cfg.soakCount && soakErrors == 0
        val c2 = soakP95 <= cfg.p95LimitSeconds
        val soakTtft = p95(soak.filter { !it.error }.map { it.ttft })
        val c3 = soakTtft <= cfg.p95TtftLimitSeconds
        lines += "soak: ${soak.size}/${cfg.soakCount} runs, $soakErrors errors   -> ${if (c1) "PASS" else "FAIL"}"
        lines += "soak p95 total: ${fmt(soakP95)}s (limit ${cfg.p95LimitSeconds}s)   -> ${if (c2) "PASS" else "FAIL"}"
        lines += "soak p95 ttft: ${fmt(soakTtft)}s (limit ${cfg.p95TtftLimitSeconds}s)   -> ${if (c3) "PASS" else "FAIL"}"
        lines += "answer quality: MANUAL - mark usable per case in scores.csv (phone/TEST_PLAN.md); CSV: $csvPath"
        lines += "OVERALL (excluding manual review): ${if (c1 && c2 && c3) "PASS" else "FAIL"}"
        val s = lines.joinToString("\n")
        Log.i(TAG, s)
        return s
    }
}
