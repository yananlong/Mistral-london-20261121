// ministral_jni.cpp -- on-device Ministral 3 3B (vision) via llama.cpp b12606, CPU only.
// UNCOMPILED. Written on Linux against the b12606 headers (llama.h, mtmd.h, mtmd-helper.h) only.
// Mirrors phone/ios/MinistralKit/MinistralEngine.swift.
//
// Threading: every call below is made from ONE Kotlin thread (single-thread dispatcher), except
// nativeCancel which only touches atomics. One request at a time (second one throws E_BUSY).
// Cancel / deadline: llama_set_abort_callback (works on CPU; interrupts prefill and decode graphs).
// UNCONFIRMED: whether the mtmd image encoder also honours it. Assume cancel lands after encode.
#include <jni.h>
#include <android/log.h>
#include <sched.h>
#include <unistd.h>
#include <sys/types.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "llama.h"
#include "ggml-cpu.h"
#include "mtmd.h"
#include "mtmd-helper.h"

#define TAG "ministral"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

namespace {

using clk = std::chrono::steady_clock;

int64_t now_ns() {
    return std::chrono::duration_cast<std::chrono::nanoseconds>(clk::now().time_since_epoch()).count();
}
double secs_since(clk::time_point t0) {
    return std::chrono::duration<double>(clk::now() - t0).count();
}

enum AbortReason { ABORT_NONE = 0, ABORT_CANCELLED = 1, ABORT_DEADLINE = 2 };
// Must match StopReason in MinistralEngine.kt
enum Stop { STOP_EOG = 0, STOP_MAX_TOKENS = 1, STOP_CONTEXT_FULL = 2, STOP_CANCELLED = 3, STOP_DEADLINE = 4 };

struct Engine {
    llama_model *    model  = nullptr;
    llama_context *  ctx    = nullptr;
    mtmd_context *   mctx   = nullptr;   // null in textOnly tier
    const llama_vocab * vocab = nullptr;
    ggml_threadpool_t tp    = nullptr;
    int n_ctx = 0, n_batch = 0, n_threads = 4;
    std::atomic<int>     abort_reason{ABORT_NONE};
    std::atomic<int64_t> deadline_ns{INT64_MAX};
    std::atomic<bool>    busy{false};
};

// ---------------------------------------------------------------- helpers

void throw_engine(JNIEnv * env, const std::string & msg) {
    jclass cls = env->FindClass("com/mistral/london/ministral/EngineException");
    if (!cls) { env->ExceptionClear(); cls = env->FindClass("java/lang/IllegalStateException"); }
    env->ThrowNew(cls, msg.c_str());
}

std::string jstr(JNIEnv * env, jstring s) {
    if (!s) return {};
    const char * c = env->GetStringUTFChars(s, nullptr);
    std::string out(c ? c : "");
    if (c) env->ReleaseStringUTFChars(s, c);
    return out;
}

void log_cb(ggml_log_level level, const char * text, void *) {
    int p = ANDROID_LOG_INFO;
    if (level == GGML_LOG_LEVEL_ERROR) p = ANDROID_LOG_ERROR;
    else if (level == GGML_LOG_LEVEL_WARN) p = ANDROID_LOG_WARN;
    else if (level == GGML_LOG_LEVEL_DEBUG) p = ANDROID_LOG_DEBUG;
    __android_log_write(p, "llama", text);
}

bool abort_cb(void * ud) {
    auto * e = static_cast<Engine *>(ud);
    if (e->abort_reason.load(std::memory_order_relaxed) != ABORT_NONE) return true;
    if (now_ns() >= e->deadline_ns.load(std::memory_order_relaxed)) {
        int z = ABORT_NONE;
        e->abort_reason.compare_exchange_strong(z, ABORT_DEADLINE);
        return true;
    }
    return false;
}

// /proc/self/status: VmRSS (current) and VmHWM (peak), bytes.
void read_rss(uint64_t & rss, uint64_t & hwm) {
    rss = hwm = 0;
    FILE * f = fopen("/proc/self/status", "r");
    if (!f) return;
    char line[256];
    while (fgets(line, sizeof line, f)) {
        unsigned long long kb = 0;
        if (sscanf(line, "VmRSS: %llu kB", &kb) == 1) rss = kb * 1024ULL;
        else if (sscanf(line, "VmHWM: %llu kB", &kb) == 1) hwm = kb * 1024ULL;
    }
    fclose(f);
}

// Fastest `want` cores by cpuinfo_max_freq. Empty if sysfs is unreadable (then we do not pin).
std::vector<int> pick_fast_cores(int want) {
    long n = sysconf(_SC_NPROCESSORS_CONF);
    if (n <= 0 || n > 64) return {};
    std::vector<std::pair<long, int>> f;
    for (int i = 0; i < n; i++) {
        char path[96];
        snprintf(path, sizeof path, "/sys/devices/system/cpu/cpu%d/cpufreq/cpuinfo_max_freq", i);
        FILE * fp = fopen(path, "r");
        long khz = 0;
        if (fp) { if (fscanf(fp, "%ld", &khz) != 1) khz = 0; fclose(fp); }
        f.emplace_back(khz, i);
    }
    std::sort(f.begin(), f.end(), [](auto & a, auto & b) {
        return a.first != b.first ? a.first > b.first : a.second > b.second;
    });
    if (f.empty() || f.front().first == 0) return {};
    std::vector<int> out;
    for (int i = 0; i < want && i < (int) f.size(); i++) out.push_back(f[i].second);
    std::sort(out.begin(), out.end());
    return out;
}

void replace_all(std::string & s, const std::string & from) {
    if (from.empty()) return;
    size_t p = 0;
    while ((p = s.find(from, p)) != std::string::npos) s.erase(p, from.size());
}

// Same list as Swift clean(). Looped until stable so "[IN" + "[INST]" + "ST]" cannot reassemble.
std::string clean(std::string s, const std::string & marker) {
    const std::vector<std::string> bad = {
        "[SYSTEM_PROMPT]", "[/SYSTEM_PROMPT]", "[INST]", "[/INST]", "<s>", "</s>",
        "[IMG]", "[IMG_BREAK]", "[IMG_END]", "[TOOL_CALLS]", "[ARGS]",
        "[AVAILABLE_TOOLS]", "[/AVAILABLE_TOOLS]", "[TOOL_RESULTS]", "[/TOOL_RESULTS]", marker};
    for (int guard = 0; guard < 8; guard++) {
        std::string before = s;
        for (auto & b : bad) replace_all(s, b);
        if (s == before) break;
    }
    return s;
}

// Buffers bytes so a multi-byte UTF-8 character split across tokens is never emitted half-way.
struct Utf8Assembler {
    std::string buf;
    // Returns the longest prefix of complete characters and keeps the incomplete tail.
    std::string push(const std::string & bytes) {
        buf += bytes;
        size_t cut = buf.size();
        size_t i = buf.size(), back = 0;
        while (i > 0 && back < 4) {
            i--; back++;
            unsigned char c = (unsigned char) buf[i];
            if ((c & 0xC0) == 0x80) continue;                         // continuation byte
            size_t need = c >= 0xF0 ? 4 : c >= 0xE0 ? 3 : c >= 0xC0 ? 2 : 1;
            if (need > buf.size() - i) cut = i;                      // lead byte whose tail has not arrived
            break;
        }
        std::string out = buf.substr(0, cut);
        buf.erase(0, cut);
        return out;
    }
    std::string flush() { std::string o; o.swap(buf); return o; }
};

std::string piece_bytes(const llama_vocab * vocab, llama_token tok) {
    char buf[64];
    int32_t n = llama_token_to_piece(vocab, tok, buf, sizeof buf, 0, false);
    if (n >= 0) return std::string(buf, (size_t) n);
    std::string big((size_t) -n, '\0');
    n = llama_token_to_piece(vocab, tok, big.data(), (int32_t) big.size(), 0, false);
    big.resize((size_t) std::max(n, 0));
    return big;
}

jbyteArray to_bytes(JNIEnv * env, const std::string & s) {
    jbyteArray a = env->NewByteArray((jsize) s.size());
    if (a && !s.empty()) env->SetByteArrayRegion(a, 0, (jsize) s.size(), reinterpret_cast<const jbyte *>(s.data()));
    return a;
}

// ---------------------------------------------------------------- tokenization

struct Tokenized {
    mtmd_input_chunks * chunks = nullptr;
    mtmd_bitmap *       bitmap = nullptr;
    std::vector<llama_token> text_tokens;   // text-only path
    int total = 0, image = 0;
    ~Tokenized() {
        if (chunks) mtmd_input_chunks_free(chunks);
        if (bitmap) mtmd_bitmap_free(bitmap);
    }
};

// Hand-rendered Ministral template: [SYSTEM_PROMPT]sys[/SYSTEM_PROMPT][INST]<marker>text[/INST]
// BOS comes from add_special=true. Control strings are stripped from caller text.
// Returns an error string ("" on success).
std::string tokenize_prompt(Engine * e, const std::string & system, const std::string & prompt,
                            const unsigned char * rgb, int w, int h, Tokenized & tk) {
    const bool has_img = rgb != nullptr;
    std::string marker = e->mctx ? std::string(mtmd_get_marker(e->mctx)) : std::string(mtmd_default_marker());
    std::string sys = clean(system, marker);
    if (sys.empty()) sys = "You are a helpful, concise assistant running offline on a phone. Answer briefly and accurately.";
    std::string text = "[SYSTEM_PROMPT]" + sys + "[/SYSTEM_PROMPT][INST]" + (has_img ? marker : std::string()) +
                       clean(prompt, marker) + "[/INST]";

    if (!e->mctx) {
        if (has_img) return "E_NO_VISION:projector not loaded in this tier";
        std::vector<llama_token> t(text.size() + 16);
        int32_t n = llama_tokenize(e->vocab, text.c_str(), (int32_t) text.size(), t.data(), (int32_t) t.size(), true, true);
        if (n < 0) {
            t.resize((size_t) -n);
            n = llama_tokenize(e->vocab, text.c_str(), (int32_t) text.size(), t.data(), (int32_t) t.size(), true, true);
        }
        if (n < 0) return "E_TOKENIZE:" + std::to_string(n);
        t.resize((size_t) n);
        tk.text_tokens = std::move(t);
        tk.total = n;
        return "";
    }

    if (has_img) {
        tk.bitmap = mtmd_bitmap_init((uint32_t) w, (uint32_t) h, rgb);
        if (!tk.bitmap) return "E_IMAGE:mtmd_bitmap_init failed";
    }
    tk.chunks = mtmd_input_chunks_init();
    if (!tk.chunks) return "E_INTERNAL:chunks_init";
    mtmd_input_text inp;
    inp.text = text.c_str();
    inp.text_len = text.size();
    inp.add_special = true;
    inp.parse_special = true;
    const mtmd_bitmap * bms[1] = {tk.bitmap};
    int32_t rc = mtmd_tokenize(e->mctx, tk.chunks, &inp, has_img ? bms : nullptr, has_img ? 1 : 0);
    if (rc != 0) return "E_TOKENIZE:" + std::to_string(rc);
    tk.total = (int) mtmd_helper_get_n_tokens(tk.chunks);
    size_t n = mtmd_input_chunks_size(tk.chunks);
    for (size_t i = 0; i < n; i++) {
        const mtmd_input_chunk * ch = mtmd_input_chunks_get(tk.chunks, i);
        if (ch && mtmd_input_chunk_get_type(ch) == MTMD_INPUT_CHUNK_TYPE_IMAGE)
            tk.image += (int) mtmd_input_chunk_get_n_tokens(ch);
    }
    return "";
}

// Text-only prefill with the non-deprecated batch API. Logits only on the last token.
int32_t prefill_text(Engine * e, const std::vector<llama_token> & toks, llama_pos & n_past) {
    llama_batch_ext * batch = llama_batch_ext_init(e->ctx);
    if (!batch) return -100;
    int32_t rc = 0;
    size_t i = 0;
    llama_pos pos = 0;
    while (i < toks.size()) {
        llama_batch_ext_clear(batch);
        size_t end = std::min(toks.size(), i + (size_t) e->n_batch);
        for (size_t j = i; j < end; j++) {
            int32_t idx = llama_batch_ext_add_token(batch, 0, toks[j]);
            llama_pos p = pos + (llama_pos)(j - i);
            if (idx < 0 || !llama_batch_ext_set_pos(batch, idx, &p)) { rc = -101; break; }
            if (j + 1 == toks.size() && !llama_batch_ext_set_output_logits(batch, idx, true)) { rc = -102; break; }
        }
        if (rc != 0) break;
        rc = llama_process(e->ctx, LLAMA_PROCESS_TYPE_DECODE, batch);
        if (rc != 0) break;
        pos += (llama_pos)(end - i);
        i = end;
    }
    llama_batch_ext_free(batch);
    n_past = pos;
    return rc;
}

llama_sampler * make_sampler(Engine * e, const std::string & grammar, uint32_t seed) {
    llama_sampler * chain = llama_sampler_chain_init(llama_sampler_chain_default_params());
    if (!chain) return nullptr;
    if (!grammar.empty()) {
        llama_sampler * g = llama_sampler_init_grammar(e->vocab, grammar.c_str(), "root");
        if (!g) { llama_sampler_free(chain); return nullptr; }
        llama_sampler_chain_add(chain, g);      // grammar first: masks logits before anything else
    }
    llama_sampler_chain_add(chain, llama_sampler_init_penalties(llama_vocab_n_tokens(e->vocab), 64, 1.1f, 0.0f, 0.0f));
    llama_sampler_chain_add(chain, llama_sampler_init_top_k(40));
    llama_sampler_chain_add(chain, llama_sampler_init_top_p(0.95f, 1));
    llama_sampler_chain_add(chain, llama_sampler_init_temp(0.1f));
    llama_sampler_chain_add(chain, llama_sampler_init_dist(seed));
    return chain;
}

void free_engine(Engine * e) {
    if (!e) return;
    if (e->mctx)  mtmd_free(e->mctx);
    if (e->ctx)   llama_free(e->ctx);
    if (e->tp)    ggml_threadpool_free(e->tp);
    if (e->model) llama_model_free(e->model);
    delete e;
}

}  // namespace

