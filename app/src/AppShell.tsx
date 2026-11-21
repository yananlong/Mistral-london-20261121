import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, ScrollViewInstance, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { DeveloperPanel } from './components/DeveloperPanel';
import { EmergencySheet } from './components/EmergencySheet';
import { Body, Notice, styles } from './components/ui';
import { MapFocus } from './map/types';
import { AskScreen, DISCLAIMER } from './screens/AskScreen';
import { LocateScreen } from './screens/LocateScreen';
import { TalkScreen } from './screens/TalkScreen';
import { AppRuntime, RuntimeProvider, useMesh, useRuntime } from './store/Runtime';
import { tokens as t } from './theme/tokens';
import { LinkState } from './transport/types';

/**
 * Two fixed bottom tabs, Instagram-style, so the layout stays still no matter
 * how many people or questions are on the mesh:
 *   Info   — the first view: access information (Ask the hub, Locate on the map)
 *            with a pinned Ask/Locate switcher above the scrolling content.
 *   Chats  — Talk: communicate with family and the people around you.
 * The header holds a small SOS action (a guided flow, not a big red button).
 */
type Tab = 'info' | 'chats';
type InfoView = 'ask' | 'locate';
const TABS: { id: Tab; label: string }[] = [
  { id: 'info', label: 'Info' },
  { id: 'chats', label: 'Chats' },
];
const INFO_VIEWS: { id: InfoView; label: string }[] = [
  { id: 'ask', label: 'Ask' },
  { id: 'locate', label: 'Locate' },
];
const LINK_COPY: Record<LinkState, string> = {
  starting: 'Starting the nearby link…', running: 'Link is ready', bluetooth_off: 'Bluetooth is off. Turn it on in Settings to connect nearby.',
  unauthorized: 'Bluetooth permission denied. Allow Bluetooth in Settings to connect.', unsupported: 'This device cannot run the mesh link.', stopped: 'The nearby link is stopped.',
};

function AppShell() {
  const runtime = useRuntime();
  const mesh = useMesh();
  const [tab, setTab] = useState<Tab>('info');
  const [infoView, setInfoView] = useState<InfoView>('ask');
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [sosOpen, setSosOpen] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const openTab = (next: Tab) => { setTab(next); scroll.current?.scrollTo({ y: 0, animated: false }); };
  const openInfo = (view: InfoView) => { setInfoView(view); setTab('info'); scroll.current?.scrollTo({ y: 0, animated: false }); };
  return <SafeAreaView style={local.safe}>
    <StatusBar style="dark" />
    <KeyboardAvoidingView style={local.frame} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={local.header}>
        <View style={local.brandRow}>
          <Text accessibilityRole="header" style={local.brand}>MESH HELP</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="SOS — emergency options" onPress={() => setSosOpen(true)} style={local.sosButton}>
            <Text style={local.sosText}>SOS</Text>
          </Pressable>
        </View>
        <View style={styles.row}>
          <View style={local.badge}><Text style={local.badgeText}>{runtime.kind === 'simulated' ? 'Simulated link' : 'BitChat mesh'}</Text></View>
          <Text style={local.link}>{mesh.link === 'running' ? `${mesh.peers.filter(peer => peer.reachable).length} nearby` : LINK_COPY[mesh.link]}</Text>
        </View>
      </View>
      {mesh.link !== 'running' && <Notice>{mesh.detail ?? LINK_COPY[mesh.link]}</Notice>}
      {tab === 'info' && <View style={local.segment} accessibilityRole="tablist">
        {INFO_VIEWS.map(view => <Pressable key={view.id} accessibilityRole="tab" accessibilityLabel={view.label} accessibilityState={{ selected: infoView === view.id }}
          onPress={() => openInfo(view.id)} style={[local.segmentItem, infoView === view.id && local.segmentActive]}>
          <Text style={[local.segmentText, infoView === view.id && local.segmentTextActive]}>{view.label}</Text>
        </Pressable>)}
      </View>}
      <ScrollView ref={scroll} testID="main-scroll" contentContainerStyle={local.content} keyboardShouldPersistTaps="handled">
        {tab === 'info' && infoView === 'ask' && <AskScreen openLocate={() => openInfo('locate')} />}
        {tab === 'info' && infoView === 'locate' && <LocateScreen focus={focus} clearFocus={() => setFocus(null)} />}
        {tab === 'chats' && <TalkScreen openPin={pin => { setFocus(pin); openInfo('locate'); }} openAsk={() => openInfo('ask')} />}
        <DeveloperPanel />
        <Body style={styles.small}>Mesh Help · get information and reach people when the phone network is down.</Body>
      </ScrollView>
      {tab === 'info' && infoView === 'ask' && <View style={local.disclaimer}><Body style={styles.small}>{DISCLAIMER}</Body></View>}
      <View accessibilityRole="tablist" style={local.tabs}>
        {TABS.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected: tab === item.id }}
          onPress={() => openTab(item.id)} style={[local.tab, tab === item.id && local.activeTab]}>
          <Text style={[local.tabText, tab === item.id && local.activeText]}>{item.label}</Text>
        </Pressable>)}
      </View>
      <EmergencySheet visible={sosOpen} onClose={() => setSosOpen(false)}
        onNavigate={target => { setSosOpen(false); if (target === 'ask') openInfo('ask'); else openTab('chats'); }} />
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

