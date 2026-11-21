import { useEffect, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  MeshMessage,
  PUBLIC_CHANNEL,
  Peer,
  PeerId,
  SELF_PEER_ID,
} from '../transport/Transport';
import { useTransport } from '../transport/TransportContext';
import { MAX_MESSAGE_BYTES, prefixBytes, utf8Bytes } from '../ask/meshMessages';
import { colors, fontSize, fontWeight, layout, spacing } from '../theme/tokens';

type ConversationId = PeerId | typeof PUBLIC_CHANNEL;

export function TalkScreen() {
  const transport = useTransport();
  const [peers, setPeers] = useState<Peer[]>(() => transport.peers());
  const [selected, setSelected] = useState<ConversationId>(PUBLIC_CHANNEL);
  const [messages, setMessages] = useState<MeshMessage[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const unsubscribe = transport.subscribe((message) => {
      setMessages((prev) => [...prev, message]);
      setPeers(transport.peers());
    });
    return unsubscribe;
  }, [transport]);

  const phonePeers = peers.filter((peer) => peer.kind === 'phone');
  const conversations: { id: ConversationId; label: string }[] = [
    { id: PUBLIC_CHANNEL, label: 'Public' },
    ...peers.map((peer) => ({
      id: peer.id as ConversationId,
      label: peer.kind === 'hub' ? `${peer.name}` : peer.name,
    })),
  ];
  const visible = messages.filter(
    (message) =>
      message.to === PUBLIC_CHANNEL ||
      (message.from === selected && message.to === SELF_PEER_ID) ||
      (message.to === selected && message.from === SELF_PEER_ID),
  );

  function send() {
    const text = draft.trim();
    // BitChat rejects message content over 255 UTF-8 bytes.
    if (text === '' || utf8Bytes(text) > MAX_MESSAGE_BYTES) return;
    const sent = transport.send(selected, text);
    setMessages((prev) => [...prev, sent]);
    setDraft('');
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.peerRow}>
        {conversations.map((conversation) => (
          <TouchableOpacity
            key={conversation.id}
            style={[styles.peerChip, selected === conversation.id && styles.peerChipActive]}
            onPress={() => setSelected(conversation.id)}
            accessibilityRole="button"
          >
            <Text
              style={[
                styles.peerChipText,
                selected === conversation.id && styles.peerChipTextActive,
              ]}
            >
              {conversation.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {phonePeers.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No one nearby</Text>
          <Text style={styles.emptyHint}>
            When another phone joins the mesh it will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          style={styles.messageList}
          data={visible}
          keyExtractor={(message) => message.id}
          renderItem={({ item }) => {
            const mine = item.from === SELF_PEER_ID;
            return (
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                <Text style={styles.bubbleText}>{item.text}</Text>
              </View>
            );
          }}
        />
      )}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={(text) => setDraft(prefixBytes(text, MAX_MESSAGE_BYTES))}
          placeholder="Message the mesh"
          placeholderTextColor={colors.textMuted}
          onSubmitEditing={send}
        />
        <TouchableOpacity style={styles.sendButton} onPress={send} accessibilityRole="button">
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  peerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  peerChip: {
    minHeight: layout.minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: layout.radiusLg,
    borderWidth: layout.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  peerChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  peerChipText: { color: colors.text, fontSize: fontSize.body, fontWeight: fontWeight.medium },
  peerChipTextActive: { color: colors.accentText },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyTitle: { color: colors.text, fontSize: fontSize.title, fontWeight: fontWeight.bold },
  emptyHint: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  messageList: { flex: 1, paddingHorizontal: spacing.lg },
  bubble: {
    maxWidth: '80%',
    borderRadius: layout.radiusMd,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: colors.surfaceRaised },
  bubbleTheirs: { alignSelf: 'flex-start', backgroundColor: colors.surface },
  bubbleText: { color: colors.text, fontSize: fontSize.body },
  inputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minHeight: layout.minTapTarget,
    borderRadius: layout.radiusMd,
    borderWidth: layout.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: fontSize.body,
    paddingHorizontal: spacing.lg,
  },
  sendButton: {
    minHeight: layout.minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    borderRadius: layout.radiusMd,
    backgroundColor: colors.accent,
  },
  sendButtonText: { color: colors.accentText, fontSize: fontSize.body, fontWeight: fontWeight.bold },
});
