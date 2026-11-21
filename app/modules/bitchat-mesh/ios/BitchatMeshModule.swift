import ExpoModulesCore
import Foundation

public final class BitchatMeshModule: Module {
    private var backend: (any MeshBackend)?

    public func definition() -> ModuleDefinition {
        Name("BitchatMesh")
        Events("onPeers", "onMessage", "onState")

        AsyncFunction("start") { (nickname: String, promise: Promise) in
            MainActor.assumeIsolated { self.perform(promise) { try self.mesh().start(nickname: nickname) } }
        }.runOnQueue(.main)

        AsyncFunction("stop") {
            MainActor.assumeIsolated { self.backend?.stop() }
        }.runOnQueue(.main)

        AsyncFunction("getPeers") { () -> [[String: Any]] in
            MainActor.assumeIsolated { (self.backend?.getPeers() ?? []).map(Self.peerDictionary) }
        }.runOnQueue(.main)

        AsyncFunction("sendPublic") { (text: String, promise: Promise) in
            MainActor.assumeIsolated { self.perform(promise) { try self.mesh().sendPublic(text) } }
        }.runOnQueue(.main)

        AsyncFunction("sendPrivate") { (peerID: String, text: String, promise: Promise) in
            MainActor.assumeIsolated { self.perform(promise) { try self.mesh().sendPrivate(peerID: peerID, text: text) } }
        }.runOnQueue(.main)

        OnDestroy { [weak self] in
            Task { @MainActor in self?.backend?.stop() }
        }
    }

    @MainActor
    private func mesh() -> any MeshBackend {
        if let backend { return backend }
        let backend = BitchatMeshBackend()
        backend.onEvent = { [weak self] event in self?.emit(event) }
        self.backend = backend
        return backend
    }

    @MainActor
    private func perform(_ promise: Promise, action: () throws -> Void) {
        do {
            try action()
            promise.resolve()
        } catch let error as MeshBackendError {
            promise.reject(error.code, error.message)
        } catch {
            promise.reject("MESH_ERROR", error.localizedDescription)
        }
    }

    private static func peerDictionary(_ peer: NativePeer) -> [String: Any] {
        ["id": peer.id, "nickname": peer.nickname, "reachable": peer.reachable]
    }

    @MainActor
    private func emit(_ event: MeshBackendEvent) {
        switch event {
        case let .peers(peers):
            sendEvent("onPeers", ["peers": peers.map(Self.peerDictionary)])
        case let .message(message):
            sendEvent("onMessage", [
                "id": message.id, "from": message.from, "fromNickname": message.fromNickname,
                "text": message.text, "channel": message.channel.rawValue,
                "receivedAt": message.receivedAt.timeIntervalSince1970 * 1_000
            ])
        case let .state(state, detail):
            var payload: [String: Any] = ["state": state.rawValue]
            if let detail { payload["detail"] = detail }
            sendEvent("onState", payload)
        }
    }
}