// ---------------------------------------------------------------- JNI
#define JNI(ret, name) extern "C" JNIEXPORT ret JNICALL Java_com_mistral_london_ministral_MinistralNative_##name

JNI(jstring, nativeSystemInfo)(JNIEnv * env, jobject) {
    llama_log_set(log_cb, nullptr);
    std::string s = llama_print_system_info();
    s += " | dotprod=" + std::to_string(ggml_cpu_has_dotprod()) +
         " i8mm=" + std::to_string(ggml_cpu_has_matmul_int8()) +
         " sve=" + std::to_string(ggml_cpu_has_sve()) +
         " fp16=" + std::to_string(ggml_cpu_has_fp16_va());
    return env->NewStringUTF(s.c_str());
}

// kvType: 0 = f16, 1 = q8_0.  flashAttn: -1 auto, 0 off, 1 on.  Returns an opaque handle.
JNI(jlong, nativeLoad)(JNIEnv * env, jobject, jstring jmodel, jstring jmmproj, jint nCtx, jint nBatch, jint nUbatch,
                       jint kvType, jint flashAttn, jint imageMaxTokens, jboolean warmup, jint nThreads,
                       jboolean pin, jboolean useMmap) {
    llama_log_set(log_cb, nullptr);
    mtmd_helper_log_set(log_cb, nullptr);   // also calls mtmd_log_set internally (mtmd-helper.h)
    static bool backend_ready = false;
    if (!backend_ready) { llama_backend_init(); backend_ready = true; }

    std::string model_path = jstr(env, jmodel), mmproj_path = jstr(env, jmmproj);
    auto * e = new Engine();
    e->n_ctx = nCtx; e->n_batch = nBatch; e->n_threads = std::max(1, (int) nThreads);

    // Core pinning: top-N cores by max frequency. Pin this (engine) thread too so mtmd's threads inherit it.
    std::vector<int> cores;
    if (pin) cores = pick_fast_cores(e->n_threads);
    if (!cores.empty()) {
        cpu_set_t set; CPU_ZERO(&set);
        for (int c : cores) CPU_SET(c, &set);
        if (sched_setaffinity(0, sizeof set, &set) != 0) LOGW("sched_setaffinity failed");
        std::string l; for (int c : cores) l += std::to_string(c) + " ";
        LOGI("pinned to cores: %s", l.c_str());
        e->n_threads = (int) cores.size();
    } else {
        LOGW("no core pinning (pin=%d)", (int) pin);
    }

    llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = 0;                                   // CPU only
    mp.load_mode = useMmap ? LLAMA_LOAD_MODE_MMAP : LLAMA_LOAD_MODE_NONE;
    e->model = llama_model_load_from_file(model_path.c_str(), mp);
    if (!e->model) { free_engine(e); throw_engine(env, "E_MODEL_LOAD:llama_model_load_from_file failed"); return 0; }
    e->vocab = llama_model_get_vocab(e->model);

    llama_context_params cp = llama_context_default_params();
    cp.n_ctx = (uint32_t) nCtx;
    cp.n_batch = (uint32_t) nBatch;
    cp.n_ubatch = (uint32_t) std::min((int) nUbatch, (int) nBatch);
    cp.n_seq_max = 1;
    cp.n_threads = e->n_threads;
    cp.n_threads_batch = e->n_threads;
    cp.flash_attn_type = (flashAttn < 0) ? LLAMA_FLASH_ATTN_TYPE_AUTO
                       : (flashAttn == 0 ? LLAMA_FLASH_ATTN_TYPE_DISABLED : LLAMA_FLASH_ATTN_TYPE_ENABLED);
    cp.type_k = kvType == 1 ? GGML_TYPE_Q8_0 : GGML_TYPE_F16;
    cp.type_v = kvType == 1 ? GGML_TYPE_Q8_0 : GGML_TYPE_F16;   // quantized V needs flash attention (flashAttn=1)
    cp.offload_kqv = false;
    cp.op_offload = false;
    cp.no_perf = true;
    e->ctx = llama_init_from_model(e->model, cp);
    if (!e->ctx) { free_engine(e); throw_engine(env, "E_CONTEXT:llama_init_from_model failed"); return 0; }

    // Explicit threadpool so the core mask applies (otherwise ggml makes an unpinned pool per graph).
    {
        ggml_threadpool_params tpp = ggml_threadpool_params_default(e->n_threads);
        if (!cores.empty()) {
            for (int c : cores) tpp.cpumask[c] = true;
            tpp.strict_cpu = true;
        }
        tpp.poll = 50;
        e->tp = ggml_threadpool_new(&tpp);
        if (e->tp) llama_attach_threadpool(e->ctx, e->tp, nullptr);
        else LOGW("ggml_threadpool_new failed; using ggml's default pool");
    }

    if (!mmproj_path.empty()) {
        mtmd_context_params mm = mtmd_context_params_default();
        mm.use_gpu = false;
        mm.print_timings = false;
        mm.n_threads = e->n_threads;
        mm.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_AUTO;
        mm.warmup = warmup;
        mm.image_max_tokens = imageMaxTokens;
        e->mctx = mtmd_init_from_file(mmproj_path.c_str(), e->model, mm);
        if (!e->mctx) { free_engine(e); throw_engine(env, "E_PROJECTOR:mtmd_init_from_file failed"); return 0; }
        if (!mtmd_support_vision(e->mctx)) { free_engine(e); throw_engine(env, "E_NO_VISION:projector has no vision support"); return 0; }
    }
    LOGI("loaded: n_ctx=%d n_batch=%d threads=%d vision=%d", e->n_ctx, e->n_batch, e->n_threads, e->mctx != nullptr);
    return reinterpret_cast<jlong>(e);
}

