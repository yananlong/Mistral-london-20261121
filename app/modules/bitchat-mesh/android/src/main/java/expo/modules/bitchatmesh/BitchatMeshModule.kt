package expo.modules.bitchatmesh

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Same JS surface as ios/BitchatMeshModule.swift: start/stop/getPeers/sendPublic/sendPrivate + onPeers/onMessage/onState.
class BitchatMeshModule : Module() {
  private var backend: MeshBackend? = null

  override fun definition() = ModuleDefinition {
    Name("BitchatMesh")
    Events("onPeers", "onMessage", "onState")

    AsyncFunction("start") { nickname: String -> guard { mesh().start(nickname) } }
    AsyncFunction("stop") { backend?.stop(); Unit }
    AsyncFunction("getPeers") { (backend?.getPeers() ?: emptyList()).map(::peerMap) }
    AsyncFunction("sendPublic") { text: String -> guard { mesh().sendPublic(text) } }
    AsyncFunction("sendPrivate") { peerId: String, text: String -> guard { mesh().sendPrivate(peerId, text) } }

    OnDestroy { backend?.stop() }
  }

  private fun context(): Context =
    appContext.reactContext?.applicationContext ?: throw MeshBackendError("NO_CONTEXT", "React context unavailable")

  @Synchronized
  private fun mesh(): MeshBackend {
    backend?.let { return it }
    val created = createBackend(context())
    created.onEvent = { emit(it) }
    backend = created
    return created
  }

  /** The adapter lives in src/adapter and is only compiled when the vendored mesh exists, so load it reflectively. */
  private fun createBackend(context: Context): MeshBackend = try {
    Class.forName("expo.modules.bitchatmesh.BitchatAndroidMeshBackend")
      .getConstructor(Context::class.java)
      .newInstance(context) as MeshBackend
  } catch (_: ClassNotFoundException) {
    UnavailableMeshBackend()
  }

  private inline fun guard(action: () -> Unit) {
    try {
      action()
    } catch (e: MeshBackendError) {
      throw CodedException(e.code, e.message, e)
    }
  }

  private fun peerMap(p: NativePeer) = mapOf("id" to p.id, "nickname" to p.nickname, "reachable" to p.reachable)

  private fun emit(event: MeshBackendEvent) {
    when (event) {
      is MeshBackendEvent.Peers -> sendEvent("onPeers", mapOf("peers" to event.peers.map(::peerMap)))
      is MeshBackendEvent.Message -> with(event.message) {
        sendEvent("onMessage", mapOf(
          "id" to id, "from" to from, "fromNickname" to fromNickname, "text" to text,
          "channel" to channel, "receivedAt" to receivedAt.toDouble(),
        ))
      }
      is MeshBackendEvent.State -> sendEvent("onState", buildMap {
        put("state", event.state.raw)
        event.detail?.let { put("detail", it) }
      })
    }
  }
}
