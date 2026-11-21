import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';
import { dark, light, Palette } from './tokens';

interface Theme { c: Palette; scheme: 'dark' | 'light'; reduceMotion: boolean }
const ThemeContext = createContext<Theme>({ c: dark, scheme: 'dark', reduceMotion: false });

/** Follows the phone's light or dark setting, with dark as the default. Respects "reduce motion". */
export function ThemeProvider({ children, scheme: forced }: PropsWithChildren<{ scheme?: 'dark' | 'light' }>) {
  const system = useColorScheme();
  const scheme = forced ?? (system === 'light' ? 'light' : 'dark');
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then(value => { if (live) setReduceMotion(value); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduceMotion);
    return () => { live = false; sub?.remove(); };
  }, []);
  const value = useMemo(() => ({ c: scheme === 'light' ? light : dark, scheme, reduceMotion }), [scheme, reduceMotion]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme { return useContext(ThemeContext); }

/** Builds a StyleSheet-like object from the current palette, once per palette. */
export function useStyles<T>(factory: (c: Palette) => T): T {
  const { c } = useTheme();
  return useMemo(() => factory(c), [c, factory]);
}
