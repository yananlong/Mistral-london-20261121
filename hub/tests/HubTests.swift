import Foundation

actor Events {
    private var items: [String] = []
    func add(_ item: String) { items.append(item) }
    func all() -> [String] { items }
}

final class Logs {
    private let lock = NSLock()
    private var lines: [String] = []
    func add(_ line: String) { lock.lock(); defer { lock.unlock() }; lines.append(line) }
    func all() -> [String] { lock.lock(); defer { lock.unlock() }; return lines }
}

struct UncooperativeModel: HubModel {
    func answer(system: String, user: String) async throws -> String {
        await withCheckedContinuation { continuation in
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.9) { continuation.resume(returning: "late") }
        }
    }
}

actor SentMessages {
    private var items: [String] = []
    func add(_ text: String) { items.append(text) }
    func all() -> [String] { items }
}

struct OutputModel: HubModel {
    let output: String
    func answer(system: String, user: String) async throws -> String { output }
}

struct EmptyModel: HubModel {
    func answer(system: String, user: String) async throws -> String { "  \n" }
}

struct FakeModel: HubModel {
    let events: Events
    let delayMS: Int
    let shouldThrow: Bool
    init(_ events: Events, delayMS: Int = 0, shouldThrow: Bool = false) {
        self.events = events; self.delayMS = delayMS; self.shouldThrow = shouldThrow
    }
    func answer(system: String, user: String) async throws -> String {
        await events.add("model:\(user)")
        if delayMS > 0 { try await Task.sleep(nanoseconds: UInt64(delayMS) * 1_000_000) }
        if user == "first" || user == "slow" { try await Task.sleep(nanoseconds: 250_000_000) }
        if shouldThrow { throw HubModelError.invalidResponse }
        return "answer \(user)"
    }
}

