// MinistralEngine.swift -- on-device Ministral 3 3B (vision) via llama.cpp b12606 (`import llama`).
// NOT COMPILED. Written on Linux against the b12606 headers only; expect to fix typos in Xcode.
//
// Threading: every llama/mtmd call runs on one serial queue (`queue`). Public API is async.
// Caveat: llama.h documents the abort callback as CPU-only. On Metal, cancel/deadline are
// honoured between tokens (and between prefill chunks if the backend returns), but an
// in-flight image encode / prefill batch cannot be interrupted.
import Foundation
import CryptoKit
import os
import llama
#if canImport(UIKit)
import UIKit
#endif

// MARK: - Public types

public struct EngineConfig: Sendable {
    public var modelURL: URL
    public var mmprojURL: URL
    public var nCtx = 4096
    public var nBatch = 512
    public var imageMaxTokens = 512
    public var maxImageSide = 640            // used by the CGImage/UIImage convenience overloads
    public var minHeadroomBytes: Int64 = 1_200_000_000

    /// Nominal sizes in bytes; checked within +-10% unless an exact size is given.
    public var modelNominalBytes: Int64 = 2_150_000_000
    public var mmprojNominalBytes: Int64 = 450_000_000
    public var modelExactBytes: Int64? = nil
    public var mmprojExactBytes: Int64? = nil

    /// Default projector: ggml-org Q8_0. Alternative for quality comparison:
    /// mistralai BF16 (`Ministral-3-3B-Instruct-2512-BF16-mmproj.gguf`, 0.84 GB,
    /// sha256 70ca26e41ecea9da997e2887462ad68b848fbf64da011ff4107bbe7353519ee0, ~840_000_000 bytes).
    public static let defaultModelFile = "Ministral-3-3B-Instruct-2512-Q4_K_M.gguf"
    public static let defaultModelSHA256 = "9ed150d4367e68df0ac8e1540f6ddc65b42d0ee26378329d1ecbca60f93fc5f8"
    public static let defaultMmprojFile = "mmproj-Ministral-3-3B-Instruct-2512-Q8_0.gguf"
    public static let defaultMmprojSHA256 = "57af826536cde496dde1e8343b8e72c89fdbd89084d58e18eb391ef34c39c9f2"
    public var modelSHA256 = EngineConfig.defaultModelSHA256
    public var mmprojSHA256 = EngineConfig.defaultMmprojSHA256
    /// Streaming SHA-256 (cached by size+mtime). Slow on first launch; off by default.
    public var verifySHA256 = false

    /// Files in Documents/ (copied there via Finder file sharing).
    public init(modelFile: String = defaultModelFile, mmprojFile: String = defaultMmprojFile) {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        modelURL = docs.appendingPathComponent(modelFile)
        mmprojURL = docs.appendingPathComponent(mmprojFile)
    }
}

public struct GenerationOptions: Sendable {
    public static let defaultSystemPrompt =
        "You are a helpful, concise assistant running offline on a phone. Answer briefly and accurately."
    public var systemPrompt = GenerationOptions.defaultSystemPrompt   // always non-empty (see below)
    public var maxNewTokens = 256
    public var deadline: TimeInterval = 30
    public var seed: UInt32 = .max          // LLAMA_DEFAULT_SEED = random
    public init() {}
}

public enum StopReason: String, Sendable { case endOfGeneration, maxTokens, contextFull, cancelled, deadline }

public struct Timings: Sendable {
    public var loadSeconds = 0.0            // engine load (copied from load())
    public var prefillSeconds = 0.0         // tokenize + image encode + prefill
    public var timeToFirstToken = 0.0       // request start -> first token
    public var decodeTokensPerSecond = 0.0
    public var totalSeconds = 0.0
}

public struct GenerationResult: Sendable {
    public var text = ""
    public var stopReason = StopReason.endOfGeneration
    public var promptTokens = 0             // mtmd_helper_get_n_tokens (text + image)
    public var imageTokens = 0
    public var generatedTokens = 0
    public var timings = Timings()
    public var peakFootprintBytes: UInt64 = 0
    public var thermalState = ProcessInfo.ThermalState.nominal
}

