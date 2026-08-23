/**
 * Tests for the focus ring the theme puts back.
 *
 * Every control MUI builds on `ButtonBase` clears the browser's outline
 * (`outline: 0` on the root) and leaves `focusRipple` off, so without a rule of
 * our own a keyboard reader is handed a tab stop with nothing to see. Nothing in
 * this repository's gates checks focus visibility — `jsx-a11y` is not installed
 * and there is no visual lane — so this file is the check.
 *
 * It exists because the rule was first written in a form MUI does not resolve:
 * a callback nested *under a selector* inside `styleOverrides.root`. MUI calls
 * those values at the slot level only, so the function reached emotion as a
 * declaration value and was dropped, and the ring was simply absent. Nothing said
 * so — which is exactly the failure the rule is there to prevent, one level up.
 *
 * The assertion is on the emitted CSS rather than on a computed style, because
 * `getComputedStyle` in jsdom does not resolve emotion's injected sheets. And it
 * looks for the *width* rather than for the word `outline`: `ButtonBase`'s own
 * root carries `outline:0`, so a test that merely found "outline" would pass with
 * the ring gone — the first version of this did.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import ButtonBase from '@mui/material/ButtonBase';
import { createAppTheme } from './theme';

function emittedCss(mode: 'light' | 'dark'): string {
  render(
    <ThemeProvider theme={createAppTheme(mode)}>
      <ButtonBase>a control</ButtonBase>
    </ThemeProvider>,
  );
  return Array.from(document.querySelectorAll('style')).map(s => s.textContent ?? '').join('');
}

describe('a keyboard-focused control is visible', () => {
  it('carries an outline of its own, since ButtonBase clears the browser one', () => {
    expect(emittedCss('light')).toMatch(/outline:\s*2px solid/i);
  });

  it('takes the outline colour from the palette, so it works in either mode', () => {
    // Hardcoding one colour would be wrong in the other mode: this theme builds a
    // different primary for each.
    const light = createAppTheme('light').palette.primary.main;
    const dark = createAppTheme('dark').palette.primary.main;
    expect(light).not.toBe(dark);

    expect(emittedCss('light')).toContain(light);
    expect(emittedCss('dark')).toContain(dark);
  });
});
