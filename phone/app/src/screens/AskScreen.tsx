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
import { AskMachine, AskRecord } from '../ask/askStateMachine';
import { config } from '../config';
import { useTransport } from '../transport/TransportContext';
import { usePositionContext } from '../locate/PositionContext';
import { formatLocLine } from '../locate/locLine';
import { AskStatusBadge } from '../components/AskStatusBadge';
import {
  ANSWER_LABEL,
  AnswerPart,
  assembleAnswer,
  classifyHubReply,
  MAX_QUESTION_BYTES,
  prefixBytes,
  utf8Bytes,
} from '../ask/meshMessages';
import { colors, fontSize, fontWeight, layout, spacing } from '../theme/tokens';

export const SUGGESTED_QUESTIONS = [
  'How do I make water safe to drink?',
  'How do I stop heavy bleeding?',
  'What should I do if someone is not breathing?',
  'How do I stay warm and dry overnight?',
];

/** Every answer is labelled with this, word for word per BLUEPRINT_1.md. */
export const AI_ANSWER_LABEL =
  'AI answer from an open-weight model on the hub. Not verified emergency advice.';

interface AskItem extends AskRecord {
  machine: AskMachine;
}

export function AskScreen() {
  const transport = useTransport();
  const position = usePositionContext();
  const [items, setItems] = useState<AskItem[]>([]);
  const [draft, setDraft] = useState('');
  const [attachLocation, setAttachLocation] = useState(false);
  const machinesRef = useRef<Map<string, AskMachine>>(new Map());
  const partsRef = useRef<Map<string, AnswerPart[]>>(new Map());
  const counterRef = useRef(0);

  useEffect(() => {
    const unsubscribe = transport.subscribe((message) => {
      if (message.from !== config.hubPeerId) return;
      const entries = [...machinesRef.current.entries()];
      const reply = classifyHubReply(message.text);
      const isAck = reply.kind === 'ack';
      // The hub answers in order: the ack goes to the oldest unacked
      // question, the answer to the oldest unanswered one.
      const entry = isAck
        ? entries.find(([, machine]) => machine.current === 'sent')
        : entries.find(([, machine]) => machine.current === 'receivedByHub') ??
          entries.find(([, machine]) => machine.current === 'sent');
      if (!entry) return;
      const [id, machine] = entry;
      if (isAck) {
        machine.dispatch({ type: 'hubAck' });
        return;
      }
      let answer = message.text;
      if (reply.kind === 'answer_part') {
        // The hub sends each answer as "(i/n) " parts to fit BitChat's
        // 255-byte limit (protocol/README.md). Answered once all have arrived.
        const parts = [...(partsRef.current.get(id) ?? []), reply];
        const body = assembleAnswer(parts);
        if (body === null) {
          partsRef.current.set(id, parts);
          return;
        }
        partsRef.current.delete(id);
        answer = `${body}\n${ANSWER_LABEL}`;
      }
      machine.dispatch({ type: 'answer' });
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, answer } : item)),
      );
    });
    return unsubscribe;
  }, [transport]);

  useEffect(() => {
    const machines = machinesRef.current;
    return () => {
      for (const machine of machines.values()) machine.dispose();
    };
  }, []);

  function ask(question: string) {
    const text = question.trim();
    // Capped so the question plus its loc: line fits one BitChat message.
    if (text === '' || utf8Bytes(text) > MAX_QUESTION_BYTES) return;
    const coords = position.coords;
    const payload =
      attachLocation && coords ? `${text}\n${formatLocLine(coords)}` : text;
    counterRef.current += 1;
    const id = `ask-${counterRef.current}`;
    const machine = new AskMachine({
      timeoutMs: config.hubTimeoutMs,
      onChange: (status) =>
        setItems((prev) => prev.map((item) => (item.id === id ? { ...item, status } : item))),
    });
    machinesRef.current.set(id, machine);
    const item: AskItem = {
      id,
      question: text,
      payload,
      status: 'sent',
      answer: null,
      sentAt: Date.now(),
      machine,
    };
    setItems((prev) => [...prev, item]);
    transport.send(config.hubPeerId, payload);
  }

  function retry(item: AskItem) {
    item.machine.dispatch({ type: 'retry' });
    partsRef.current.delete(item.id);
    transport.send(config.hubPeerId, item.payload);
  }

  function sendDraft() {
    ask(draft);
    setDraft('');
  }

  const canAttach = position.status === 'fix' && position.coords !== null;

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
            ? item.answer.endsWith(AI_ANSWER_LABEL)
              ? item.answer
              : `${item.answer}\n${AI_ANSWER_LABEL}`
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
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={(text) => setDraft(prefixBytes(text, MAX_QUESTION_BYTES))}
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