export function MeshApp({ runtime }: { runtime: AppRuntime }) {
  return <SafeAreaProvider><RuntimeProvider runtime={runtime}><AppShell /></RuntimeProvider></SafeAreaProvider>;
}

const local = StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.color.background },
  frame: { flex: 1, width: '100%', maxWidth: t.contentWidth, alignSelf: 'center', backgroundColor: t.color.background },
  header: { backgroundColor: t.color.navy, padding: t.space.lg, gap: t.space.sm },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { color: t.color.white, fontSize: t.font.label, fontWeight: t.weight.bold, letterSpacing: 3 },
  // Small SOS pill in the header: present, but not a big appealing red button.
  sosButton: { backgroundColor: t.color.warningSoft, borderWidth: 1, borderColor: '#D7000F', borderRadius: t.radius.pill, paddingHorizontal: t.space.md, paddingVertical: t.space.xs },
  sosText: { color: '#D7000F', fontSize: t.font.small, fontWeight: t.weight.bold, letterSpacing: 1 },
  badge: { backgroundColor: t.color.primarySoft, paddingHorizontal: t.space.sm, paddingVertical: t.space.xs, borderRadius: t.radius.pill },
  badgeText: { color: t.color.ink, fontSize: t.font.small, fontWeight: t.weight.bold },
  link: { color: t.color.white, fontSize: t.font.small, flexShrink: 1 },
  segment: { flexDirection: 'row', gap: t.space.xs, backgroundColor: t.color.surface, padding: t.space.sm, borderBottomWidth: 1, borderColor: t.color.border },
  segmentItem: { flex: 1, minHeight: t.target, justifyContent: 'center', alignItems: 'center', borderRadius: t.radius.sm },
  segmentActive: { backgroundColor: t.color.primarySoft, borderWidth: 1, borderColor: t.color.primary },
  segmentText: { fontSize: t.font.body, fontWeight: t.weight.bold, color: t.color.muted },
  segmentTextActive: { color: t.color.primary },
  content: { padding: t.space.lg, gap: t.space.lg, paddingBottom: t.space.xl },
  disclaimer: { backgroundColor: t.color.warningSoft, paddingHorizontal: t.space.md, paddingVertical: t.space.sm, borderTopWidth: 1, borderColor: t.color.border },
  tabs: { backgroundColor: t.color.surface, flexDirection: 'row', gap: t.space.xs, padding: t.space.sm, borderTopWidth: 1, borderColor: t.color.border },
  tab: { flex: 1, minHeight: t.target, padding: t.space.md, justifyContent: 'center', alignItems: 'center', borderRadius: t.radius.sm },
  activeTab: { backgroundColor: t.color.primary },
  tabText: { fontSize: t.font.label, fontWeight: t.weight.bold, color: t.color.ink },
  activeText: { color: t.color.white },
});
