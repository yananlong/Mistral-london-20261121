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
    private let maxMessageBytes = 255

    func start(nickname: String) throws {
        guard let validNickname = InputValidator.validateNickname(nickname),
              validNickname.utf8.count <= 255 else {
            throw MeshBackendError(code: "INVALID_NICKNAME", message: "Nickname must contain 1–50 valid characters and fit in 255 UTF-8 bytes.")
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
        service.addPeerAuthenticatedObserver { [weak self, weak service] peerID, _ in
            Task { @MainActor [weak self, weak service] in
                guard let self, let service, self.service === service else { return }
                self.router?.retrySecurePrivateMessagesAfterAuthentication(for: [peerID])
            }
        }
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
        try validateMessageLength(text)
        let service = try requireService()
        service.sendMessage(text, mentions: [])
    }

    func sendPrivate(peerID: String, text: String) throws {
        try validateMessageLength(text)
        let suppliedID = PeerID(str: peerID)
        guard suppliedID.prefix == .empty,
              (suppliedID.isShort || suppliedID.isNoiseKeyHex),
              suppliedID.routingData != nil else {
            throw MeshBackendError(code: "INVALID_PEER_ID", message: "A 16- or 64-digit hexadecimal mesh peer ID is required.")
        }
        let id = suppliedID.toShort()
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
            let peerID = peerID.toShort()
            guard peerID != service.myPeerID else { return }
            let id = messageID ?? UUID().uuidString
            guard remember(id: id, from: peerID) else { return }
            knownNames[peerID] = nickname
            onEvent?(.message(NativeMessage(id: id, from: peerID.id, fromNickname: nickname, text: content, channel: .public, receivedAt: Date())))
        case let .noisePayloadReceived(peerID, type, payload, _):
            let peerID = peerID.toShort()
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

    private func validateMessageLength(_ text: String) throws {
        let bytes = text.utf8.count
        guard bytes <= maxMessageBytes else {
            throw MeshBackendError(code: "MESSAGE_TOO_LONG", message: "Message has \(bytes) UTF-8 bytes; maximum is \(maxMessageBytes) bytes.")
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
