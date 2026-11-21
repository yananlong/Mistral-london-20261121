import { AtkinsonHyperlegibleNext_400Regular, AtkinsonHyperlegibleNext_600SemiBold, useFonts } from '@expo-google-fonts/atkinson-hyperlegible-next';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { HomeScreen } from './screens/HomeScreen';
import { AppRuntime, RuntimeProvider } from './store/Runtime';
import { ThemeProvider, useTheme } from './theme/theme';

function AppShell() {
  const { c, scheme } = useTheme();
  // The typeface is bundled with the app, so this works with nothing connected.
  const [loaded, error] = useFonts({ AtkinsonHyperlegibleNext_400Regular, AtkinsonHyperlegibleNext_600SemiBold });
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}>
    <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    {loaded || error ? <HomeScreen /> : <View style={{ flex: 1 }} />}
  </SafeAreaView>;
}

export function MeshApp({ runtime, scheme }: { runtime: AppRuntime; scheme?: 'dark' | 'light' }) {
  return <SafeAreaProvider><ThemeProvider scheme={scheme}><RuntimeProvider runtime={runtime}><AppShell /></RuntimeProvider></ThemeProvider></SafeAreaProvider>;
}