public enum EngineError: Error, LocalizedError {
    case fileMissing(String), sizeMismatch(String, expected: Int64, actual: Int64), checksumMismatch(String)
    case insufficientMemory(available: Int64, required: Int64)
    case thermalCritical, notReady, busy, backgrounded
    case modelLoadFailed, contextInitFailed, projectorLoadFailed, projectorHasNoVision
    case imageConversionFailed, tokenizeFailed(Int32), promptTooLong(tokens: Int, limit: Int)
    case prefillFailed(Int32), decodeFailed(Int32), invalidGrammar, internalFailure(String)

    public var errorDescription: String? {
        switch self {
        case .fileMissing(let f): return "Model file missing: \(f). Copy it via Finder file sharing."
        case .sizeMismatch(let f, let e, let a): return "\(f): size \(a) B, expected ~\(e) B (incomplete copy?)"
        case .checksumMismatch(let f): return "\(f): SHA-256 mismatch"
        case .insufficientMemory(let a, let r): return "Only \(a / 1_000_000) MB available, need \(r / 1_000_000) MB"
        case .thermalCritical: return "Device thermal state is critical"
        case .notReady: return "Engine not loaded"
        case .busy: return "Another request is running"
        case .backgrounded: return "App is not active; GPU work refused"
        case .modelLoadFailed: return "llama_model_load_from_file failed"
        case .contextInitFailed: return "llama_init_from_model failed"
        case .projectorLoadFailed: return "mtmd_init_from_file failed"
        case .projectorHasNoVision: return "Projector has no vision support"
        case .imageConversionFailed: return "Image conversion failed"
        case .tokenizeFailed(let c): return "mtmd_tokenize failed (\(c))"
        case .promptTooLong(let t, let l): return "Prompt is \(t) tokens, limit \(l)"
        case .prefillFailed(let c): return "Prefill failed (\(c))"
        case .decodeFailed(let c): return "llama_process failed (\(c))"
        case .invalidGrammar: return "GBNF grammar failed to parse"
        case .internalFailure(let s): return s
        }
    }
}

// MARK: - Engine

public final class MinistralEngine: @unchecked Sendable {
    public let config: EngineConfig
    public private(set) var loadSeconds = 0.0
    private let log = Logger(subsystem: "MinistralKit", category: "engine")
    private let queue = DispatchQueue(label: "ministral.llama", qos: .userInitiated)

    // Only touched on `queue` (and freed in deinit).
    private var model: OpaquePointer?     // llama_model *
    private var ctx: OpaquePointer?       // llama_context *
    private var mctx: OpaquePointer?      // mtmd_context *
    private var vocab: OpaquePointer?     // const llama_vocab *

    private struct State { var loaded = false, loading = false, busy = false, suspended = false; var abort: AbortFlag? }
    private let state = OSAllocatedUnfairLock(initialState: State())
    private var observers: [NSObjectProtocol] = []

