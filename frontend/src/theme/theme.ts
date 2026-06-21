// ═══════════════════════════════════════════════════════════════
//  App-wide theme system – Dual palettes (Dark / Light) + MUI theme
//  Visual language: "Meridian" v2 — warm paper neutrals, sea-teal
//  primary, sunset-clay accent. Display in Bricolage Grotesque.
// ═══════════════════════════════════════════════════════════════

import { createTheme } from '@mui/material/styles';

// ── Font tokens (shared) ───────────────────────────────────────
const font = {
  display: '"Bricolage Grotesque", sans-serif',
  ui:      '"Figtree", sans-serif',
  mono:    '"JetBrains Mono", monospace',
} as const;

// ── Light palette (default) — Meridian warm paper ──────────────
export const lightPalette = {
  dark: {
    bg:        '#f4efe8',
    bgHover:   '#ece4d8',
    bgSelected:'#e6f2f0',
    bgInput:   '#ffffff',
    border:    'rgba(28, 25, 23, 0.10)',
    borderSub: 'rgba(28, 25, 23, 0.05)',
    text:      '#44403c',
    textMuted: '#a8a29e',
    textBright:'#1c1917',
  },
  light: {
    bg:        '#fbf8f3',
    surface:   '#ffffff',
    border:    '#e8e1d8',
    text:      '#1c1917',
    textMuted: '#79716b',
  },
  accent: {
    primary:      '#0f766e',
    primaryDim:   'rgba(15, 118, 110, 0.08)',
    primaryHover: '#115e56',
    clay:         '#c2683c',
    clayHover:    '#9a5530',
    danger:       '#c0492f',
    dangerHover:  '#a53d27',
    warning:      '#d9920a',
    success:      '#3f8f5b',
  },
  font,
} as const;

// ── Dark palette — Meridian warm dark ──────────────────────────
export const darkPalette = {
  dark: {
    bg:        '#1f1b16',
    bgHover:   '#2c2620',
    bgSelected:'rgba(45, 212, 191, 0.12)',
    bgInput:   '#2c2620',
    border:    'rgba(245, 241, 235, 0.10)',
    borderSub: 'rgba(245, 241, 235, 0.05)',
    text:      '#d8d0c7',
    textMuted: '#8a817a',
    textBright:'#f5f1eb',
  },
  light: {
    bg:        '#14110e',
    surface:   '#1f1b16',
    border:    '#2c2620',
    text:      '#f5f1eb',
    textMuted: '#8a817a',
  },
  accent: {
    primary:      '#2dd4bf',
    primaryDim:   'rgba(45, 212, 191, 0.12)',
    primaryHover: '#14b8a6',
    clay:         '#e08a5c',
    clayHover:    '#c2683c',
    danger:       '#f2785c',
    dangerHover:  '#e0603f',
    warning:      '#e9b949',
    success:      '#5fa877',
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
    /** Sunset-clay accent (Meridian) — warm counterpoint to the teal primary */
    clay: string;
    clayHover: string;
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

/** Create a full MUI theme that reacts to the current mode (Meridian v2) */
export function createAppTheme(mode: ThemeMode) {
  const isLight = mode === 'light';
  return createTheme({
    palette: {
      mode,
      primary: {
        main: isLight ? '#0f766e' : '#2dd4bf',
        dark: isLight ? '#115e56' : '#14b8a6',
      },
      secondary: {
        main: isLight ? '#c2683c' : '#e08a5c',
        dark: isLight ? '#9a5530' : '#c2683c',
      },
      background: {
        default: isLight ? '#fbf8f3' : '#14110e',
        paper: isLight ? '#ffffff' : '#1f1b16',
      },
      text: {
        primary: isLight ? '#1c1917' : '#f5f1eb',
        secondary: isLight ? '#79716b' : '#8a817a',
      },
      divider: isLight ? '#e8e1d8' : '#2c2620',
      error: {
        main: isLight ? '#c0492f' : '#f2785c',
      },
      warning: {
        main: isLight ? '#d9920a' : '#e9b949',
      },
      success: {
        main: isLight ? '#3f8f5b' : '#5fa877',
      },
    },
    typography: {
      fontFamily: '"Figtree", "Helvetica", "Arial", sans-serif',
      h1: { fontFamily: '"Bricolage Grotesque", sans-serif', fontWeight: 800, letterSpacing: '-0.025em' },
      h2: { fontFamily: '"Bricolage Grotesque", sans-serif', fontWeight: 700, letterSpacing: '-0.02em' },
      h3: { fontFamily: '"Bricolage Grotesque", sans-serif', fontWeight: 700, letterSpacing: '-0.015em' },
      h4: { fontFamily: '"Bricolage Grotesque", sans-serif', fontWeight: 700, letterSpacing: '-0.015em' },
      h5: { fontFamily: '"Bricolage Grotesque", sans-serif', fontWeight: 600 },
      h6: { fontFamily: '"Bricolage Grotesque", sans-serif', fontWeight: 600 },
    },
    shape: { borderRadius: 11 },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            borderRadius: 11,
            fontWeight: 600,
          },
          contained: {
            boxShadow: '0 2px 8px rgba(28, 25, 23, 0.12)',
            '&:hover': { boxShadow: '0 4px 12px rgba(28, 25, 23, 0.16)' },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: 11 },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 999, fontWeight: 600 },
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
