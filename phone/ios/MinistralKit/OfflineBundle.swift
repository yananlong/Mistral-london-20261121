// OfflineBundle.swift -- wires the offline files on the phone into MinistralKit. NOT COMPILED (see README).
//
// Documents/ layout (filled by scripts/push_ios.sh, model list in phone/ios/models.json):
//   Documents/<model>.gguf                 language model(s) and projector for this device class
//   Documents/datasets/manifest.json       copy of datasets/phone/manifest.json
//   Documents/datasets/<path>              every file from datasets/phone/ (map, POIs, ZIMs, guides, foraging)
//   Documents/golden/                      benchmark photos + cases.json
//
// Startup:
//   let profile = OfflineBundle.selectProfile()            // memory tier, capped by which files are present
//   let engine = MinistralEngine(config: EngineConfig(profile: profile))
//   let problems = OfflineBundle.verifyDatasets()          // [] when the data bundle is complete
//   let foraging = try ForagingTask.load()                 // prompt, grammar, policy, species
//   if foraging.fits(profile) { let v = try await foraging.identify(engine: engine, image: photo) }
import Foundation
import os
#if canImport(UIKit)
import UIKit
#endif
#if canImport(Speech)
import Speech
#endif

// MARK: - Profile -> EngineConfig

extension EngineConfig {
    /// Engine settings for a DeviceProfile tier. `.speechOnly` has no model: do not build an engine for it.
    public init(profile p: EngineProfile) {
        precondition(p.modelFile != nil, "speechOnly has no model")
        self.init(modelFile: p.modelFile!, mmprojFile: p.mmprojFile)
        nCtx = p.nCtx
        nBatch = p.nBatch
        nUbatch = p.nUbatch
        kvType = p.kvType
        forceFlashAttn = p.forceFlashAttn
        mtmdWarmup = p.mtmdWarmup
        maxImageSide = p.maxImageSide
        imageMaxTokens = p.imageMaxTokens
        modelNominalBytes = p.modelBytes
        if let sha = p.modelSHA256 { modelSHA256 = sha }
        // Exact sizes from phone/ios/models.json catch a truncated USB copy without hashing 2 GB.
        modelExactBytes = OfflineBundle.exactBytes[p.modelFile!]
        mmprojExactBytes = p.mmprojFile.flatMap { OfflineBundle.exactBytes[$0] }
    }
}

extension GenerationOptions {
    public init(profile p: EngineProfile) {
        self.init()
        maxNewTokens = p.maxNewTokens
    }
}

// MARK: - Files on the phone

