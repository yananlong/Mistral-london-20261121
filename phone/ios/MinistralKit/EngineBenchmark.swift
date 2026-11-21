// EngineBenchmark.swift -- go/no-go harness. NOT COMPILED (see README).
// Reads Documents/golden/cases.json ({"cases":[{"id","file","prompt",...}]}, see phone/test/golden/) plus the JPEGs it names,
// writes Documents/bench-<ts>.csv. Plan, limits and CSV columns: phone/TEST_PLAN.md.
#if canImport(UIKit)
import Foundation
import UIKit

public final class EngineBenchmark {
    public struct Config {
        public var repeats = 1
        public var device = EngineProfile.machineIdentifier()   // set to iphone18pro / iphone17 (labels in TEST_PLAN.md)
        public var tier = "full"                                // EngineProfile.Tier rawValue in use
        public var seed: UInt32 = 42                            // same on every device
        public var maxNewTokens = 128
        public var deadlineSeconds = 60.0
        public var cooldownEvery = 0                            // soak pause: after every N runs (0 = back to back, the gating run)
        public var cooldownSeconds = 60
        public var sweepSides = [448, 640, 896]
        public var defaultSide = 640
        public var soakCount = 20
        public var p95LimitSeconds = 15.0
        public init() {}
    }

    private let engine: MinistralEngine
    private let cfg: Config
    private var totals: [(phase: String, side: Int, total: Double, error: Bool)] = []
    private var fh: FileHandle?

    public init(engine: MinistralEngine, config: Config = .init()) { self.engine = engine; cfg = config }

    // Column order is shared with the Android harness (phone/TEST_PLAN.md section 7). `usable` is filled by hand in scores.csv.
    private static let header = ["timestamp", "device", "tier", "phase", "case_id", "file", "run", "maxImageSide", "prompt",
                                 "stopReason", "promptTokens", "imageTokens", "generatedTokens", "loadSec", "prefillSec",
                                 "ttftSec", "decodeTokPerSec", "totalSec", "imageEncodeProbeSec", "peakFootprintMB",
                                 "thermal", "battery_pct", "error", "answer", "usable"]

    private struct Case: Decodable { let id: String; let file: String; let prompt: String }
    private struct CaseFile: Decodable { let cases: [Case] }

    private func csv(_ f: [String]) -> String {
        f.map { "\"" + $0.replacingOccurrences(of: "\"", with: "\"\"").replacingOccurrences(of: "\n", with: "\\n") + "\"" }
            .joined(separator: ",") + "\n"
    }

    /// Returns the printed summary (also printed to stdout).
    @discardableResult
    public func run() async throws -> String {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let golden = docs.appendingPathComponent("golden")
        let caseData = try Data(contentsOf: golden.appendingPathComponent("cases.json"))
        let cases = try JSONDecoder().decode(CaseFile.self, from: caseData).cases
        guard !cases.isEmpty else { throw EngineError.internalFailure("cases.json has no cases") }
        let files = cases.map { $0.file }
        var caseOf: [String: Case] = [:]
        for c in cases { caseOf[c.file] = c }
        var prompts: [String: String] = [:]
        for c in cases { prompts[c.file] = c.prompt }
        var images: [String: UIImage] = [:]
        for f in files {
            // UIImage(contentsOfFile:) keeps EXIF orientation; ImagePrep's UIImage path bakes it in.
            guard let img = UIImage(contentsOfFile: golden.appendingPathComponent(f).path) else {
                throw EngineError.internalFailure("cannot read golden/\(f)")
            }
            images[f] = img
        }
        UIDevice.current.isBatteryMonitoringEnabled = true

        let ts = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "")
        let out = docs.appendingPathComponent("bench-\(ts).csv")
        FileManager.default.createFile(atPath: out.path, contents: Data(csv(Self.header).utf8))
        fh = try FileHandle(forWritingTo: out)
        defer { try? fh?.close() }       // rows are appended as we go, so a crash leaves a partial CSV

        // 1. Sweep: image encode probe + N runs per (image, side).
        for side in cfg.sweepSides {
            for f in files {
                guard let rgb = ImagePrep.rgb(from: images[f]!, maxSide: side) else { continue }
                var probe = -1.0
                if let p = try? await engine.probeImageEncode(rgb: rgb) {
                    probe = p.seconds
                    print("encode probe \(f) @\(side)px: \(String(format: "%.2f", p.seconds))s, \(p.imageTokens) image tokens"
                          + (p.seconds > 3 ? "  <-- suspiciously slow: vision encoder on CPU?" : ""))
                }
                for r in 1...cfg.repeats {
                    await one(phase: "sweep", file: f, caseId: caseOf[f]!.id, run: r, side: side, prompt: prompts[f]!, rgb: rgb, probe: probe)
                }
            }
        }
        // Text-only sanity row (the on-device text fallback path).
        await one(phase: "text-only", file: "", caseId: "", run: 1, side: 0, prompt: "Say hello in French.", rgb: nil, probe: -1)

