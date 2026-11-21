package expo.modules.bitchatmesh

// Kotlin mirror of ios/MeshBackend.swift. Keep both in sync with src/BitchatMesh.types.ts.
data class NativePeer(val id: String, val nickname: String, val reachable: Boolean)

data class NativeMessage(
  val id: String,
  val from: String,
  val fromNickname: String,
  val text: String,
  val channel: String, // "public" | "private"
  val receivedAt: Long, // epoch millis
)

enum class NativeLinkState(val raw: String) {
  STARTING("starting"), RUNNING("running"), BLUETOOTH_OFF("bluetooth_off"),
  UNAUTHORIZED("unauthorized"), UNSUPPORTED("unsupported"), STOPPED("stopped")
}

sealed class MeshBackendEvent {
  data class Peers(val peers: List<NativePeer>) : MeshBackendEvent()
  data class Message(val message: NativeMessage) : MeshBackendEvent()
  data class State(val state: NativeLinkState, val detail: String? = null) : MeshBackendEvent()
}

class MeshBackendError(val code: String, override val message: String) : Exception(message)

interface MeshBackend {
  var onEvent: ((MeshBackendEvent) -> Unit)?
  fun start(nickname: String)
  fun stop()
  fun getPeers(): List<NativePeer>
  fun sendPublic(text: String)
  fun sendPrivate(peerID: String, text: String)
}

/** Used when the vendored bitchat-android sources were not prepared at build time. */
class UnavailableMeshBackend : MeshBackend {
  override var onEvent: ((MeshBackendEvent) -> Unit)? = null
  private fun fail(): Nothing =
    throw MeshBackendError("UNSUPPORTED", "BitChat mesh sources not vendored; run prepare-sources-android.js and rebuild")
  override fun start(nickname: String) {
    onEvent?.invoke(MeshBackendEvent.State(NativeLinkState.UNSUPPORTED, "mesh sources not vendored"))
    fail()
  }
  override fun stop() {}
  override fun getPeers(): List<NativePeer> = emptyList()
  override fun sendPublic(text: String) = fail()
  override fun sendPrivate(peerID: String, text: String) = fail()
}
