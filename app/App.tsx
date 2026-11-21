import { useState } from 'react';
import { View } from 'react-native';
import { useFonts } from 'expo-font';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { AtkinsonHyperlegibleNext_400Regular } from '@expo-google-fonts/atkinson-hyperlegible-next/400Regular';
import { AtkinsonHyperlegibleNext_600SemiBold } from '@expo-google-fonts/atkinson-hyperlegible-next/600SemiBold';
import { MeshApp } from './src/AppShell';
import { AppRuntime } from './src/store/Runtime';
import { createTransport } from './src/transport/factory';
import { tokens as t } from './src/theme/tokens';

export default function App() {
  const [runtime] = useState(() => new AppRuntime(createTransport()));
  // The typeface and icons are bundled with the app, so they work offline.
  const [loaded, error] = useFonts({
    AtkinsonHyperlegibleNext_400Regular,
    AtkinsonHyperlegibleNext_600SemiBold,
    ...MaterialIcons.font,
  });
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: t.color.surface }} />;
  return <MeshApp runtime={runtime} />;
}
