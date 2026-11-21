import { useMemo, useState } from 'react';
import {
  PixelRatio,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { createDefaultTransport, TransportProvider } from './src/transport/TransportContext';
import { PositionProvider } from './src/locate/PositionContext';
import { TalkScreen } from './src/screens/TalkScreen';
import { LocateScreen } from './src/screens/LocateScreen';
import { AskScreen } from './src/screens/AskScreen';
import { colors, fontSize, fontWeight, layout, scaledFontSize, spacing } from './src/theme/tokens';

type TabId = 'talk' | 'locate' | 'ask';

const TABS: { id: TabId; label: string }[] = [
  { id: 'talk', label: 'Talk' },
  { id: 'locate', label: 'Locate' },
  { id: 'ask', label: 'Ask' },
];

export default function App() {
  const transport = useMemo(() => createDefaultTransport(), []);
  const [tab, setTab] = useState<TabId>('talk');
  // Scalable text (PLAN.md section 6): follow the system text size.
  const textScale = PixelRatio.getFontScale();

  return (
    <TransportProvider transport={transport}>
      <PositionProvider>
        <SafeAreaView style={styles.container}>
          <View style={styles.tabBar}>
            {TABS.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[styles.tab, tab === item.id && styles.tabActive]}
                onPress={() => setTab(item.id)}
                accessibilityRole="button"
              >
                <Text
                  style={[
                    styles.tabLabel,
                    { fontSize: scaledFontSize(fontSize.body, textScale) },
                    tab === item.id && styles.tabLabelActive,
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.body}>
            {tab === 'talk' && <TalkScreen />}
            {tab === 'locate' && <LocateScreen />}
            {tab === 'ask' && <AskScreen />}
          </View>
        </SafeAreaView>
      </PositionProvider>
    </TransportProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: layout.borderWidth,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    minHeight: layout.minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: { backgroundColor: colors.surfaceRaised },
  tabLabel: { color: colors.textMuted, fontWeight: fontWeight.medium },
  tabLabelActive: { color: colors.accent, fontWeight: fontWeight.bold },
  body: { flex: 1 },
});
