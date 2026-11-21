import Foundation

@main
struct HubAsk {
    static func main() async {
        do {
            try await run()
        } catch {
            FileHandle.standardError.write(Data("hub-ask: \(error)\nUsage: hub-ask [--url URL] [--model TAG] [--loc LAT,LON] \"question\" (or read a question from stdin)\n".utf8))
            exit(1)
        }
    }

    static func run() async throws {
        enum Usage: Error { case invalidArguments }
        let defaults = HubConfig()
        var url = defaults.ollamaURL
        var model = defaults.model
        var location: HubProtocol.Location?
        var arguments = Array(CommandLine.arguments.dropFirst())
        var words: [String] = []
        while !arguments.isEmpty {
            let arg = arguments.removeFirst()
            switch arg {
            case "--url", "--model", "--loc":
                guard !arguments.isEmpty else { throw Usage.invalidArguments }
                let value = arguments.removeFirst()
                if arg == "--url" {
                    guard let parsed = URL(string: value), let scheme = parsed.scheme,
                          ["http", "https"].contains(scheme), parsed.host != nil else { throw Usage.invalidArguments }
                    url = parsed
                } else if arg == "--model" {
                    model = value
                } else {
                    guard let parsed = HubProtocol.decodeLocation("loc: " + value) else { throw Usage.invalidArguments }
                    location = parsed
                }
            default:
                guard !arg.hasPrefix("--") else { throw Usage.invalidArguments }
                words.append(arg)
            }
        }
        let question = words.isEmpty ? (String(data: FileHandle.standardInput.readDataToEndOfFile(), encoding: .utf8) ?? "") : words.joined(separator: " ")
        let wire = location.map { question + "\n" + HubProtocol.encodeLocation($0) } ?? question
        let responder = HubResponder(model: OllamaClient(baseURL: url, model: model), send: { _, text in
            FileHandle.standardOutput.write(Data((text + "\n\n").utf8))
        }, log: { line in
            FileHandle.standardError.write(Data((line + "\n").utf8))
        })
        await responder.handle(text: wire, from: "cli")
    }
}