        // 2. Soak: back-to-back at the default size, cycling through the golden set.
        for i in 0..<cfg.soakCount {
            let f = files[i % files.count]
            let rgb = ImagePrep.rgb(from: images[f]!, maxSide: cfg.defaultSide)
            await one(phase: "soak", file: f, caseId: caseOf[f]!.id, run: i + 1, side: cfg.defaultSide, prompt: prompts[f]!, rgb: rgb, probe: -1)
            if cfg.cooldownEvery > 0, (i + 1) % cfg.cooldownEvery == 0, i + 1 < cfg.soakCount {
                try? await Task.sleep(nanoseconds: UInt64(cfg.cooldownSeconds) * 1_000_000_000)
            }
        }

        return summary(csvPath: out.path)
    }

    private func one(phase: String, file: String, caseId: String, run: Int, side: Int, prompt: String, rgb: RGBImage?, probe: Double) async {
        var f = [ISO8601DateFormatter().string(from: Date()), cfg.device, cfg.tier, phase, caseId, file, "\(run)", "\(side)", prompt]
        var opts = GenerationOptions()
        opts.seed = cfg.seed; opts.maxNewTokens = cfg.maxNewTokens; opts.deadline = cfg.deadlineSeconds
        let battery = UIDevice.current.batteryLevel >= 0 ? "\(Int((UIDevice.current.batteryLevel * 100).rounded()))" : "-1"
        var total = 0.0, failed = false
        do {
            let r = try await engine.generate(prompt: prompt, rgb: rgb, options: opts)
            total = r.timings.totalSeconds
            failed = r.stopReason == .deadline || r.stopReason == .cancelled
            f += [r.stopReason.rawValue, "\(r.promptTokens)", "\(r.imageTokens)", "\(r.generatedTokens)",
                  fmt(r.timings.loadSeconds), fmt(r.timings.prefillSeconds), fmt(r.timings.timeToFirstToken),
                  fmt(r.timings.decodeTokensPerSecond), fmt(total), fmt(probe),
                  "\(r.peakFootprintBytes / 1_000_000)", "\(r.thermalState.rawValue)", battery,
                  failed ? "stopped: \(r.stopReason.rawValue)" : "", r.text, ""]
        } catch {
            failed = true
            f += Array(repeating: "", count: 12) + [battery, error.localizedDescription, "", ""]
        }
        // Keep column count aligned with the header on the error path.
        while f.count < Self.header.count { f.append("") }
        try? fh?.write(contentsOf: Data(csv(f).utf8))
        totals.append((phase, side, total, failed))
        print("[\(phase)] \(file) run \(run) @\(side): \(failed ? "FAIL" : "ok") \(fmt(total))s")
        // Brief cool-down check so a thermal refusal doesn't masquerade as a crash.
        if ProcessInfo.processInfo.thermalState == .critical { try? await Task.sleep(nanoseconds: 20_000_000_000) }
    }

    private func fmt(_ d: Double) -> String { String(format: "%.3f", d) }

    private func p95(_ xs: [Double]) -> Double {
        guard !xs.isEmpty else { return .infinity }
        let s = xs.sorted()
        return s[min(s.count - 1, Int((0.95 * Double(s.count)).rounded(.up)) - 1)]   // nearest rank
    }

    private func summary(csvPath: String) -> String {
        let soak = totals.filter { $0.phase == "soak" }
        let soakErrors = soak.filter { $0.error }.count
        let soakP95 = p95(soak.filter { !$0.error }.map { $0.total })
        var lines = ["=== Ministral engine benchmark ==="]
        for side in cfg.sweepSides {
            let xs = totals.filter { $0.phase == "sweep" && $0.side == side && !$0.error }.map { $0.total }
            lines.append("sweep \(side)px: n=\(xs.count) p95=\(fmt(p95(xs)))s (info only)")
        }
        let c1 = soak.count == cfg.soakCount && soakErrors == 0
        let c2 = soakP95 <= cfg.p95LimitSeconds
        lines.append("soak: \(soak.count)/\(cfg.soakCount) runs, \(soakErrors) errors   -> \(c1 ? "PASS" : "FAIL")")
        lines.append("soak p95 total: \(fmt(soakP95))s (limit \(cfg.p95LimitSeconds)s)   -> \(c2 ? "PASS" : "FAIL")")
        lines.append("answer quality: MANUAL - fill usable in scores.csv, not the CSV; see phone/TEST_PLAN.md: \(csvPath)")
        lines.append("OVERALL (excluding manual review): \(c1 && c2 ? "PASS" : "FAIL")")
        let s = lines.joined(separator: "\n")
        print(s)
        return s
    }
}
#endif
