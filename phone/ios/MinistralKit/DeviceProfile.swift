// DeviceProfile.swift
// Runtime tier selection for 8 GB iPhones (iPhone 17 family). Plain Swift, no llama dependency.
// Wire-up: map EngineProfile onto EngineConfig / llama_context_params / mtmd_context_params.
// All memory numbers are ESTIMATES, not measured. See DESIGN_IPHONE17.md.
import Foundation

public struct EngineProfile: Sendable, Equatable {
    public enum Tier: String, Sendable { case full, lean, tight, textOnly, speechOnly }
    public enum KVType: String, Sendable { case f16, q8_0 }

    public var tier: Tier
    public var modelFile: String?          // nil => no LLM (speechOnly)
    public var modelBytes: Int64
    public var modelSHA256: String?        // nil => use EngineConfig default
    public var mmprojFile: String?         // nil => vision disabled
    public var nCtx: Int
    public var kvType: KVType              // q8_0 V cache requires flash attention => force ENABLED
    public var forceFlashAttn: Bool
    public var nBatch: Int
    public var nUbatch: Int
    public var maxImageSide: Int
    public var imageMaxTokens: Int
    public var maxNewTokens: Int
    public var mtmdWarmup: Bool
    public var estimatedFootprintBytes: Int64   // estimate only
    public var minAvailableBytes: UInt64        // threshold used by select
    public var maxRunsBeforeCooldown: Int
    public var cooldownSeconds: Int
    public var reason: String

    public var visionEnabled: Bool { mmprojFile != nil }
}

extension EngineProfile {
    static let q4kmSHA = "9ed150d4367e68df0ac8e1540f6ddc65b42d0ee26378329d1ecbca60f93fc5f8" // official mistralai, matches EngineConfig
    static let mmprojQ8 = "mmproj-Ministral-3-3B-Instruct-2512-Q8_0.gguf"
    static let mb: Int64 = 1_000_000

    /// iPhone 17 family identifiers (EveryMac / TheAppleWiki via web search, not run on devices).
    static let baseClass8GB: Set<String> = ["iPhone18,3", "iPhone18,5"]   // 17; 17e (18,5 single-source, unconfirmed)
    static let proClass12GB: Set<String> = ["iPhone18,1", "iPhone18,2", "iPhone18,4"] // 17 Pro, Pro Max, Air

    public static let full = EngineProfile(
        tier: .full, modelFile: "Ministral-3-3B-Instruct-2512-Q4_K_M.gguf", modelBytes: 2_150 * mb, modelSHA256: q4kmSHA,
        mmprojFile: mmprojQ8, nCtx: 4096, kvType: .f16, forceFlashAttn: false, nBatch: 512, nUbatch: 512,
        maxImageSide: 640, imageMaxTokens: 512, maxNewTokens: 256, mtmdWarmup: true,
        estimatedFootprintBytes: 3_700 * mb, minAvailableBytes: 4_500 * UInt64(mb),
        maxRunsBeforeCooldown: 8, cooldownSeconds: 60, reason: "default profile")

    public static let lean = EngineProfile(
        tier: .lean, modelFile: "Ministral-3-3B-Instruct-2512-Q4_K_M.gguf", modelBytes: 2_150 * mb, modelSHA256: q4kmSHA,
        mmprojFile: mmprojQ8, nCtx: 2048, kvType: .q8_0, forceFlashAttn: true, nBatch: 256, nUbatch: 256,
        maxImageSide: 512, imageMaxTokens: 256, maxNewTokens: 192, mtmdWarmup: true,
        estimatedFootprintBytes: 3_250 * mb, minAvailableBytes: 3_900 * UInt64(mb),
        maxRunsBeforeCooldown: 6, cooldownSeconds: 60, reason: "reduced context, q8_0 KV, smaller image")

    public static let tight = EngineProfile(
        tier: .tight, modelFile: "Ministral-3-3B-Instruct-2512-Q3_K_M.gguf", modelBytes: 1_796 * mb,
        modelSHA256: "91489d8d75b0a9e682e2f17ab9f25260ab935cddf6edc8f3510b8c691993c5d5", // unsloth
        mmprojFile: mmprojQ8, nCtx: 1536, kvType: .q8_0, forceFlashAttn: true, nBatch: 128, nUbatch: 128,
        maxImageSide: 448, imageMaxTokens: 144, maxNewTokens: 128, mtmdWarmup: false,
        estimatedFootprintBytes: 2_750 * mb, minAvailableBytes: 3_300 * UInt64(mb),
        maxRunsBeforeCooldown: 5, cooldownSeconds: 90, reason: "Q3_K_M weights, minimal vision")

    public static let textOnly = EngineProfile(
        tier: .textOnly, modelFile: "Ministral-3-3B-Instruct-2512-Q3_K_M.gguf", modelBytes: 1_796 * mb,
        modelSHA256: "91489d8d75b0a9e682e2f17ab9f25260ab935cddf6edc8f3510b8c691993c5d5",
        mmprojFile: nil, nCtx: 2048, kvType: .q8_0, forceFlashAttn: true, nBatch: 256, nUbatch: 128,
        maxImageSide: 0, imageMaxTokens: 0, maxNewTokens: 128, mtmdWarmup: false,
        estimatedFootprintBytes: 2_250 * mb, minAvailableBytes: 2_700 * UInt64(mb),
        maxRunsBeforeCooldown: 8, cooldownSeconds: 45, reason: "vision does not fit; text-only")

    public static let speechOnly = EngineProfile(
        tier: .speechOnly, modelFile: nil, modelBytes: 0, modelSHA256: nil,
        mmprojFile: nil, nCtx: 0, kvType: .q8_0, forceFlashAttn: false, nBatch: 0, nUbatch: 0,
        maxImageSide: 0, imageMaxTokens: 0, maxNewTokens: 0, mtmdWarmup: false,
        estimatedFootprintBytes: 0, minAvailableBytes: 0,
        maxRunsBeforeCooldown: 0, cooldownSeconds: 0, reason: "not enough memory for any model")

    /// Machine identifier, e.g. "iPhone18,3". Simulator reports SIMULATOR_MODEL_IDENTIFIER.
    public static func machineIdentifier() -> String {
        var u = utsname(); uname(&u)
        let m = withUnsafePointer(to: &u.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: Int(_SYS_NAMELEN)) { String(cString: $0) }
        }
        if m == "arm64" || m == "x86_64" {
            return ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? m
        }
        return m
    }

    /// Pick the richest tier that fits. Memory is the primary signal; the identifier only
    /// caps the tier (an 8 GB-class phone never gets `.full` unless measured headroom says so
    /// AND the device is not known base-class) and is a fallback when nothing else is known.
    /// Pass `os_proc_available_memory()` measured BEFORE loading anything.
    public static func select(availableBytes: UInt64, machine: String = machineIdentifier()) -> EngineProfile {
        let known8GB = baseClass8GB.contains(machine)
        let tiers: [EngineProfile] = [full, lean, tight, textOnly]
        // On known 8 GB phones, never pick .full: its estimate leaves too little slack under a
        // ~3.5-4 GB cap until measured otherwise. Flip this after the device test.
        let candidates = known8GB ? Array(tiers.dropFirst()) : tiers
        for var t in candidates where availableBytes >= t.minAvailableBytes {
            t.reason += known8GB ? " (8 GB-class \(machine))" : " (\(machine))"
            return t
        }
        var s = speechOnly
        s.reason += " (available \(availableBytes / UInt64(mb)) MB, \(machine))"
        return s
    }
}
