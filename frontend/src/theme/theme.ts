// ═══════════════════════════════════════════════════════════════
//  App-wide theme system – Dual palettes (Dark / Light) + MUI theme
// ═══════════════════════════════════════════════════════════════

import { createTheme } from '@mui/material/styles';

// ── Font tokens (shared) ───────────────────────────────────────
const font = {
  display: '"Syne", sans-serif',
  ui:      '"Figtree", sans-serif',
  mono:    '"JetBrains Mono", monospace',
} as const;

// ── Light palette (default) ────────────────────────────────────
export const lightPalette = {
  dark: {
    bg:        '#f0f2f5',
    bgHover:   '#e6e9ee',
    bgSelected:'#dff0ee',
    bgInput:   '#ffffff',
    border:    'rgba(0, 0, 0, 0.08)',
    borderSub: 'rgba(0, 0, 0, 0.04)',
    text:      '#374151',
    textMuted: '#9ca3af',
    textBright:'#111827',
  },
  light: {
    bg:        '#f7f8fa',
    surface:   '#ffffff',
    border:    '#e5e7eb',
    text:      '#111827',
    textMuted: '#9ca3af',
  },
  accent: {
    primary:      '#0d9488',
    primaryDim:   'rgba(13, 148, 136, 0.08)',
    primaryHover: '#0f766e',
    danger:       '#ef4444',
    dangerHover:  '#dc2626',
    warning:      '#f59e0b',
    success:      '#22c55e',
  },
  font,
} as const;

// ── Dark palette ───────────────────────────────────────────────
export const darkPalette = {
  dark: {
    bg:        '#1e1e2e',
    bgHover:   '#2a2a3c',
    bgSelected:'#1a3332',
    bgInput:   '#2a2a3c',
    border:    'rgba(255, 255, 255, 0.08)',
    borderSub: 'rgba(255, 255, 255, 0.04)',
    text:      '#c9d1d9',
    textMuted: '#6b7280',
    textBright:'#e6edf3',
  },
  light: {
    bg:        '#161622',
    surface:   '#1e1e2e',
    border:    '#30304a',
    text:      '#e6edf3',
    textMuted: '#6b7280',
  },
  accent: {
    primary:      '#2dd4bf',
    primaryDim:   'rgba(45, 212, 191, 0.10)',
    primaryHover: '#14b8a6',
    danger:       '#f87171',
    dangerHover:  '#ef4444',
    warning:      '#fbbf24',
    success:      '#4ade80',
  },
  font,
} as const;

/** Palette type — structural interface so both palettes are assignable */
export interface Palette {
  dark: {
    bg: string;
    bgHover: string;
    bgSelected: string;
    bgInput: string;
    border: string;
    borderSub: string;
    text: string;
    textMuted: string;
    textBright: string;
  };
  light: {
    bg: string;
    surface: string;
    border: string;
    text: string;
    textMuted: string;
  };
  accent: {
    primary: string;
    primaryDim: string;
    primaryHover: string;
    danger: string;
    dangerHover: string;
    warning: string;
    success: string;
  };
  font: {
    display: string;
    ui: string;
    mono: string;
  };
}

/** Build reusable sx fragments from a given palette */
export function createSx(P: Palette) {
  return {
    /** Section label inside the sidebar */
    sidebarLabel: {
      fontFamily: P.font.ui,
      fontSize: '0.65rem',
      fontWeight: 600,
      letterSpacing: '0.08em',
      textTransform: 'uppercase' as const,
      color: P.dark.textMuted,
      px: 1.5,
      py: 0.75,
    },

    /** Subtle icon button on dark bg */
    darkIconBtn: {
      color: P.dark.textMuted,
      '&:hover': { color: P.dark.text, bgcolor: P.dark.bgHover },
    },

    /** Pill / badge on dark bg */
    darkBadge: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 0.5,
      fontSize: '0.6rem',
      fontWeight: 600,
      fontFamily: P.font.mono,
      px: 0.75,
      py: 0.25,
      borderRadius: 1,
      lineHeight: 1,
    },

    /** Input field on dark bg */
    darkInput: {
      '& .MuiOutlinedInput-root': {
        bgcolor: P.dark.bgInput,
        color: P.dark.text,
        fontFamily: P.font.ui,
        fontSize: '0.85rem',
        '& fieldset': { borderColor: P.dark.border },
        '&:hover fieldset': { borderColor: P.accent.primary },
        '&.Mui-focused fieldset': { borderColor: P.accent.primary },
      },
      '& .MuiInputBase-input::placeholder': {
        color: P.dark.textMuted,
        opacity: 1,
      },
    },
  } as const;
}

/** Sx tokens type */
export type SxTokens = ReturnType<typeof createSx>;

export type ThemeMode = 'light' | 'dark';

/** Create a full MUI theme that reacts to the current mode */
export function createAppTheme(mode: ThemeMode) {
  const isLight = mode === 'light';
  return createTheme({
    palette: {
      mode,
      primary: {
        main: isLight ? '#0d9488' : '#2dd4bf',
      },
      secondary: {
        main: isLight ? '#0f766e' : '#14b8a6',
      },
      background: {
        default: isLight ? '#f7f8fa' : '#161622',
        paper: isLight ? '#ffffff' : '#1e1e2e',
      },
      error: {
        main: isLight ? '#ef4444' : '#f87171',
      },
      warning: {
        main: isLight ? '#f59e0b' : '#fbbf24',
      },
      success: {
        main: isLight ? '#22c55e' : '#4ade80',
      },
    },
    typography: {
      fontFamily: '"Figtree", "Helvetica", "Arial", sans-serif',
      h1: { fontFamily: '"Syne", sans-serif' },
      h2: { fontFamily: '"Syne", sans-serif' },
      h3: { fontFamily: '"Syne", sans-serif' },
      h4: { fontFamily: '"Syne", sans-serif' },
      h5: { fontFamily: '"Syne", sans-serif' },
      h6: { fontFamily: '"Syne", sans-serif' },
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
          },
        },
      },
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            fontFamily: '"Figtree", "Helvetica", "Arial", sans-serif',
          },
        },
      },
    },
  });
}
