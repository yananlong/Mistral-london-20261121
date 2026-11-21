// DeviceProfile.kt -- runtime tier selection for 8 GB Android phones (Pixel 9a). Mirrors DeviceProfile.swift.
// UNCOMPILED. All memory numbers are ESTIMATES. See DESIGN_PIXEL9A.md.
package com.mistral.london.ministral

import android.app.ActivityManager
import android.content.Context

enum class Tier { FULL, LEAN, TIGHT, TEXT_ONLY, SPEECH_ONLY }
enum class KVType(val jni: Int) { F16(0), Q8_0(1) }

data class EngineProfile(
    val tier: Tier,
    val modelFile: String?,              // null => no LLM (speechOnly)
    val modelBytes: Long,
    val modelExactBytes: Long?,          // exact size check when known
    val modelSHA256: String?,
    val mmprojFile: String?,             // null => vision disabled
    val nCtx: Int,
    val kvType: KVType,                  // q8_0 V cache requires flash attention => forceFlashAttn
    val forceFlashAttn: Boolean,
    val nBatch: Int,
    val nUbatch: Int,
    val maxImageSide: Int,
    val imageMaxTokens: Int,
    val maxNewTokens: Int,
    val mtmdWarmup: Boolean,
    val nThreads: Int,
    val estimatedFootprintBytes: Long,   // estimate only
    val minAvailableBytes: Long,         // availMem threshold used by select()
    val maxRunsBeforeCooldown: Int,
    val cooldownSeconds: Int,
    val reason: String,
) {
    val visionEnabled: Boolean get() = mmprojFile != null

    companion object {
        const val MB = 1_000_000L

        const val Q4_0_FILE = "Ministral-3-3B-Instruct-2512-Q4_0.gguf"
        const val Q4_0_SHA = "bd1eef40a7fdb1ba9728ec977bd4aab40fb76993d6ec37377fd6522703dc88a5"
        const val Q4_0_BYTES = 2_046_375_200L
        const val Q3KM_FILE = "Ministral-3-3B-Instruct-2512-Q3_K_M.gguf"
        const val Q3KM_SHA = "91489d8d75b0a9e682e2f17ab9f25260ab935cddf6edc8f3510b8c691993c5d5"
        const val Q3KM_BYTES = 1_795_552_544L
        const val MMPROJ_FILE = "mmproj-Ministral-3-3B-Instruct-2512-Q8_0.gguf"
        const val MMPROJ_SHA = "57af826536cde496dde1e8343b8e72c89fdbd89084d58e18eb391ef34c39c9f2"
        const val MMPROJ_NOMINAL_BYTES = 450_000_000L   // "about 0.45 GB"; exact size not known here, checked within +-10%

        /** Phones with less than this much totalMem are 8 GB class (Pixel 9a reports roughly 7.3-7.7 GB). */
        const val EIGHT_GB_CLASS_MAX_TOTAL = 9_500L * MB

        val full = EngineProfile(
            Tier.FULL, Q4_0_FILE, Q4_0_BYTES, Q4_0_BYTES, Q4_0_SHA, MMPROJ_FILE,
            nCtx = 4096, kvType = KVType.F16, forceFlashAttn = false, nBatch = 512, nUbatch = 512,
            maxImageSide = 640, imageMaxTokens = 512, maxNewTokens = 256, mtmdWarmup = true, nThreads = 4,
            estimatedFootprintBytes = 3_650 * MB, minAvailableBytes = 4_300 * MB,
            maxRunsBeforeCooldown = 8, cooldownSeconds = 60, reason = "default profile")

        val lean = EngineProfile(
            Tier.LEAN, Q4_0_FILE, Q4_0_BYTES, Q4_0_BYTES, Q4_0_SHA, MMPROJ_FILE,
            nCtx = 2048, kvType = KVType.Q8_0, forceFlashAttn = true, nBatch = 256, nUbatch = 256,
            maxImageSide = 512, imageMaxTokens = 256, maxNewTokens = 192, mtmdWarmup = true, nThreads = 4,
            estimatedFootprintBytes = 3_200 * MB, minAvailableBytes = 3_800 * MB,
            maxRunsBeforeCooldown = 6, cooldownSeconds = 60, reason = "reduced context, q8_0 KV, smaller image")

        val tight = EngineProfile(
            Tier.TIGHT, Q3KM_FILE, Q3KM_BYTES, Q3KM_BYTES, Q3KM_SHA, MMPROJ_FILE,
            nCtx = 1536, kvType = KVType.Q8_0, forceFlashAttn = true, nBatch = 128, nUbatch = 128,
            maxImageSide = 448, imageMaxTokens = 144, maxNewTokens = 128, mtmdWarmup = false, nThreads = 4,
            estimatedFootprintBytes = 2_800 * MB, minAvailableBytes = 3_300 * MB,
            maxRunsBeforeCooldown = 5, cooldownSeconds = 90, reason = "Q3_K_M weights, minimal vision")

        val textOnly = EngineProfile(
            Tier.TEXT_ONLY, Q3KM_FILE, Q3KM_BYTES, Q3KM_BYTES, Q3KM_SHA, null,
            nCtx = 2048, kvType = KVType.Q8_0, forceFlashAttn = true, nBatch = 256, nUbatch = 128,
            maxImageSide = 0, imageMaxTokens = 0, maxNewTokens = 128, mtmdWarmup = false, nThreads = 4,
            estimatedFootprintBytes = 2_300 * MB, minAvailableBytes = 2_800 * MB,
            maxRunsBeforeCooldown = 8, cooldownSeconds = 45, reason = "vision does not fit; text-only")

        val speechOnly = EngineProfile(
            Tier.SPEECH_ONLY, null, 0, null, null, null,
            nCtx = 0, kvType = KVType.Q8_0, forceFlashAttn = false, nBatch = 0, nUbatch = 0,
            maxImageSide = 0, imageMaxTokens = 0, maxNewTokens = 0, mtmdWarmup = false, nThreads = 0,
            estimatedFootprintBytes = 0, minAvailableBytes = 0,
            maxRunsBeforeCooldown = 0, cooldownSeconds = 0, reason = "not enough memory for any model")

        /**
         * Pick the richest tier that fits. availMem is the primary signal (measure BEFORE loading anything);
         * totalMem only caps: an 8 GB-class phone never gets FULL unless [allowFullOn8GB] is set after measurement.
         * Note: availMem may include reclaimable file cache (unconfirmed), so treat it as optimistic.
         */
        fun select(availMemBytes: Long, totalMemBytes: Long, model: String, allowFullOn8GB: Boolean = false): EngineProfile {
            val known8GB = totalMemBytes in 1 until EIGHT_GB_CLASS_MAX_TOTAL
            val candidates = if (known8GB && !allowFullOn8GB) listOf(lean, tight, textOnly) else listOf(full, lean, tight, textOnly)
            for (t in candidates) {
                if (availMemBytes >= t.minAvailableBytes) {
                    return t.copy(reason = t.reason + (if (known8GB) " (8 GB-class $model)" else " ($model)"))
                }
            }
            return speechOnly.copy(reason = speechOnly.reason + " (availMem ${availMemBytes / MB} MB, $model)")
        }

        fun select(context: Context, allowFullOn8GB: Boolean = false): EngineProfile {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val mi = ActivityManager.MemoryInfo()
            am.getMemoryInfo(mi)
            return select(mi.availMem, mi.totalMem, android.os.Build.MODEL, allowFullOn8GB)
        }
    }
}
