import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, ScrollViewInstance, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { DeveloperPanel } from './components/DeveloperPanel';
import { Body, Notice, styles } from './components/ui';
import { MapFocus } from './map/types';
import { AskScreen, DISCLAIMER } from './screens/AskScreen';
import { LocateScreen } from './screens/LocateScreen';
import { TalkScreen } from './screens/TalkScreen';
import { AppRuntime, RuntimeProvider, useMesh, useRuntime } from './store/Runtime';
import { tokens as t } from './theme/tokens';
import { LinkState } from './transport/types';

type Screen = 'Talk' | 'Locate' | 'Ask';
const TABS: Screen[] = ['Talk', 'Locate', 'Ask'];
const LINK_COPY: Record<LinkState, string> = {
  starting: 'Starting the nearby link…', running: 'Link is ready', bluetooth_off: 'Bluetooth is off. Turn it on in Settings to connect nearby.',
  unauthorized: 'Bluetooth permission denied. Allow Bluetooth in Settings to connect.', unsupported: 'This device cannot run the mesh link.', stopped: 'The nearby link is stopped.',
};

function AppShell() {
  const runtime = useRuntime();
  const mesh = useMesh();
  const [screen, setScreen] = useState<Screen>('Talk');
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const openScreen = (next: Screen) => { setScreen(next); scroll.current?.scrollTo({ y: 0, animated: false }); };
  return <SafeAreaView style={local.safe}>
    <StatusBar style="dark" />
    <KeyboardAvoidingView style={local.frame} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={local.header}>
        <Text accessibilityRole="header" style={local.brand}>MESH HELP</Text>
        <View style={styles.row}>
          <View style={local.badge}><Text style={local.badgeText}>{runtime.kind === 'simulated' ? 'Simulated link' : runtime.kind === 'hublink' ? 'Hub link (dev, via Mac)' : 'BitChat mesh'}</Text></View>
          <Text style={local.link}>{mesh.link === 'running' ? `${mesh.peers.filter(peer => peer.reachable).length} nearby` : LINK_COPY[mesh.link]}</Text>
        </View>
      </View>
      {mesh.link !== 'running' && <Notice>{mesh.detail ?? LINK_COPY[mesh.link]}</Notice>}
      <ScrollView ref={scroll} testID="main-scroll" contentContainerStyle={local.content} keyboardShouldPersistTaps="handled">
        {screen === 'Talk' && <TalkScreen openPin={pin => { setFocus(pin); openScreen('Locate'); }} openAsk={() => openScreen('Ask')} />}
        {screen === 'Locate' && <LocateScreen focus={focus} clearFocus={() => setFocus(null)} />}
        {screen === 'Ask' && <AskScreen openLocate={() => { setFocus(null); openScreen('Locate'); }} />}
        <DeveloperPanel />
        <Body style={styles.small}>Mesh Help · Talk, locate and ask when the phone network is down.</Body>
      </ScrollView>
      {screen === 'Ask' && <View style={local.disclaimer}><Body style={styles.small}>{DISCLAIMER}</Body></View>}
      <View accessibilityRole="tablist" style={local.tabs}>
        {TABS.map(tab => <Pressable key={tab} accessibilityRole="tab" accessibilityLabel={tab} accessibilityState={{ selected: screen === tab }}
          onPress={() => openScreen(tab)} style={[local.tab, screen === tab && local.activeTab]}>
          <Text style={[local.tabText, screen === tab && local.activeText]}>{tab}</Text>
        </Pressable>)}
      </View>
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
  brand: { color: t.color.white, fontSize: t.font.label, fontWeight: t.weight.bold, letterSpacing: 3 },
  badge: { backgroundColor: t.color.primarySoft, paddingHorizontal: t.space.sm, paddingVertical: t.space.xs, borderRadius: t.radius.pill },
  badgeText: { color: t.color.ink, fontSize: t.font.small, fontWeight: t.weight.bold },
  link: { color: t.color.white, fontSize: t.font.small, flexShrink: 1 },
  content: { padding: t.space.lg, gap: t.space.lg, paddingBottom: t.space.xl },
  disclaimer: { backgroundColor: t.color.warningSoft, paddingHorizontal: t.space.md, paddingVertical: t.space.sm, borderTopWidth: 1, borderColor: t.color.border },
  tabs: { backgroundColor: t.color.surface, flexDirection: 'row', gap: t.space.xs, padding: t.space.sm, borderTopWidth: 1, borderColor: t.color.border },
  tab: { flex: 1, minHeight: t.target, padding: t.space.md, justifyContent: 'center', alignItems: 'center', borderRadius: t.radius.sm },
  activeTab: { backgroundColor: t.color.primary },
  tabText: { fontSize: t.font.label, fontWeight: t.weight.bold, color: t.color.ink },
  activeText: { color: t.color.white },
});
