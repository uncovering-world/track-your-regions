# Track-Your-Regions UI — conventions

The real component library of the Track-Your-Regions app: **React + MUI 6**, styled with
**emotion (CSS-in-JS)**. Build with the exported components; style with MUI **props** and the
**`sx`** prop using theme tokens — never hand-written CSS classes.

## Wrap every design in the theme
Components read their colors, typography, and spacing from the MUI theme; without it they render
unthemed. Wrap your app root once in the exported provider:

```tsx
import { DsPreviewProvider } from 'frontend';

<DsPreviewProvider>{/* your design */}</DsPreviewProvider>
```

`DsPreviewProvider` wraps MUI's `ThemeProvider` + `CssBaseline` with the app's light theme
(`createAppTheme('light')`). For dark mode, wrap in your own `ThemeProvider` with
`createAppTheme('dark')`.

## Styling idiom — MUI, no CSS classes
- Style via component **props** and the **`sx`** prop with theme tokens, not class names.
- Palette (Meridian v2): primary **Sea Teal `#0f766e`** (`color="primary"`); accent **Sunset
  Clay `#c2683c`** (`color="secondary"`); earthy `error` `#c0492f` / `warning` `#d9920a` /
  `success` `#3f8f5b`; warm-paper surfaces (`#fbf8f3` canvas, `#ffffff` paper, `#e8e1d8`
  divider); text roles `text.primary` `#1c1917` / `text.secondary` `#79716b`.
- Type scale via MUI `variant` (`variant="body2"`, `"h6"`, …). Fonts: **Bricolage Grotesque**
  (display — h1–h6) and **Figtree** (UI / body); JetBrains Mono for labels/coordinates.
- Spacing uses the theme's 8px unit: `sx={{ p: 3, gap: 1 }}`.

## Components in this library
- **EmptyState** — centered muted message for empty / "no items" states.
  Props: `message: string`, `padding?: number | string`. Prefer this over a hand-rolled centered
  `<Typography color="text.secondary">`.
- **LoadingSpinner** — centered MUI `CircularProgress`.
  Props: `size?: number`, `padding?: number | string`.
- **LevelSwitcher** — a 3-segment toggle (L1 supra-national / L2 countries / L3 sub-national)
  that doubles as a staged-build tracker; each segment shows a ○/◐/⬤ progress glyph + a count
  badge. Props: `value`, `onChange`, `progress` (per-level counts + status).

## Where the truth lives
- Tokens / theme: `frontend/src/theme/theme.ts` (`createAppTheme`, `lightPalette`, `darkPalette`).
- Per-component API + usage: each component's `<Name>.d.ts` and `<Name>.prompt.md`.

## One idiomatic snippet
```tsx
import { DsPreviewProvider } from 'frontend';
import { EmptyState } from 'frontend';

<DsPreviewProvider>
  <EmptyState message="No experiences match your filters." />
</DsPreviewProvider>
```
