import { createContext, useContext, useState, useMemo, type ReactNode } from 'react';
import { lightPalette, darkPalette, createSx, type Palette, type SxTokens, type ThemeMode } from './theme';

interface AppThemeValue {
  P: Palette;
  sx: SxTokens;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
}

const AppThemeContext = createContext<AppThemeValue | null>(null);

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem('theme-mode');
    return stored === 'dark' ? 'dark' : 'light';
  });

  const value = useMemo<AppThemeValue>(() => {
    const P = mode === 'dark' ? darkPalette : lightPalette;
    return {
      P,
      sx: createSx(P),
      mode,
      setMode: (m: ThemeMode) => {
        setModeState(m);
        localStorage.setItem('theme-mode', m);
      },
      toggleMode: () => {
        setModeState(prev => {
          const next = prev === 'dark' ? 'light' : 'dark';
          localStorage.setItem('theme-mode', next);
          return next;
        });
      },
    };
  }, [mode]);

  return (
    <AppThemeContext.Provider value={value}>
      {children}
    </AppThemeContext.Provider>
  );
}

export function useAppTheme(): AppThemeValue {
  const ctx = useContext(AppThemeContext);
  if (!ctx) throw new Error('useAppTheme must be used inside <AppThemeProvider>');
  return ctx;
}