public enum OfflineBundle {
    public static var documents: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }
    public static var datasets: URL { documents.appendingPathComponent("datasets", isDirectory: true) }

    /// Must match phone/ios/models.json (HF tree API sizes).
    static let exactBytes: [String: Int64] = [
        "Ministral-3-3B-Instruct-2512-Q4_K_M.gguf": 2_147_023_008,
        "mmproj-Ministral-3-3B-Instruct-2512-Q8_0.gguf": 448_285_088,
        "Ministral-3-3B-Instruct-2512-Q3_K_M.gguf": 1_795_552_544,
    ]

    /// A model file counts as present only at its exact size (a half-finished copy is "missing").
    public static func isPresent(_ file: String) -> Bool {
        let url = documents.appendingPathComponent(file)
        guard let size = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber else { return false }
        if let exact = exactBytes[file] { return size.int64Value == exact }
        return size.int64Value > 0
    }

    public static func filesPresent(for p: EngineProfile) -> Bool {
        guard let m = p.modelFile, isPresent(m) else { return false }
        return p.mmprojFile.map(isPresent) ?? true
    }

    /// The richest tier that both fits in memory (EngineProfile.select) and has its files in Documents/.
    /// Call before loading anything, so os_proc_available_memory() is the cold-launch number.
    public static func selectProfile(availableBytes: UInt64 = UInt64(os_proc_available_memory()),
                                     machine: String = EngineProfile.machineIdentifier()) -> EngineProfile {
        let byMemory = EngineProfile.select(availableBytes: availableBytes, machine: machine)
        if byMemory.tier == .speechOnly { return byMemory }
        let order: [EngineProfile] = [.full, .lean, .tight, .textOnly]
        let start = order.firstIndex { $0.tier == byMemory.tier } ?? 0
        var skipped: [String] = []
        for var p in order[start...] {
            if filesPresent(for: p) {
                p.reason = skipped.isEmpty ? byMemory.reason
                    : "\(p.reason); files missing for \(skipped.joined(separator: ", ")) (\(machine))"
                return p
            }
            skipped.append(p.tier.rawValue)
        }
        var s = EngineProfile.speechOnly
        s.reason = "no model files in Documents/ (run scripts/push_ios.sh) (\(machine))"
        return s
    }

    public struct DataProblem: Sendable, CustomStringConvertible {
        public let path: String, expectedBytes: Int64, actualBytes: Int64?
        public var description: String {
            actualBytes.map { "\(path): \($0) B, expected \(expectedBytes) B" } ?? "\(path): missing"
        }
    }

    private struct Manifest: Decodable {
        struct File: Decodable { let path: String; let bytes: Int64; let sha256: String }
        let files: [File]
    }

    /// Checks Documents/datasets/ against its manifest.json by size (fast). Empty result = complete.
    /// Throws if the manifest itself is missing, i.e. the data was never pushed.
    public static func verifyDatasets() throws -> [DataProblem] {
        let data = try Data(contentsOf: datasets.appendingPathComponent("manifest.json"))
        let m = try JSONDecoder().decode(Manifest.self, from: data)
        return m.files.compactMap { f in
            let url = datasets.appendingPathComponent(f.path)
            let size = ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber)?.int64Value
            return size == f.bytes ? nil : DataProblem(path: f.path, expectedBytes: f.bytes, actualBytes: size)
        }
    }

    /// URL of a bundle file by its manifest path, e.g. "map/london.pmtiles" or "pois/london_pois.sqlite".
    public static func dataURL(_ path: String) -> URL { datasets.appendingPathComponent(path) }
}

// MARK: - Foraging (same prompt, schema and safety policy as foraging/identify.py on the hub)

public enum ForagingVerdict: String, Sendable {
    case doNotEat = "DO_NOT_EAT"
    case unsureDoNotEat = "UNSURE_DO_NOT_EAT"
    case expertCheckRequired = "EXPERT_CHECK_REQUIRED"
    case checkThenEdible = "CHECK_THEN_EDIBLE"

    public var headline: String {
        switch self {
        case .doNotEat: return "DO NOT EAT."
        case .unsureDoNotEat: return "Not sure what this is. Do not eat it."
        case .expertCheckRequired: return "Do not eat on this ID alone. Wild mushrooms need an expert to check them in person."
        case .checkThenEdible: return "Probably edible, but only if every check below is true."
        }
    }
}

public struct ForagingPrediction: Decodable, Sendable {
    public struct Candidate: Decodable, Sendable { public let species_id: String; public let confidence: Double }
    public let subject: String
    public let image_quality: String
    public let observations: String
    public let candidates: [Candidate]
}

public struct ForagingResult: Sendable {
    public let verdict: ForagingVerdict
    public let speciesID: String?
    public let confidence: Double
    public let possibleDangers: [String]
    public let prediction: ForagingPrediction
    public let explanation: String          // deterministic text from species.json, never model-written
    public let generation: GenerationResult?   // nil when verdict() is called on a prediction directly
}

public struct ForagingTask: Sendable {
    struct PromptFile: Decodable {
        struct Sampling: Decodable { let temperature: Float; let max_new_tokens: Int }
        struct Policy: Decodable { let danger_conf: Double; let min_conf: Double; let min_conf_deadly_lookalike: Double }
        let version: Int; let system_prompt: String; let user_prompt: String
        let sampling: Sampling; let policy: Policy
    }
    public struct Species: Decodable, Sendable {
        public struct Lookalike: Decodable, Sendable { public let id: String?; public let name: String?; public let how_to_tell: String? }
        public let id: String, kind: String, scientific_name: String, common_names: [String], edibility: String
        public let key_features: [String], lookalikes: [Lookalike]
        public let preparation: String?, notes: String?
        var name: String { common_names.first ?? id }
    }
    private struct SpeciesFile: Decodable { let species: [Species] }

