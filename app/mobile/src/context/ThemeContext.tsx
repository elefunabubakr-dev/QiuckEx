import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import {
  Appearance,
  ColorSchemeName,
  useColorScheme,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ThemeMode,
  ThemeTokens,
  ThemeRegistry,
  themeTokens,
} from '../theme/tokens';

const THEME_STORAGE_KEY = '@quickex_theme_mode';

interface ThemeContextValue {
  mode: ThemeMode;
  systemScheme: ColorSchemeName;
  isDark: boolean;
  tokens: ThemeTokens;
  setMode: (mode: ThemeMode) => Promise<void>;
  toggleMode: () => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [isReady, setIsReady] = useState(false);

  // Load persisted theme on mount
  useEffect(() => {
    let mounted = true;
    
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((stored) => {
        if (!mounted) return;
        if (stored && ['system', 'light', 'dark'].includes(stored)) {
          setModeState(stored as ThemeMode);
        }
        setIsReady(true);
      })
      .catch(() => setIsReady(true));
    
    return () => { mounted = false; };
  }, []);

  // Listen to system appearance changes
  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      if (mode === 'system') {
        // Force re-render when system changes while in system mode
        setModeState((prev) => prev);
      }
    });
    
    return () => subscription.remove();
  }, [mode]);

  const isDark = useMemo(() => {
    if (mode === 'system') return systemColorScheme === 'dark';
    return mode === 'dark';
  }, [mode, systemColorScheme]);

  const setMode = useCallback(async (newMode: ThemeMode) => {
    setModeState(newMode);
    await AsyncStorage.setItem(THEME_STORAGE_KEY, newMode);
  }, []);

  const toggleMode = useCallback(async () => {
    const next: ThemeMode = 
      mode === 'system' ? (isDark ? 'light' : 'dark') :
      mode === 'light' ? 'dark' : 'system';
    await setMode(next);
  }, [mode, isDark, setMode]);

  const value = useMemo(
    () => {
      // Select the correct theme tokens based on the current mode
      let selectedTheme: ThemeTokens;
      if (mode === 'system') {
        selectedTheme = systemColorScheme === 'dark' ? ThemeRegistry.dark : ThemeRegistry.light;
      } else if (mode === 'brand') {
        // Brand mode defaults to QuickEx Blue (first brand theme)
        selectedTheme = ThemeRegistry['quickex-blue'];
      } else {
        selectedTheme = ThemeRegistry[mode];
      }
      
      return {
        mode,
        systemScheme: systemColorScheme,
        isDark,
        tokens: selectedTheme,
        setMode,
        toggleMode,
      };
    },
    [mode, systemColorScheme, isDark, setMode, toggleMode]
  );

  if (!isReady) return null;

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}