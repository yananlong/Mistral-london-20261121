import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AskFlow, AskFlowItem, AskFlowSnapshot } from '../ask/askFlow';
import { HUB_ACK_TEXT, HUB_ANSWER_LABEL } from '../transport/protocol';
import { HUB_PEER_ID } from '../transport/SimulatedTransport';
import { useTransport } from '../transport/TransportContext';
import { usePositionContext } from '../locate/PositionContext';
import { formatLocLine } from '../locate/locLine';
import { AskStatusBadge } from '../components/AskStatusBadge';
import { colors, fontSize, fontWeight, layout, spacing } from '../theme/tokens';

export const SUGGESTED_QUESTIONS = [
  'How do I make water safe to drink?',
  'How do I stop heavy bleeding?',
  'What should I do if someone is not breathing?',
  'How do I stay warm and dry overnight?',
];

export function AskScreen() {
  const transport = useTransport();
  const position = usePositionContext();
  const [snapshot, setSnapshot] = useState<AskFlowSnapshot>({ items: [], queuedCount: 0 });
  const [draft, setDraft] = useState('');
  const [attachLocation, setAttachLocation] = useState(false);
  const flowRef = useRef<AskFlow | null>(null);

  useEffect(() => {
    const flow = new AskFlow({
      sendToHub: (payload) => transport.send(HUB_PEER_ID, payload),
      onChange: setSnapshot,
    });
    flowRef.current = flow;
    const unsubscribe = transport.subscribe((message) => {
      if (message.from !== HUB_PEER_ID) return;
      flow.handleHubMessage(message.text, message.text === HUB_ACK_TEXT);
    });
    return () => {
      unsubscribe();
      flow.dispose();
      flowRef.current = null;
    };
  }, [transport]);

  function ask(question: string) {
    const text = question.trim();
    if (text === '') return;
    const coords = position.coords;
    const payload =
      attachLocation && coords ? `${text}\n${formatLocLine(coords)}` : text;
    flowRef.current?.ask(text, payload);
  }

  function retry(item: AskFlowItem) {
    flowRef.current?.retry(item.id);
  }

  function sendDraft() {
    ask(draft);
    setDraft('');
  }

  const canAttach = position.status === 'fix' && position.coords !== null;
  const items = snapshot.items;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.suggestions}>
        {SUGGESTED_QUESTIONS.map((question) => (
          <TouchableOpacity
            key={question}
            style={styles.suggestionChip}
            onPress={() => ask(question)}
            accessibilityRole="button"
          >
            <Text style={styles.suggestionText}>{question}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        style={styles.list}
        data={[...items].reverse()}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const answer = item.answer
            ? item.answer.endsWith(HUB_ANSWER_LABEL)
              ? item.answer
              : `${item.answer}\n${HUB_ANSWER_LABEL}`
            : null;
          return (
            <View style={styles.card}>
              <Text style={styles.question}>{item.question}</Text>
              <AskStatusBadge status={item.status} />
              {item.status === 'receivedByHub' && (
                <Text style={styles.coming}>Answer still coming…</Text>
              )}
              {item.status === 'hubNotReachable' && (
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={() => retry(item)}
                  accessibilityRole="button"
                >
                  <Text style={styles.retryButtonText}>Retry</Text>
                </TouchableOpacity>
              )}
              {answer && (
                <View style={styles.answerBox}>
                  <Text style={styles.answerText}>{answer}</Text>
                </View>
              )}
            </View>
          );
        }}
      />
      <View style={styles.inputArea}>
        <View style={styles.attachRow}>
          <Switch
            value={attachLocation}
            onValueChange={setAttachLocation}
            disabled={!canAttach}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={colors.text}
          />
          <Text style={styles.attachLabel}>
            {canAttach ? 'Attach my location (loc: line)' : 'Attach my location (no position fix yet)'}
          </Text>
        </View>
        {snapshot.queuedCount > 0 && (
          <Text style={styles.queuedHint}>
            {snapshot.queuedCount} more question{snapshot.queuedCount === 1 ? '' : 's'} queued —
            the hub takes one at a time
          </Text>
        )}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask the hub…"
            placeholderTextColor={colors.textMuted}
            onSubmitEditing={sendDraft}
            multiline
          />
          <TouchableOpacity style={styles.sendButton} onPress={sendDraft} accessibilityRole="button">
            <Text style={styles.sendButtonText}>Ask</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  suggestionChip: {
    minHeight: layout.minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: layout.radiusLg,
    borderWidth: layout.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  suggestionText: { color: colors.text, fontSize: fontSize.body, fontWeight: fontWeight.medium },
  list: { flex: 1, paddingHorizontal: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.radiusMd,
    borderWidth: layout.borderWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  question: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.sm,
  },
  coming: { color: colors.textMuted, fontSize: fontSize.body, marginTop: spacing.sm },
  retryButton: {
    marginTop: spacing.md,
    minHeight: layout.minTapTarget,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    borderRadius: layout.radiusMd,
    backgroundColor: colors.warning,
  },
  retryButtonText: {
    color: colors.accentText,
    fontSize: fontSize.body,
    fontWeight: fontWeight.bold,
  },
  answerBox: {
    marginTop: spacing.md,
    borderRadius: layout.radiusSm,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.md,
  },
  answerText: { color: colors.text, fontSize: fontSize.body },
  inputArea: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: layout.borderWidth,
    borderTopColor: colors.border,
  },
  attachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: layout.minTapTarget,
  },
  attachLabel: { color: colors.textMuted, fontSize: fontSize.caption, flex: 1 },
  queuedHint: { color: colors.textMuted, fontSize: fontSize.caption, marginBottom: spacing.sm },
  inputRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' },
  input: {
    flex: 1,
    minHeight: layout.minTapTarget,
    maxHeight: 120,
    borderRadius: layout.radiusMd,
    borderWidth: layout.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    color: colors.text,
    fontSize: fontSize.body,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
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