    public let systemPrompt: String
    public let userPrompt: String
    public let grammar: String
    public let temperature: Float
    public let maxNewTokens: Int
    public let dangerConf: Double, minConf: Double, minConfDeadlyLookalike: Double
    public let species: [String: Species]

    /// Measured: the v1 system prompt is 1,501 tokens with the Ministral 3 tokenizer (Ollama on the hub,
    /// 2026-11-21). Scaled by length if the prompt file changes.
    static let measuredChars = 4918, measuredTokens = 1501
    public var promptTokens: Int { Int((Double(systemPrompt.count) * Double(Self.measuredTokens) / Double(Self.measuredChars)).rounded(.up)) + 16 }
    /// ~80 words of observations plus the JSON structure; below this the answer is likely cut off.
    public static let minAnswerTokens = 200

    /// Loads Documents/datasets/foraging/{vision_prompt.json, vision_prompt.gbnf, species.json}.
    public static func load(from dir: URL = OfflineBundle.dataURL("foraging")) throws -> ForagingTask {
        let p = try JSONDecoder().decode(PromptFile.self, from: Data(contentsOf: dir.appendingPathComponent("vision_prompt.json")))
        let g = try String(contentsOf: dir.appendingPathComponent("vision_prompt.gbnf"), encoding: .utf8)
        let s = try JSONDecoder().decode(SpeciesFile.self, from: Data(contentsOf: dir.appendingPathComponent("species.json")))
        return ForagingTask(systemPrompt: p.system_prompt, userPrompt: p.user_prompt, grammar: g,
                            temperature: p.sampling.temperature, maxNewTokens: p.sampling.max_new_tokens,
                            dangerConf: p.policy.danger_conf, minConf: p.policy.min_conf,
                            minConfDeadlyLookalike: p.policy.min_conf_deadly_lookalike,
                            species: Dictionary(uniqueKeysWithValues: s.species.map { ($0.id, $0) }))
    }

    /// Tokens left for the answer in this tier's context after prompt and image.
    public func answerBudget(_ p: EngineProfile) -> Int { min(maxNewTokens, p.nCtx - 16 - promptTokens - p.imageMaxTokens) }

    /// Needs vision and room for a full answer. Expected: full yes (~2,000 spare); lean marginal (~270 spare);
    /// tight and textOnly no. When false, send the photo question to the hub or tell the user it is unavailable.
    public func fits(_ p: EngineProfile) -> Bool { p.visionEnabled && answerBudget(p) >= Self.minAnswerTokens }

    public func options(for p: EngineProfile) -> GenerationOptions {
        var o = GenerationOptions()
        o.systemPrompt = systemPrompt
        o.temperature = temperature
        o.maxNewTokens = max(0, answerBudget(p))
        o.deadline = 60
        o.seed = 42
        return o
    }

    #if canImport(UIKit)
    public func identify(engine: MinistralEngine, image: UIImage, profile: EngineProfile,
                         onToken: (@Sendable (String) -> Void)? = nil) async throws -> ForagingResult {
        let r = try await engine.generate(prompt: userPrompt, image: image, grammar: grammar, options: options(for: profile), onToken: onToken)
        guard r.stopReason == .endOfGeneration else {
            throw EngineError.internalFailure("foraging answer incomplete (\(r.stopReason.rawValue))")
        }
        let pred = try JSONDecoder().decode(ForagingPrediction.self, from: Data(r.text.utf8))
        return verdict(pred, generation: r)
    }
    #endif

    private static let dangerous: Set<String> = ["deadly", "toxic"]

