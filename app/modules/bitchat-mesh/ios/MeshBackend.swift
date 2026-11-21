import Foundation

struct NativePeer {
    let id: String
    let nickname: String
    let reachable: Bool
}

struct NativeMessage {
    enum Channel: String {
        case `public`, `private`
    }

    let id: String
    let from: String
    let fromNickname: String
    let text: String
    let channel: Channel
    let receivedAt: Date
}

enum NativeLinkState: String {
    case starting, running, bluetoothOff = "bluetooth_off", unauthorized, unsupported, stopped
}

enum MeshBackendEvent {
    case peers([NativePeer])
    case message(NativeMessage)
    case state(NativeLinkState, detail: String?)
}

struct MeshBackendError: Error {
    let code: String
    let message: String
}

@MainActor
protocol MeshBackend: AnyObject {
    var onEvent: (@MainActor (MeshBackendEvent) -> Void)? { get set }
    func start(nickname: String) throws
    func stop()
    func getPeers() -> [NativePeer]
    func sendPublic(_ text: String) throws
    func sendPrivate(peerID: String, text: String) throws
}