JNI(void, nativeCancel)(JNIEnv *, jobject, jlong handle) {
    auto * e = reinterpret_cast<Engine *>(handle);
    if (!e) return;
    int z = ABORT_NONE;
    e->abort_reason.compare_exchange_strong(z, ABORT_CANCELLED);   // first reason wins
}

JNI(void, nativeFree)(JNIEnv *, jobject, jlong handle) {
    free_engine(reinterpret_cast<Engine *>(handle));
}

// Times mtmd_encode_chunk alone. Returns {seconds, imageTokens}.
JNI(jdoubleArray, nativeProbeEncode)(JNIEnv * env, jobject, jlong handle, jbyteArray jrgb, jint w, jint h) {
    auto * e = reinterpret_cast<Engine *>(handle);
    if (!e || !e->mctx) { throw_engine(env, "E_NOT_READY:no projector"); return nullptr; }
    if (e->busy.exchange(true)) { throw_engine(env, "E_BUSY:request running"); return nullptr; }
    std::vector<unsigned char> rgb((size_t) env->GetArrayLength(jrgb));
    env->GetByteArrayRegion(jrgb, 0, (jsize) rgb.size(), reinterpret_cast<jbyte *>(rgb.data()));
    Tokenized tk;
    std::string err = tokenize_prompt(e, "", "x", rgb.data(), w, h, tk);
    double secs = 0; int rc = 0;
    if (err.empty()) {
        auto t0 = clk::now();
        size_t n = mtmd_input_chunks_size(tk.chunks);
        for (size_t i = 0; i < n && rc == 0; i++) {
            const mtmd_input_chunk * ch = mtmd_input_chunks_get(tk.chunks, i);
            if (ch && mtmd_input_chunk_get_type(ch) == MTMD_INPUT_CHUNK_TYPE_IMAGE) rc = mtmd_encode_chunk(e->mctx, ch);
        }
        secs = secs_since(t0);
    }
    e->busy = false;
    if (!err.empty()) { throw_engine(env, err); return nullptr; }
    if (rc != 0) { throw_engine(env, "E_PREFILL:" + std::to_string(rc)); return nullptr; }
    jdouble out[2] = {secs, (jdouble) tk.image};
    jdoubleArray arr = env->NewDoubleArray(2);
    env->SetDoubleArrayRegion(arr, 0, 2, out);
    return arr;
}