    /// Port of verdict() + explain() in foraging/identify.py for a single model. Keep the two in sync.
    public func verdict(_ pred: ForagingPrediction, generation: GenerationResult? = nil) -> ForagingResult {
        var dangers: [String: Double] = [:]
        for c in pred.candidates {
            if let sp = species[c.species_id], Self.dangerous.contains(sp.edibility), c.confidence >= dangerConf {
                dangers[sp.id] = max(dangers[sp.id] ?? 0, c.confidence)
            }
        }
        // _top(): highest confidence, first one on ties.
        var top = pred.candidates.first ?? .init(species_id: "unknown", confidence: 0)
        for c in pred.candidates where c.confidence > top.confidence { top = c }
        let sp = species[top.species_id]
        let conf = (top.confidence * 100).rounded() / 100
        let dangerIDs = dangers.keys.sorted { dangers[$0]! > dangers[$1]! }

        let deadlyLookalikes: [Species] = sp?.lookalikes.compactMap { $0.id.flatMap { species[$0] } }.filter { $0.edibility == "deadly" } ?? []
        let v: ForagingVerdict
        if !dangers.isEmpty { v = .doNotEat }
        else if sp == nil || pred.image_quality == "poor" { v = .unsureDoNotEat }
        else if Self.dangerous.contains(sp!.edibility) || sp!.edibility == "not_recommended" { v = .doNotEat }
        else if top.confidence < (deadlyLookalikes.isEmpty ? minConf : minConfDeadlyLookalike) { v = .unsureDoNotEat }
        else { v = sp!.kind == "fungus" ? .expertCheckRequired : .checkThenEdible }

        var lines = [v.headline]
        for d in dangerIDs {
            let s = species[d]!
            lines.append("Could be \(s.name) (\(s.scientific_name)), which is \(s.edibility.uppercased()). \(s.notes ?? "")"
                .trimmingCharacters(in: .whitespaces))
        }
        if let sp {
            if !deadlyLookalikes.isEmpty && v != .doNotEat {
                lines.append("Photos cannot rule out: " + deadlyLookalikes.map { "\($0.name) (DEADLY)" }.joined(separator: ", ") + ".")
            }
            lines.append("Best match: \(sp.name) (\(sp.scientific_name)), \(sp.edibility.replacingOccurrences(of: "_", with: " ")), "
                         + "agreement confidence \(Int((conf * 100).rounded()))%.")
            if v == .checkThenEdible || v == .expertCheckRequired {
                lines.append("Check all of these: " + sp.key_features.joined(separator: "; ") + ".")
                for l in sp.lookalikes {
                    let ls = l.id.flatMap { species[$0] }
                    let name = ls.map { "\($0.name) (\($0.edibility))" } ?? (l.name ?? "")
                    lines.append("Lookalike: \(name). \(l.how_to_tell ?? "")".trimmingCharacters(in: .whitespaces))
                }
                if let prep = sp.preparation, !prep.isEmpty { lines.append("Preparation: " + prep) }
            }
        }
        lines.append("AI-generated, not verified. If anyone has eaten something and feels unwell, call 999 or NHS 111 and keep a sample.")
        return ForagingResult(verdict: v, speciesID: sp?.id, confidence: conf, possibleDangers: dangerIDs,
                              prediction: pred, explanation: lines.joined(separator: "\n"), generation: generation)
    }
}

// MARK: - Speech (OS on-device models, nothing to copy)

#if canImport(Speech)
public enum OfflineSpeech {
    public static let locale = Locale(identifier: "en-GB")

    /// nil if the en-GB on-device recognizer is unavailable: enable Dictation (Settings > General > Keyboard)
    /// with internet once so iOS downloads the model, then check `supportsOnDeviceRecognition` again offline.
    public static func recognizer() -> SFSpeechRecognizer? {
        guard let r = SFSpeechRecognizer(locale: locale), r.supportsOnDeviceRecognition else { return nil }
        return r
    }

    /// Never falls back to Apple's servers: with no network that would fail anyway, and it keeps audio on the phone.
    public static func request() -> SFSpeechAudioBufferRecognitionRequest {
        let q = SFSpeechAudioBufferRecognitionRequest()
        q.requiresOnDeviceRecognition = true
        q.shouldReportPartialResults = true
        q.addsPunctuation = true
        return q
    }
}
#endif
