import BitFoundation
import CoreBluetooth
import Foundation

@MainActor
final class BitchatMeshBackend: MeshBackend, TransportEventDelegate, TransportPeerEventsDelegate {
    var onEvent: (@MainActor (MeshBackendEvent) -> Void)?

    private var service: BLEService?
    private var router: MessageRouter?
    private var reachableIDs = Set<PeerID>()
    private var knownNames: [PeerID: String] = [:]
    private var seenIDs = Set<String>()
    private var seenOrder: [String] = []
    private let seenLimit = 2_048

    func start(nickname: String) throws {
        guard let validNickname = InputValidator.validateNickname(nickname) else {
            throw MeshBackendError(code: "INVALID_NICKNAME", message: "Nickname must contain 1–50 valid characters.")
        }
        if let service {
            service.setNickname(validNickname)
            publishPeers()
            return
        }
        onEvent?(.state(.starting, detail: nil))
        let keychain = KeychainManager.makeDefault()
        let identityManager = SecureIdentityStateManager(keychain)
        let service = BLEService(keychain: keychain, idBridge: nil, identityManager: identityManager)
        self.service = service
        self.router = MessageRouter(transports: [service], outboxStore: MessageOutboxStore(keychain: keychain))
        service.eventDelegate = self
        service.peerEventsDelegate = self
        service.setNickname(validNickname)
        service.startServices()
        publishPeers()
        publishBluetoothState(service.centralManager?.state ?? .unknown)
    }

    func stop() {
        guard let service else {
            onEvent?(.state(.stopped, detail: nil))
            return
        }
        self.service = nil
        self.router = nil
        reachableIDs.removeAll()
        service.eventDelegate = nil
        service.peerEventsDelegate = nil
        service.stopServices()
        service.suspendForPanicReset()
        knownNames.removeAll()
        seenIDs.removeAll()
        seenOrder.removeAll()
        onEvent?(.peers([]))
        onEvent?(.state(.stopped, detail: nil))
    }

    func getPeers() -> [NativePeer] {
        guard let service else { return [] }
        return mapPeers(service.currentPeerSnapshots(), service: service)
    }

    func sendPublic(_ text: String) throws {
        let bytes = text.utf8.count
        guard bytes <= Int(UInt16.max), text.count <= InputValidator.Limits.maxMessageLength else {
            throw MeshBackendError(code: "MESSAGE_TOO_LONG", message: "Public message has \(bytes) UTF-8 bytes and \(text.count) characters; maximum is 65535 bytes and 60000 characters.")
        }
        if bytes == Int(UInt16.max) {
            let probe = BitchatPacket(type: MessageType.message.rawValue, senderID: Data(repeating: 0, count: 8), recipientID: nil, timestamp: 0, payload: Data(text.utf8), signature: nil, ttl: 1)
            guard probe.toBinaryData(padding: false) != nil else {
                throw MeshBackendError(code: "MESSAGE_TOO_LONG", message: "Public message has \(bytes) UTF-8 bytes and cannot fit in a BitChat v1 frame.")
            }
        }
        let service = try requireService()
        service.sendMessage(text, mentions: [])
    }

    func sendPrivate(peerID: String, text: String) throws {
        let bytes = text.utf8.count
        guard bytes <= 255 else {
            throw MeshBackendError(code: "MESSAGE_TOO_LONG", message: "Private message has \(bytes) UTF-8 bytes; maximum is 255 bytes.")
        }
        let id = PeerID(str: peerID)
        guard id.prefix == .empty, id.isShort else {
            throw MeshBackendError(code: "INVALID_PEER_ID", message: "A 16-digit hexadecimal mesh peer ID is required.")
        }
        _ = try requireService()
        router?.sendPrivate(text, to: id, recipientNickname: knownNames[id] ?? "Unknown", messageID: UUID().uuidString)
    }

    func didUpdatePeerSnapshots(_ snapshots: [TransportPeerSnapshot]) {
        guard let service else { return }
        let peers = mapPeers(snapshots, service: service)
        let current = Set(snapshots.filter { service.isPeerReachable($0.peerID) }.map(\.peerID))
        for peerID in current.subtracting(reachableIDs) {
            router?.flushOutbox(for: peerID)
        }
        reachableIDs = current
        onEvent?(.peers(peers))
    }

    func didReceiveTransportEvent(_ event: TransportEvent) {
        guard let service else { return }
        switch event {
        case let .publicMessageReceived(peerID, nickname, content, _, messageID):
            guard peerID != service.myPeerID else { return }
            let id = messageID ?? UUID().uuidString
            guard remember(id: id, from: peerID) else { return }
            knownNames[peerID] = nickname
            onEvent?(.message(NativeMessage(id: id, from: peerID.id, fromNickname: nickname, text: content, channel: .public, receivedAt: Date())))
        case let .noisePayloadReceived(peerID, type, payload, _):
            guard peerID != service.myPeerID else { return }
            if type == .delivered || type == .readReceipt {
                if let id = String(data: payload, encoding: .utf8) {
                    router?.markDelivered(id, from: [peerID])
                }
                return
            }
            guard type == .privateMessage, let packet = PrivateMessagePacket.decode(from: payload) else { return }
            let isNew = remember(id: packet.messageID, from: peerID)
            if isNew {
                let nickname = knownNames[peerID] ?? service.peerNickname(peerID: peerID) ?? "Unknown"
                onEvent?(.message(NativeMessage(id: packet.messageID, from: peerID.id, fromNickname: nickname, text: packet.content, channel: .private, receivedAt: Date())))
            }
            service.sendDeliveryAck(for: packet.messageID, to: peerID)
        case let .peerConnected(peerID):
            if reachableIDs.insert(peerID).inserted { router?.flushOutbox(for: peerID) }
            router?.courierBecameAvailable(peerID)
            publishPeers()
        case let .peerDisconnected(peerID):
            reachableIDs.remove(peerID)
            publishPeers()
        case .peerListUpdated, .peerSnapshotsUpdated:
            publishPeers()
        case let .bluetoothStateUpdated(state):
            publishBluetoothState(state)
        default:
            break
        }
    }

    private func requireService() throws -> BLEService {
        guard let service else {
            throw MeshBackendError(code: "MESH_STOPPED", message: "Start the mesh before sending messages.")
        }
        return service
    }

    private func mapPeers(_ snapshots: [TransportPeerSnapshot], service: BLEService) -> [NativePeer] {
        snapshots.filter { $0.peerID != service.myPeerID }.map { snapshot in
            knownNames[snapshot.peerID] = snapshot.nickname
            return NativePeer(id: snapshot.peerID.id, nickname: snapshot.nickname, reachable: service.isPeerReachable(snapshot.peerID))
        }.sorted { $0.id < $1.id }
    }

    private func publishPeers() {
        onEvent?(.peers(getPeers()))
    }

    private func publishBluetoothState(_ state: CBManagerState) {
        let result: NativeLinkState
        switch state {
        case .poweredOn: result = .running
        case .poweredOff: result = .bluetoothOff
        case .unauthorized: result = .unauthorized
        case .unsupported: result = .unsupported
        case .unknown, .resetting: result = .starting
        @unknown default: result = .starting
        }
        onEvent?(.state(result, detail: nil))
    }

    private func remember(id: String, from peerID: PeerID) -> Bool {
        let key = "\(peerID.id):\(id)"
        guard seenIDs.insert(key).inserted else { return false }
        seenOrder.append(key)
        if seenOrder.count > seenLimit {
            seenIDs.remove(seenOrder.removeFirst())
        }
        return true
    }
}