@main
struct HubTests {
    static var count = 0
    static var failures = 0
    static func check(_ condition: Bool, _ description: String) {
        count += 1
        if !condition {
            failures += 1
            fputs("FAIL: \(description)\n", stderr)
        }
    }
    static func location(_ value: Any?) -> HubProtocol.Location? {
        guard let dict = value as? [String: Any], let lat = dict["lat"] as? Double,
              let lon = dict["lon"] as? Double else { return nil }
        return .init(lat: lat, lon: lon)
    }
    static func main() async throws {
        let path = CommandLine.arguments[1]
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        let vectors = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let constants = vectors["constants"] as! [String: Any]
        let actualConstants: [String: AnyHashable] = [
            "HUB_NICKNAME": HubProtocol.nickname, "ACK_TEXT": HubProtocol.ackText,
            "ANSWER_LABEL": HubProtocol.answerLabel, "HUB_ERROR_TEXT": HubProtocol.errorText,
            "HUB_EMPTY_TEXT": HubProtocol.emptyText, "LOCATION_SHARE_DEFAULT_NOTE": HubProtocol.locationShareDefaultNote,
            "MAX_QUESTION_BYTES": HubProtocol.maxQuestionBytes, "MAX_ANSWER_BODY_BYTES": HubProtocol.maxAnswerBodyBytes,
            "MAX_MESSAGE_BYTES": HubProtocol.maxMessageBytes, "MAX_ANSWER_PARTS": HubProtocol.maxAnswerParts,
            "ACK_TIMEOUT_MS": HubProtocol.ackTimeoutMS, "ANSWER_TIMEOUT_MS": HubProtocol.answerTimeoutMS,
            "HUB_MODEL_TIMEOUT_MS": HubProtocol.modelTimeoutMS
        ]
        check(constants.count == actualConstants.count, "all constants covered")
        for (key, value) in actualConstants { check((constants[key] as? AnyHashable) == value, "constant \(key)") }
        for vector in vectors["locEncode"] as! [[String: Any]] {
            let loc = HubProtocol.Location(lat: vector["lat"] as! Double, lon: vector["lon"] as! Double)
            check(HubProtocol.encodeLocation(loc) == vector["line"] as? String, "encode location \(loc)")
        }
        for vector in vectors["locDecode"] as! [[String: Any]] {
            let line = vector["line"] as! String
            check(HubProtocol.decodeLocation(line) == location(vector["result"]), "decode location \(line)")
        }
        for vector in vectors["parseQuestion"] as! [[String: Any]] {
            let result = vector["result"] as! [String: Any]
            let parsed = HubProtocol.parseQuestion(vector["wire"] as! String)
            check(parsed.body == result["body"] as? String && parsed.location == location(result["loc"]) &&
                  parsed.isEmpty == (result["kind"] as? String == "empty"), "parse question")
        }
        for vector in vectors["userContent"] as! [[String: Any]] {
            let question = HubProtocol.Question(body: vector["body"] as! String, location: location(vector["loc"]))
            check(HubProtocol.userContent(question) == vector["content"] as? String, "user content")
        }
        for vector in vectors["composeAnswer"] as! [[String: Any]] {
            check(HubProtocol.composeAnswer(vector["modelOutput"] as! String) == vector["messages"] as? [String], "compose answer")
        }
        let unicode = String(repeating: "a", count: 199) + "🙂"
        let parsedUnicode = HubProtocol.parseQuestion(unicode)
        check(parsedUnicode.body == String(repeating: "a", count: 199), "question truncates at UTF-8 scalar boundary")
        let longUnicode = String(repeating: "🙂", count: 500)
        let longAnswer = HubProtocol.composeAnswer(longUnicode)!
        check(longAnswer.allSatisfy { $0.utf8.count <= HubProtocol.maxMessageBytes } &&
              longAnswer[longAnswer.count - 2].hasSuffix("…"), "answer truncates and splits at UTF-8 boundaries")
        check(HubProtocol.decodeLocation("loc: +1,2") == nil, "invalid location rejected")
        let middleLoc = HubProtocol.parseQuestion("loc: 51.0,-0.1\nquestion")
        check(middleLoc.location == nil && middleLoc.body == "loc: 51.0,-0.1\nquestion", "only trailing location parsed")
        check(HubConfig(environment: [:]).model == "ministral-3:14b-instruct-2512-q4_K_M", "default model")
        check(HubConfig(environment: [:]).ollamaURL.absoluteString == "http://127.0.0.1:11434", "default URL")
        #if os(macOS)
        check(HubConfig(environment: ["BITCHAT_HUB": "1"]).enabled, "macOS hub enabled")
        #else
        check(!HubConfig(environment: ["BITCHAT_HUB": "1"]).enabled, "hub disabled off macOS")
        #endif
        let referenceData = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[3]))
        let cases = try JSONSerialization.jsonObject(with: referenceData) as! [[String: Any]]
        for (index, item) in cases.enumerated() {
            let actual = HubProtocol.composeAnswer(item["output"] as! String)?.map { Data($0.utf8) }
            let expected = (item["messages"] as? [String])?.map { Data($0.utf8) }
            check(actual == expected, "reference split and truncation case \(index)")
        }
        await testResponder()
        await testResponderVectors(vectors["composeAnswer"] as! [[String: Any]])
        try await testHTTP(directory: CommandLine.arguments[2])
        print("\(count - failures)/\(count) tests passed")
        if failures > 0 { exit(1) }
    }

    static func responder(events: Events, model: FakeModel, timeoutMS: Int = 120_000) -> HubResponder {
        HubResponder(model: model, timeoutMS: timeoutMS, send: { peer, text in
            await events.add("send:\(peer):\(text)")
        }, log: { _ in })
    }
    static func testResponder() async {
        do {
            let events = Events()
            let hub = responder(events: events, model: FakeModel(events))
            await hub.handle(text: "help", from: "p")
            let all = await events.all()
            check(all == ["send:p:\(HubProtocol.ackText)", "model:help", "send:p:(1/2) answer help",
                          "send:p:(2/2) \(HubProtocol.answerLabel)"], "ack before model and labelled answer parts")
        }
        do {
            let events = Events()
            let hub = responder(events: events, model: FakeModel(events))
            await hub.handle(text: " \nloc: 51.5,-0.1", from: "p")
            let all = await events.all()
            check(all == ["send:p:\(HubProtocol.emptyText)"], "empty has no ack or model")
        }
        do {
            let events = Events()
            let hub = responder(events: events, model: FakeModel(events, shouldThrow: true))
            await hub.handle(text: "help", from: "p")
            let all = await events.all()
            check(all.last == "send:p:\(HubProtocol.errorText)" && all.first == "send:p:\(HubProtocol.ackText)", "model error")
        }
        do {
            let events = Events()
            let hub = responder(events: events, model: FakeModel(events, delayMS: 500), timeoutMS: 30)
            let start = Date()
            await hub.handle(text: "help", from: "p")
            let all = await events.all()
            check(all.last == "send:p:\(HubProtocol.errorText)" && Date().timeIntervalSince(start) < 0.4, "model timeout")
        }
        do {
            let events = Events()
            let hub = HubResponder(model: UncooperativeModel(), timeoutMS: 30, send: { peer, text in
                await events.add("send:\(peer):\(text)")
            }, log: { _ in })
            let start = Date()
            await hub.handle(text: "help", from: "p")
            let all = await events.all()
            check(all.last == "send:p:\(HubProtocol.errorText)" && Date().timeIntervalSince(start) < 0.6,
                  "deadline does not wait for a model ignoring cancellation")
        }
        do {
            let events = Events()
            let logs = Logs()
            let hub = HubResponder(model: EmptyModel(), send: { peer, text in
                await events.add("send:\(peer):\(text)")
            }, log: { logs.add($0) })
            await hub.handle(text: "help\nloc: 51.5,-0.1", from: "1234567890")
            let all = await events.all()
            let lines = logs.all()
            check(all.last == "send:1234567890:\(HubProtocol.errorText)", "empty model output gets error reply")
            check(lines.count == 1 && lines[0].contains("sender=12345678") && lines[0].contains("question_bytes=4") &&
                  lines[0].contains("location=true") && lines[0].contains("outcome=error") && lines[0].contains("latency_ms="),
                  "one privacy-preserving log line per question")
        }
        do {
            let events = Events()
            let hub = responder(events: events, model: FakeModel(events))
            let first = Task { await hub.handle(text: "first", from: "p") }
            while !(await events.all()).contains("model:first") { try? await Task.sleep(nanoseconds: 1_000_000) }
            let second = Task { await hub.handle(text: "second", from: "p") }
            await first.value; await second.value
            let all = await events.all()
            let firstAnswer = all.firstIndex(of: "send:p:(2/2) \(HubProtocol.answerLabel)")
            let secondModel = all.firstIndex(of: "model:second")
            let secondAnswer = all.lastIndex(of: "send:p:(2/2) \(HubProtocol.answerLabel)")
            check(firstAnswer != nil && secondModel != nil && secondAnswer != nil && firstAnswer! < secondModel! && secondModel! < secondAnswer!, "one sender is ordered")
        }
        do {
            let events = Events()
            let hub = responder(events: events, model: FakeModel(events))
            let slow = Task { await hub.handle(text: "slow", from: "slow-peer") }
            while !(await events.all()).contains("model:slow") { try? await Task.sleep(nanoseconds: 1_000_000) }
            await hub.handle(text: "fast", from: "fast-peer")
            let beforeSlow = await events.all()
            check(beforeSlow.contains("send:fast-peer:(2/2) \(HubProtocol.answerLabel)") &&
                  !beforeSlow.contains("send:slow-peer:(2/2) \(HubProtocol.answerLabel)"), "different senders run concurrently")
            await slow.value
        }
    }
    static func testResponderVectors(_ vectors: [[String: Any]]) async {
        for (index, vector) in vectors.enumerated() {
            let capture = SentMessages()
            let model = OutputModel(output: vector["modelOutput"] as! String)
            let hub = HubResponder(model: model, send: { _, text in await capture.add(text) }, log: { _ in })
            await hub.handle(text: "help", from: "p")
            let actual = await capture.all()
            let expected = [HubProtocol.ackText] + ((vector["messages"] as? [String]) ?? [HubProtocol.errorText])
            check(actual == expected, "responder sends vector \(index) in order")
            check(actual.allSatisfy { $0.utf8.count <= HubProtocol.maxMessageBytes },
                  "every message for vector \(index) fits BitChat")
        }
        let longOutput = String(repeating: "🙂", count: 400) + String(repeating: "x", count: 1500) +
            "\n" + String(repeating: "long line 🚒 ", count: 20)
        let capture = SentMessages()
        let hub = HubResponder(model: OutputModel(output: longOutput),
                               send: { _, text in await capture.add(text) }, log: { _ in })
        await hub.handle(text: "help", from: "p")
        let actual = await capture.all()
        let expected = [HubProtocol.ackText] + HubProtocol.composeAnswer(longOutput)!
        check(longOutput.utf8.count >= 3000 && actual == expected && actual.count > 3,
              "three-kilobyte emoji answer is sent as ordered parts")
        check(actual.allSatisfy { $0.utf8.count <= HubProtocol.maxMessageBytes },
              "every message for three-kilobyte emoji answer fits BitChat")
        check(actual.count - 1 <= HubProtocol.maxAnswerParts && actual.last?.hasSuffix(HubProtocol.answerLabel) == true,
              "last part is label and part count is bounded")
        let emptyCapture = SentMessages()
        let emptyHub = HubResponder(model: OutputModel(output: longOutput),
                                    send: { _, text in await emptyCapture.add(text) }, log: { _ in })
        await emptyHub.handle(text: " ", from: "p")
        let empty = await emptyCapture.all()
        check(empty == [HubProtocol.emptyText] && empty.allSatisfy { $0.utf8.count <= HubProtocol.maxMessageBytes },
              "empty response fits BitChat")
    }
    static func testHTTP(directory: String) async throws {
        func client(_ mode: String, timeout: Int = 2_000) throws -> OllamaClient {
            let port = try String(contentsOfFile: "\(directory)/port-\(mode)", encoding: .utf8)
            return OllamaClient(baseURL: URL(string: "http://127.0.0.1:\(port)")!, model: "test-model", timeoutMS: timeout)
        }
        let output = try await client("ok").answer(system: "system text", user: "user text")
        check(output == "1. Move to a safe place.", "HTTP parses answer")
        let recorded = try String(contentsOfFile: "\(directory)/requests-ok", encoding: .utf8)
        let json = try JSONSerialization.jsonObject(with: Data(recorded.split(separator: "\n")[0].utf8)) as! [String: Any]
        let messages = json["messages"] as! [[String: String]]
        let options = json["options"] as! [String: Any]
        check(json.count == 5 && json["model"] as? String == "test-model" && json["stream"] as? Bool == false &&
              json["keep_alive"] as? Int == -1 && messages == [["role": "system", "content": "system text"], ["role": "user", "content": "user text"]] &&
              options.count == 2 && options["num_predict"] as? Int == 400 && options["temperature"] as? Double == 0.3, "HTTP request shape")
        let empty = try await client("empty").answer(system: "s", user: "u")
        check(empty.isEmpty && HubProtocol.composeAnswer(empty) == nil, "empty response")
        for mode in ["error500", "badjson"] {
            var threw = false
            do { _ = try await client(mode).answer(system: "s", user: "u") } catch { threw = true }
            check(threw, "HTTP error \(mode)")
        }
        let start = Date()
        var timedOut = false
        do { _ = try await client("slow", timeout: 50).answer(system: "s", user: "u") } catch { timedOut = true }
        check(timedOut && Date().timeIntervalSince(start) < 0.5, "HTTP deadline")
    }
}