    public init(config: EngineConfig) {
        self.config = config
        #if canImport(UIKit)
        let nc = NotificationCenter.default
        // iOS kills apps that submit GPU work from the background: cancel on resign, refuse until active.
        observers.append(nc.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: nil) { [weak self] _ in
            self?.state.withLock { $0.suspended = true }
            self?.cancel()
        })
        observers.append(nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil) { [weak self] _ in
            self?.state.withLock { $0.suspended = false }
        })
        // Memory warning: cancel the request but keep the model loaded (call unload() to drop it).
        observers.append(nc.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: nil) { [weak self] _ in
            self?.log.warning("memory warning: cancelling request")
            self?.cancel()
        })
        #endif
    }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
        freeAll()
    }

    public var isReady: Bool { state.withLock { $0.loaded && !$0.suspended } }

    /// Cancels the running request (if any). Safe from any thread.
    public func cancel() { state.withLock { $0.abort }?.set(.cancelled) }

    public func unload() async {
        cancel()
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            queue.async { self.freeAll(); self.state.withLock { $0.loaded = false }; c.resume() }
        }
    }

    // MARK: Load

    /// Loads model + projector off the main thread. `progress` is 0...1 with a phase label.
    public func load(progress: (@Sendable (Double, String) -> Void)? = nil) async throws {
        try state.withLock { s in
            if s.loaded { return }
            if s.loading || s.busy { throw EngineError.busy }
            s.loading = true
        }
        if isLoaded { return }
        defer { state.withLock { $0.loading = false } }
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            queue.async {
                let t0 = Date()
                let r = Result { try self.loadSync(progress ?? { _, _ in }) }
                if case .success = r {
                    self.loadSeconds = Date().timeIntervalSince(t0)
                    self.state.withLock { $0.loaded = true }
                }
                c.resume(with: r)
            }
        }
    }

    private var isLoaded: Bool { state.withLock { $0.loaded } }

    private static let backendInit: Void = llama_backend_init()

    private func loadSync(_ progress: @escaping @Sendable (Double, String) -> Void) throws {
        if ProcessInfo.processInfo.thermalState == .critical { throw EngineError.thermalCritical }
        progress(0, "checking files")
        let m = try checkFile(config.modelURL, nominal: config.modelNominalBytes, exact: config.modelExactBytes, sha: config.modelSHA256, progress: { progress(0.05 + 0.1 * $0, "hashing model") })
        let p = try checkFile(config.mmprojURL, nominal: config.mmprojNominalBytes, exact: config.mmprojExactBytes, sha: config.mmprojSHA256, progress: { progress(0.15 + 0.05 * $0, "hashing projector") })
        // Refuse early rather than get jetsam-killed. (mmap'd weights still count against us.)
        let avail = Int64(os_proc_available_memory())
        let need = m + p + config.minHeadroomBytes
        if avail > 0 && avail < need { throw EngineError.insufficientMemory(available: avail, required: need) }
        log.info("available memory \(avail) B, need \(need) B, thermal \(ProcessInfo.processInfo.thermalState.rawValue)")

        _ = Self.backendInit

        let box = ProgressBox { progress(0.2 + 0.6 * Double($0), "loading model") }
        var mp = llama_model_default_params()
        mp.n_gpu_layers = -1                 // all layers on Metal
        mp.load_mode = LLAMA_LOAD_MODE_MMAP
        mp.progress_callback = { p, ud in
            if let ud { Unmanaged<ProgressBox>.fromOpaque(ud).takeUnretainedValue().report(p) }
            return true
        }
        mp.progress_callback_user_data = Unmanaged.passUnretained(box).toOpaque()
        let mdl: OpaquePointer? = withExtendedLifetime(box) { llama_model_load_from_file(config.modelURL.path, mp) }
        guard let mdl else { throw EngineError.modelLoadFailed }
        model = mdl
        vocab = llama_model_get_vocab(mdl)

        progress(0.8, "creating context")
        var cp = llama_context_default_params()
        cp.n_ctx = UInt32(config.nCtx)
        cp.n_batch = UInt32(config.nBatch)
        cp.n_ubatch = UInt32(min(config.nBatch, 512))
        cp.n_seq_max = 1
        let threads = Int32(min(4, max(2, ProcessInfo.processInfo.activeProcessorCount - 2)))
        cp.n_threads = threads; cp.n_threads_batch = threads
        cp.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_AUTO
        cp.no_perf = true
        guard let c = llama_init_from_model(mdl, cp) else { throw EngineError.contextInitFailed }
        ctx = c

        progress(0.85, "loading projector")
        var mmp = mtmd_context_params_default()
        mmp.use_gpu = true
        mmp.n_threads = threads
        mmp.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_AUTO
        mmp.image_max_tokens = Int32(config.imageMaxTokens)
        mmp.warmup = true                    // pay Metal shader compile at load, not first request
        mmp.print_timings = false
        guard let mc = mtmd_init_from_file(config.mmprojURL.path, mdl, mmp) else { throw EngineError.projectorLoadFailed }
        mctx = mc
        guard mtmd_support_vision(mc) else { throw EngineError.projectorHasNoVision }
        progress(1, "ready")
    }

    /// Returns the file size. Size check is +-10% of nominal (the sources quote approximate GB).
    private func checkFile(_ url: URL, nominal: Int64, exact: Int64?, sha: String, progress: @escaping (Double) -> Void) throws -> Int64 {
        let name = url.lastPathComponent
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = (attrs[.size] as? NSNumber)?.int64Value else { throw EngineError.fileMissing(name) }
        if let exact { if size != exact { throw EngineError.sizeMismatch(name, expected: exact, actual: size) } }
        else if abs(size - nominal) > nominal / 10 { throw EngineError.sizeMismatch(name, expected: nominal, actual: size) }
        if config.verifySHA256 {
            let mtime = (attrs[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
            let key = "ministral.sha.\(name).\(size).\(Int(mtime))"
            let got: String
            if let cached = UserDefaults.standard.string(forKey: key) { got = cached }
            else {
                got = try Self.sha256(url, size: size, progress: progress)
                UserDefaults.standard.set(got, forKey: key)
            }
            if got != sha { throw EngineError.checksumMismatch(name) }
        }
        return size
    }

    private static func sha256(_ url: URL, size: Int64, progress: (Double) -> Void) throws -> String {
        let fh = try FileHandle(forReadingFrom: url)
        defer { try? fh.close() }
        var hasher = SHA256()
        var done: Int64 = 0
        while let chunk = try fh.read(upToCount: 8 << 20), !chunk.isEmpty {
            hasher.update(data: chunk)
            done += Int64(chunk.count)
            progress(Double(done) / Double(max(size, 1)))
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func freeAll() {
        if let mctx { mtmd_free(mctx) }
        if let ctx { llama_free(ctx) }
        if let model { llama_model_free(model) }
        mctx = nil; ctx = nil; model = nil; vocab = nil
    }

    // MARK: Generate

    #if canImport(UIKit)
    public func generate(prompt: String, image: UIImage?, grammar: String? = nil,
                         options: GenerationOptions = .init(),
                         onToken: (@Sendable (String) -> Void)? = nil) async throws -> GenerationResult {
        var rgb: RGBImage?
        if let image {
            rgb = ImagePrep.rgb(from: image, maxSide: config.maxImageSide)
            if rgb == nil { throw EngineError.imageConversionFailed }
        }
        return try await generate(prompt: prompt, rgb: rgb, grammar: grammar, options: options, onToken: onToken)
    }
    #endif

    public func generate(prompt: String, cgImage: CGImage?, grammar: String? = nil,
                         options: GenerationOptions = .init(),
                         onToken: (@Sendable (String) -> Void)? = nil) async throws -> GenerationResult {
        var rgb: RGBImage?
        if let cgImage {
            rgb = ImagePrep.rgb(from: cgImage, maxSide: config.maxImageSide)
            if rgb == nil { throw EngineError.imageConversionFailed }
        }
        return try await generate(prompt: prompt, rgb: rgb, grammar: grammar, options: options, onToken: onToken)
    }

    /// Core entry point. One request at a time (a second concurrent call throws `.busy`).
    /// `onToken` is invoked on the engine's queue with valid UTF-8 text fragments.
    public func generate(prompt: String, rgb: RGBImage?, grammar: String? = nil,
                         options: GenerationOptions = .init(),
                         onToken: (@Sendable (String) -> Void)? = nil) async throws -> GenerationResult {
        let flag = AbortFlag()
        try state.withLock { s in
            guard s.loaded else { throw EngineError.notReady }
            if s.suspended { throw EngineError.backgrounded }
            if ProcessInfo.processInfo.thermalState == .critical { throw EngineError.thermalCritical }
            if s.busy || s.loading { throw EngineError.busy }
            s.busy = true; s.abort = flag
        }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (c: CheckedContinuation<GenerationResult, Error>) in
                queue.async {
                    let r = Result { try self.run(prompt, rgb, grammar, options, flag, onToken) }
                    self.state.withLock { $0.busy = false; $0.abort = nil }   // release before resuming
                    c.resume(with: r)
                }
            }
        } onCancel: { flag.set(.cancelled) }
    }

    /// Times mtmd_encode_chunk on its own (no prefill/decode). A CPU fallback of the vision
    /// encoder shows up here as multi-second times. Returns (seconds, imageTokens).
    public func probeImageEncode(rgb: RGBImage) async throws -> (seconds: Double, imageTokens: Int) {
        try state.withLock { s in
            guard s.loaded else { throw EngineError.notReady }
            if s.suspended { throw EngineError.backgrounded }
            if s.busy || s.loading { throw EngineError.busy }
            s.busy = true
        }
        return try await withCheckedThrowingContinuation { (c: CheckedContinuation<(seconds: Double, imageTokens: Int), Error>) in
            queue.async {
                let r = Result { () -> (seconds: Double, imageTokens: Int) in
                    let tk = try self.tokenize("x", rgb)
                    let t0 = Date()
                    for i in 0..<mtmd_input_chunks_size(tk.chunks) {
                        guard let ch = mtmd_input_chunks_get(tk.chunks, i),
                              mtmd_input_chunk_get_type(ch) == MTMD_INPUT_CHUNK_TYPE_IMAGE else { continue }
                        let rc = mtmd_encode_chunk(self.mctx, ch)
                        if rc != 0 { throw EngineError.prefillFailed(rc) }
                    }
                    return (Date().timeIntervalSince(t0), tk.imageTokens)
                }
                self.state.withLock { $0.busy = false }
                c.resume(with: r)
            }
        }
    }

    // MARK: Request internals (all on `queue`)

    private final class Tokenized {
        var chunks: OpaquePointer?        // mtmd_input_chunks *
        var bitmap: OpaquePointer?        // mtmd_bitmap *
        var imageTokens = 0
        var totalTokens = 0
        deinit {
            if let chunks { mtmd_input_chunks_free(chunks) }
            if let bitmap { mtmd_bitmap_free(bitmap) }
        }
    }

    /// Hand-renders the Ministral template:
    /// `[SYSTEM_PROMPT]sys[/SYSTEM_PROMPT][INST]<marker>text[/INST]` (BOS added by add_special).
    /// Control strings are stripped from caller text so mesh messages can't inject roles/images.
    private func tokenize(_ prompt: String, _ rgb: RGBImage?, system: String = GenerationOptions.defaultSystemPrompt) throws -> Tokenized {
        let marker = String(cString: mtmd_default_marker())
        func clean(_ s: String) -> String {
            var o = s
            // parse_special=true would turn these into control tokens, so strip them from untrusted text.
            for bad in ["[SYSTEM_PROMPT]", "[/SYSTEM_PROMPT]", "[INST]", "[/INST]", "<s>", "</s>",
                        "[IMG]", "[IMG_BREAK]", "[IMG_END]", "[TOOL_CALLS]", "[ARGS]",
                        "[AVAILABLE_TOOLS]", "[/AVAILABLE_TOOLS]", "[TOOL_RESULTS]", "[/TOOL_RESULTS]", marker] {
                o = o.replacingOccurrences(of: bad, with: "")
            }
            return o
        }
        let sys = clean(system).isEmpty ? GenerationOptions.defaultSystemPrompt : clean(system)
        let text = "[SYSTEM_PROMPT]\(sys)[/SYSTEM_PROMPT][INST]\(rgb != nil ? marker : "")\(clean(prompt))[/INST]"

        let tk = Tokenized()
        if let rgb {
            tk.bitmap = rgb.data.withUnsafeBufferPointer {
                mtmd_bitmap_init(UInt32(rgb.width), UInt32(rgb.height), $0.baseAddress)
            }
            if tk.bitmap == nil { throw EngineError.imageConversionFailed }
        }
        guard let chunks = mtmd_input_chunks_init() else { throw EngineError.internalFailure("chunks_init") }
        tk.chunks = chunks
        let bitmaps: [OpaquePointer?] = tk.bitmap.map { [$0] } ?? []
        let rc: Int32 = text.withCString { cstr in
            var inp = mtmd_input_text(text: cstr, text_len: text.utf8.count, add_special: true, parse_special: true)
            return bitmaps.withUnsafeBufferPointer { mtmd_tokenize(mctx, chunks, &inp, $0.baseAddress, $0.count) }
        }
        guard rc == 0 else { throw EngineError.tokenizeFailed(rc) }
        tk.totalTokens = Int(mtmd_helper_get_n_tokens(chunks))
        for i in 0..<mtmd_input_chunks_size(chunks) {
            if let ch = mtmd_input_chunks_get(chunks, i), mtmd_input_chunk_get_type(ch) == MTMD_INPUT_CHUNK_TYPE_IMAGE {
                tk.imageTokens += Int(mtmd_input_chunk_get_n_tokens(ch))
            }
        }
        return tk
    }

    private func makeSampler(grammar: String?, seed: UInt32) throws -> UnsafeMutablePointer<llama_sampler> {
        guard let chain = llama_sampler_chain_init(llama_sampler_chain_default_params()) else {
            throw EngineError.internalFailure("sampler chain")
        }
        if let g = grammar, !g.isEmpty {
            guard let gs = llama_sampler_init_grammar(vocab, g, "root") else {
                llama_sampler_free(chain); throw EngineError.invalidGrammar
            }
            llama_sampler_chain_add(chain, gs)     // grammar first, so it masks logits before anything else
        }
        llama_sampler_chain_add(chain, llama_sampler_init_penalties(llama_vocab_n_tokens(vocab), 64, 1.1, 0, 0))
        llama_sampler_chain_add(chain, llama_sampler_init_top_k(40))
        llama_sampler_chain_add(chain, llama_sampler_init_top_p(0.95, 1))
        llama_sampler_chain_add(chain, llama_sampler_init_temp(0.1))
        llama_sampler_chain_add(chain, llama_sampler_init_dist(seed))
        return chain
    }

    private func pieceBytes(_ tok: llama_token) -> [UInt8] {
        var buf = [CChar](repeating: 0, count: 64)
        var n = llama_token_to_piece(vocab, tok, &buf, Int32(buf.count), 0, false)
        if n < 0 {
            buf = [CChar](repeating: 0, count: Int(-n))
            n = llama_token_to_piece(vocab, tok, &buf, Int32(buf.count), 0, false)
        }
        return buf.prefix(Int(max(n, 0))).map { UInt8(bitPattern: $0) }
    }

    private func run(_ prompt: String, _ rgb: RGBImage?, _ grammar: String?, _ opts: GenerationOptions,
                     _ flag: AbortFlag, _ onToken: (@Sendable (String) -> Void)?) throws -> GenerationResult {
        guard let ctx, let mctx, vocab != nil else { throw EngineError.notReady }
        let t0 = Date()
        var res = GenerationResult()
        res.timings.loadSeconds = loadSeconds
        var peak = Footprint.current()

        // Deadline: sets the same flag the abort callback reads; also checked each token.
        let timer = DispatchWorkItem { flag.set(.deadline) }
        DispatchQueue.global().asyncAfter(deadline: .now() + opts.deadline, execute: timer)
        defer { timer.cancel() }

        // Abort callback (CPU-only per llama.h). `flag` outlives the request via withExtendedLifetime.
        llama_set_abort_callback(ctx, { ud in
            guard let ud else { return false }
            return Unmanaged<AbortFlag>.fromOpaque(ud).takeUnretainedValue().isSet
        }, Unmanaged.passUnretained(flag).toOpaque())
        defer { llama_set_abort_callback(ctx, nil, nil) }

        return try withExtendedLifetime(flag) {
            // Single-turn: wipe the KV cache every request, never keep image history.
            llama_memory_clear(llama_get_memory(ctx), true)

            let tk = try tokenize(prompt, rgb, system: opts.systemPrompt)
            res.promptTokens = tk.totalTokens
            res.imageTokens = tk.imageTokens
            let limit = config.nCtx - 16
            if tk.totalTokens >= limit { throw EngineError.promptTooLong(tokens: tk.totalTokens, limit: limit) }

            func finish(_ reason: StopReason) -> GenerationResult {
                res.stopReason = reason
                res.peakFootprintBytes = max(peak, Footprint.current())
                res.thermalState = ProcessInfo.processInfo.thermalState
                res.timings.totalSeconds = Date().timeIntervalSince(t0)
                log.info("done: \(reason.rawValue) gen=\(res.generatedTokens) total=\(res.timings.totalSeconds)s thermal=\(res.thermalState.rawValue) peak=\(res.peakFootprintBytes / 1_000_000)MB")
                return res
            }

            var nPast: llama_pos = 0
            let erc = mtmd_helper_eval_chunks(mctx, ctx, tk.chunks, 0, 0, Int32(config.nBatch), true, &nPast)
            res.timings.prefillSeconds = Date().timeIntervalSince(t0)
            peak = max(peak, Footprint.current())
            if let r = flag.reason { return finish(r == .deadline ? .deadline : .cancelled) }
            guard erc == 0 else { throw EngineError.prefillFailed(erc) }

            let smpl = try makeSampler(grammar: grammar, seed: opts.seed)
            defer { llama_sampler_free(smpl) }
            guard let batch = llama_batch_ext_init(ctx) else { throw EngineError.internalFailure("batch_ext_init") }
            defer { llama_batch_ext_free(batch) }

            var utf8 = UTF8Assembler()
            var pos = nPast
            var tFirst: Date?
            var reason = StopReason.maxTokens

            while true {
                if let r = flag.reason { reason = r == .deadline ? .deadline : .cancelled; break }
                if res.generatedTokens >= opts.maxNewTokens { reason = .maxTokens; break }
                if Int(pos) >= config.nCtx { reason = .contextFull; break }

                let tok = llama_sampler_sample(smpl, ctx, -1)      // also accepts the token
                if llama_vocab_is_eog(vocab, tok) { reason = .endOfGeneration; break }
                if tFirst == nil { tFirst = Date(); res.timings.timeToFirstToken = tFirst!.timeIntervalSince(t0) }
                res.generatedTokens += 1
                let s = utf8.push(pieceBytes(tok))
                if !s.isEmpty { res.text += s; onToken?(s) }

                llama_batch_ext_clear(batch)
                let idx = llama_batch_ext_add_token(batch, 0, tok)
                var p = pos
                guard idx >= 0, llama_batch_ext_set_pos(batch, idx, &p),
                      llama_batch_ext_set_output_logits(batch, idx, true) else {
                    throw EngineError.internalFailure("batch add failed (\(idx))")
                }
                let rc = llama_process(ctx, LLAMA_PROCESS_TYPE_DECODE, batch)
                if rc == 2 { reason = flag.reason == .deadline ? .deadline : .cancelled; break }
                if rc == 1 { reason = .contextFull; break }
                if rc != 0 { throw EngineError.decodeFailed(rc) }
                pos += 1
                if res.generatedTokens % 8 == 0 { peak = max(peak, Footprint.current()) }
            }
            let tail = utf8.flush()
            if !tail.isEmpty { res.text += tail; onToken?(tail) }
            if let tFirst, res.generatedTokens > 1 {
                res.timings.decodeTokensPerSecond = Double(res.generatedTokens - 1) / max(Date().timeIntervalSince(tFirst), 1e-6)
            }
            return finish(reason)
        }
    }
}

// MARK: - Helpers

/// Shared between the request and the C abort callback (passed through Unmanaged).
final class AbortFlag: @unchecked Sendable {
    enum Reason { case cancelled, deadline }
    private let lock = OSAllocatedUnfairLock<Reason?>(initialState: nil)
    var isSet: Bool { lock.withLock { $0 != nil } }
    var reason: Reason? { lock.withLock { $0 } }
    func set(_ r: Reason) { lock.withLock { if $0 == nil { $0 = r } } }   // first reason wins
}

private final class ProgressBox {
    let report: (Float) -> Void
    init(_ r: @escaping (Float) -> Void) { report = r }
}

/// Buffers bytes so a multi-byte UTF-8 character split across tokens is never emitted half-way.
struct UTF8Assembler {
    private var buf: [UInt8] = []
    mutating func push(_ bytes: [UInt8]) -> String {
        buf += bytes
        var cut = buf.count
        var i = buf.count - 1, back = 0
        while i >= 0 && back < 4 {
            let c = buf[i]
            if c & 0xC0 == 0x80 { i -= 1; back += 1; continue }       // continuation byte: keep looking back
            let need = c >= 0xF0 ? 4 : c >= 0xE0 ? 3 : c >= 0xC0 ? 2 : 1
            if need > buf.count - i { cut = i }                        // lead byte whose tail hasn't arrived
            break
        }
        let s = String(decoding: buf[..<cut], as: UTF8.self)
        buf.removeFirst(cut)
        return s
    }
    mutating func flush() -> String { defer { buf.removeAll() }; return String(decoding: buf, as: UTF8.self) }
}

enum Footprint {
    /// task_vm_info.phys_footprint: the number jetsam actually judges.
    static func current() -> UInt64 {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let kr = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        return kr == KERN_SUCCESS ? info.phys_footprint : 0
    }
}
