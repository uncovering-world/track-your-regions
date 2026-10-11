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
 * The assertion is on the computed style of a control the keyboard focus has
 * reached, the way MUI marks it (`Mui-focusVisible`): it reads the outline's
 * width and colour, since `ButtonBase`'s own root carries `outline:0`, and a test
 * that merely found an `outline` in the emitted CSS passed with the ring gone —
 * the first version of this did.
 */

import { describe, it, expect } from 'vitest';
import { act, render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import ButtonBase from '@mui/material/ButtonBase';
import { createAppTheme } from './theme';

/** The outline a focused control is drawn with, in the given mode. */
function focusedOutline(mode: 'light' | 'dark'): { width: string; style: string; color: string } {
  const { getByRole, unmount } = render(
    <ThemeProvider theme={createAppTheme(mode)}>
      <ButtonBase>a control</ButtonBase>
    </ThemeProvider>,
  );
  const control = getByRole('button', { name: 'a control' });
  act(() => control.focus());
  expect(control).toHaveClass('Mui-focusVisible');
  const computed = getComputedStyle(control);
  const outline = { width: computed.outlineWidth, style: computed.outlineStyle, color: computed.outlineColor };
  unmount();
  return outline;
}

describe('a keyboard-focused control is visible', () => {
  it('carries an outline of its own, since ButtonBase clears the browser one', () => {
    expect(focusedOutline('light')).toMatchObject({ width: '2px', style: 'solid' });
  });

  it('takes the outline colour from the palette, so it works in either mode', () => {
    // Hardcoding one colour would be wrong in the other mode: this theme builds a
    // different primary for each.
    const light = createAppTheme('light').palette.primary.main;
    const dark = createAppTheme('dark').palette.primary.main;
    expect(light).not.toBe(dark);

    expect(focusedOutline('light').color).toBe(light);
    expect(focusedOutline('dark').color).toBe(dark);
  });
});