// Streams UTF-8-complete byte chunks to sink.onBytes(byte[]). Returns a NativeResult (fields set directly).
JNI(jobject, nativeGenerate)(JNIEnv * env, jobject, jlong handle, jstring jsys, jstring jprompt, jbyteArray jrgb,
                             jint w, jint h, jstring jgrammar, jint maxNew, jlong deadlineMs, jint seed, jobject sink) {
    auto * e = reinterpret_cast<Engine *>(handle);
    if (!e) { throw_engine(env, "E_NOT_READY:no engine"); return nullptr; }
    if (e->busy.exchange(true)) { throw_engine(env, "E_BUSY:request running"); return nullptr; }
    struct BusyGuard { Engine * e; ~BusyGuard() { e->busy = false; } } busy_guard{e};

    const auto t0 = clk::now();
    e->abort_reason = ABORT_NONE;
    e->deadline_ns = now_ns() + (int64_t) deadlineMs * 1000000LL;
    llama_set_abort_callback(e->ctx, abort_cb, e);
    struct AbortGuard { Engine * e; ~AbortGuard() { llama_set_abort_callback(e->ctx, nullptr, nullptr); } } abort_guard{e};

    // Single-turn: wipe KV cache every request.
    llama_memory_clear(llama_get_memory(e->ctx), true);

    std::string sys = jstr(env, jsys), prompt = jstr(env, jprompt), grammar = jstr(env, jgrammar);
    std::vector<unsigned char> rgb;
    if (jrgb) {
        rgb.resize((size_t) env->GetArrayLength(jrgb));
        env->GetByteArrayRegion(jrgb, 0, (jsize) rgb.size(), reinterpret_cast<jbyte *>(rgb.data()));
        if (rgb.size() != (size_t) w * (size_t) h * 3) { throw_engine(env, "E_IMAGE:rgb size does not match w*h*3"); return nullptr; }
    }

    Tokenized tk;
    std::string err = tokenize_prompt(e, sys, prompt, jrgb ? rgb.data() : nullptr, w, h, tk);
    if (!err.empty()) { throw_engine(env, err); return nullptr; }
    const int limit = e->n_ctx - 16;
    if (tk.total >= limit) {
        throw_engine(env, "E_PROMPT_TOO_LONG:" + std::to_string(tk.total) + " tokens, limit " + std::to_string(limit));
        return nullptr;
    }

    jclass sinkCls = env->GetObjectClass(sink);
    jmethodID onBytes = env->GetMethodID(sinkCls, "onBytes", "([B)V");
    if (!onBytes) { throw_engine(env, "E_INTERNAL:sink.onBytes missing"); return nullptr; }

    uint64_t rss = 0, hwm = 0, peak = 0;
    read_rss(rss, hwm); peak = hwm;

    int stop = STOP_MAX_TOKENS;
    int generated = 0;
    double prefill_s = 0, ttft_s = 0, decode_tps = 0;
    std::string text;
    llama_pos n_past = 0;

    auto abort_stop = [&]() { return e->abort_reason.load() == ABORT_DEADLINE ? STOP_DEADLINE : STOP_CANCELLED; };

    // ---- prefill (prompt + image)
    int32_t erc;
    if (e->mctx) {
        erc = mtmd_helper_eval_chunks(e->mctx, e->ctx, tk.chunks, 0, 0, e->n_batch, true, &n_past);
    } else {
        erc = prefill_text(e, tk.text_tokens, n_past);
    }
    prefill_s = secs_since(t0);
    read_rss(rss, hwm); peak = std::max(peak, hwm);

    bool finished = false;
    if (e->abort_reason.load() != ABORT_NONE) { stop = abort_stop(); finished = true; }
    else if (erc != 0) { throw_engine(env, "E_PREFILL:" + std::to_string(erc)); return nullptr; }

    if (!finished) {
        llama_sampler * smpl = make_sampler(e, grammar, (uint32_t) seed);
        if (!smpl) { throw_engine(env, "E_GRAMMAR:sampler or GBNF grammar failed to initialise"); return nullptr; }
        llama_batch_ext * batch = llama_batch_ext_init(e->ctx);
        if (!batch) { llama_sampler_free(smpl); throw_engine(env, "E_INTERNAL:batch_ext_init"); return nullptr; }

        Utf8Assembler utf8;
        llama_pos pos = n_past;
        bool have_first = false;
        clk::time_point t_first;
        std::string fatal;

        auto emit = [&](const std::string & s) {
            if (s.empty()) return;
            text += s;
            jbyteArray arr = to_bytes(env, s);
            env->CallVoidMethod(sink, onBytes, arr);
            env->DeleteLocalRef(arr);
            if (env->ExceptionCheck()) {          // Kotlin callback threw: stop the request, rethrow afterwards
                int z = ABORT_NONE; e->abort_reason.compare_exchange_strong(z, ABORT_CANCELLED);
            }
        };

        while (true) {
            if (e->abort_reason.load() != ABORT_NONE || now_ns() >= e->deadline_ns.load()) {
                if (e->abort_reason.load() == ABORT_NONE) e->abort_reason = ABORT_DEADLINE;
                stop = abort_stop(); break;
            }
            if (generated >= maxNew) { stop = STOP_MAX_TOKENS; break; }
            if ((int) pos >= e->n_ctx) { stop = STOP_CONTEXT_FULL; break; }

            llama_token tok = llama_sampler_sample(smpl, e->ctx, -1);   // also accepts the token
            if (llama_vocab_is_eog(e->vocab, tok)) { stop = STOP_EOG; break; }
            if (!have_first) { have_first = true; t_first = clk::now(); ttft_s = secs_since(t0); }
            generated++;
            emit(utf8.push(piece_bytes(e->vocab, tok)));
            if (env->ExceptionCheck()) { stop = STOP_CANCELLED; break; }

            llama_batch_ext_clear(batch);
            int32_t idx = llama_batch_ext_add_token(batch, 0, tok);
            llama_pos p = pos;
            if (idx < 0 || !llama_batch_ext_set_pos(batch, idx, &p) || !llama_batch_ext_set_output_logits(batch, idx, true)) {
                fatal = "E_DECODE:batch add failed (" + std::to_string(idx) + ")"; break;
            }
            int32_t rc = llama_process(e->ctx, LLAMA_PROCESS_TYPE_DECODE, batch);
            if (rc == 2) { stop = abort_stop(); break; }
            if (rc == 1) { stop = STOP_CONTEXT_FULL; break; }
            if (rc != 0) { fatal = "E_DECODE:" + std::to_string(rc); break; }
            pos += 1;
            if (generated % 8 == 0) { read_rss(rss, hwm); peak = std::max(peak, hwm); }
        }
        if (!env->ExceptionCheck()) emit(utf8.flush());
        if (have_first && generated > 1) {
            decode_tps = (double) (generated - 1) / std::max(secs_since(t_first), 1e-6);
        }
        llama_batch_ext_free(batch);
        llama_sampler_free(smpl);
        if (env->ExceptionCheck()) return nullptr;       // propagate the Kotlin exception
        if (!fatal.empty()) { throw_engine(env, fatal); return nullptr; }
    }

    read_rss(rss, hwm); peak = std::max(peak, hwm);

    // ---- build result
    jclass rc_ = env->FindClass("com/mistral/london/ministral/NativeResult");
    jmethodID ctor = env->GetMethodID(rc_, "<init>", "()V");
    jobject res = env->NewObject(rc_, ctor);
    auto setI = [&](const char * n, jint v) { env->SetIntField(res, env->GetFieldID(rc_, n, "I"), v); };
    auto setD = [&](const char * n, jdouble v) { env->SetDoubleField(res, env->GetFieldID(rc_, n, "D"), v); };
    auto setJ = [&](const char * n, jlong v) { env->SetLongField(res, env->GetFieldID(rc_, n, "J"), v); };
    env->SetObjectField(res, env->GetFieldID(rc_, "textBytes", "[B"), to_bytes(env, text));
    setI("stopReason", stop);
    setI("promptTokens", tk.total);
    setI("imageTokens", tk.image);
    setI("generatedTokens", generated);
    setD("prefillSeconds", prefill_s);
    setD("timeToFirstToken", ttft_s);
    setD("decodeTokensPerSecond", decode_tps);
    setD("totalSeconds", secs_since(t0));
    setJ("peakRssBytes", (jlong) peak);
    setJ("rssBytes", (jlong) rss);
    LOGI("done: stop=%d gen=%d prefill=%.2fs ttft=%.2fs tps=%.2f total=%.2fs peakRSS=%lluMB", stop, generated, prefill_s,
         ttft_s, decode_tps, secs_since(t0), (unsigned long long) (peak / 1000000ULL));
    return res;
}
