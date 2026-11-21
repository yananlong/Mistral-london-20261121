package expo.modules.bitchatmesh

import android.bluetooth.BluetoothManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import com.bitchat.android.mesh.BluetoothMeshDelegate
import com.bitchat.android.mesh.BluetoothMeshService
import com.bitchat.android.model.BitchatMessage
import com.bitchat.android.ui.DataManager

/**
 * Adapter from the vendored bitchat-android BluetoothMeshService (Noise XX private DMs, BinaryProtocol,
 * fragmentation, relay) to our MeshBackend. Written against bitchat-android @ 0594b60; UNCOMPILED.
 * Instantiated reflectively by BitchatMeshModule so the module still builds without the vendored sources.
 */
class BitchatAndroidMeshBackend(private val context: Context) : MeshBackend, BluetoothMeshDelegate {
  override var onEvent: ((MeshBackendEvent) -> Unit)? = null
  private val main = Handler(Looper.getMainLooper())
  private var service: BluetoothMeshService? = null
  private var nickname: String = "phone"

  private fun post(event: MeshBackendEvent) = main.post { onEvent?.invoke(event) }

  override fun start(nickname: String) {
    if (service != null) return
    val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
      ?: throw MeshBackendError("UNSUPPORTED", "No Bluetooth adapter")
    if (!adapter.isEnabled) {
      post(MeshBackendEvent.State(NativeLinkState.BLUETOOTH_OFF))
      throw MeshBackendError("BLUETOOTH_OFF", "Bluetooth is off")
    }
    this.nickname = nickname
    // bitchat-android reads the announce nickname from DataManager prefs (NicknameProvider).
    DataManager(context).saveNickname(nickname)
    post(MeshBackendEvent.State(NativeLinkState.STARTING))
    try {
      val svc = BluetoothMeshService(context)
      svc.delegate = this
      svc.startServices()
      service = svc
    } catch (e: SecurityException) {
      post(MeshBackendEvent.State(NativeLinkState.UNAUTHORIZED, e.message))
      throw MeshBackendError("UNAUTHORIZED", e.message ?: "Bluetooth permission denied")
    }
    post(MeshBackendEvent.State(NativeLinkState.RUNNING))
  }

  override fun stop() {
    service?.stopServices()
    service = null
    post(MeshBackendEvent.State(NativeLinkState.STOPPED))
  }

  override fun getPeers(): List<NativePeer> {
    val svc = service ?: return emptyList()
    return svc.getPeerNicknames().map { (id, nick) -> NativePeer(id, nick, reachable = true) }
  }

  override fun sendPublic(text: String) {
    (service ?: throw MeshBackendError("NOT_STARTED", "Mesh not started")).sendMessage(text)
  }

  override fun sendPrivate(peerID: String, text: String) {
    val svc = service ?: throw MeshBackendError("NOT_STARTED", "Mesh not started")
    val recipientNick = svc.getPeerNicknames()[peerID] ?: peerID
    // sendPrivateMessage queues and runs the Noise handshake itself if no session exists yet.
    svc.sendPrivateMessage(text, peerID, recipientNick)
  }

  // --- BluetoothMeshDelegate ---
  override fun didReceiveMessage(message: BitchatMessage) {
    post(MeshBackendEvent.Message(NativeMessage(
      id = message.id,
      from = message.senderPeerID ?: message.sender,
      fromNickname = message.sender,
      text = message.content,
      channel = if (message.isPrivate) "private" else "public",
      receivedAt = message.timestamp.time,
    )))
  }

  override fun didUpdatePeerList(peers: List<String>) {
    post(MeshBackendEvent.Peers(getPeers()))
  }

  override fun didReceiveChannelLeave(channel: String, fromPeer: String) {}
  override fun didReceiveDeliveryAck(messageID: String, recipientPeerID: String) {}
  override fun didReceiveReadReceipt(messageID: String, recipientPeerID: String) {}
  override fun didReceiveVerifyChallenge(peerID: String, payload: ByteArray, timestampMs: Long) {}
  override fun didReceiveVerifyResponse(peerID: String, payload: ByteArray, timestampMs: Long) {}
  override fun decryptChannelMessage(encryptedContent: ByteArray, channel: String): String? = null
  override fun getNickname(): String? = nickname
  override fun isFavorite(peerID: String): Boolean = false
}
