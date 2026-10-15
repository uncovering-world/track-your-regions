/**
 * A password field a person can check before they send it.
 *
 * Masked by default, with a button at its end that shows what was typed and
 * hides it again: a mistyped character at registration becomes a password
 * nobody knows, and at sign-in a failed attempt counted against the rate limit
 * (#1062). OWASP ASVS 5.0 V6.2.6 asks for exactly this beside masking: masked
 * by default, viewable on the person's request.
 *
 * Each field holds its own state, so showing *New password* does not reveal
 * *Current password*. It is masked again whenever its form is submitted, and a
 * dialog that closes unmounts it, so it opens masked too. The button is a real
 * toggle: `type="button"` so it never submits, one name, "Show password", with
 * its state on `aria-pressed`, and it keeps the caret in the field by not
 * taking focus on a pointer press.
 */

import { useEffect, useRef, useState } from 'react';
import { IconButton, InputAdornment, TextField, type TextFieldProps } from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

// No `slotProps` or `InputProps`: the field owns its input slot for the
// button, and a caller's would be replaced without a word. A caller that needs
// one adds the merge here.
type PasswordFieldProps = Omit<TextFieldProps, 'type' | 'slotProps' | 'InputProps'> & {
  /** `current-password` to sign in, `new-password` to set one: what a password manager fills or stores. */
  autoComplete: 'current-password' | 'new-password';
};

export function PasswordField({ autoComplete, inputRef, ...props }: PasswordFieldProps) {
  const [shown, setShown] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  // Masked again when its own form is sent, whatever the outcome: a field left
  // showing after a failed sign-in shows the password to whoever looks next.
  useEffect(() => {
    const form = input.current?.form;
    if (!form) return undefined;
    const mask = () => setShown(false);
    form.addEventListener('submit', mask);
    return () => form.removeEventListener('submit', mask);
  }, []);

  return (
    <TextField
      {...props}
      type={shown ? 'text' : 'password'}
      autoComplete={autoComplete}
      inputRef={(element: HTMLInputElement | null) => {
        input.current = element;
        if (typeof inputRef === 'function') inputRef(element);
        else if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = element;
      }}
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                type="button"
                // One name and the state on `aria-pressed`, as a toggle button
                // is read: "Show password, toggle button, pressed".
                aria-label="Show password"
                aria-pressed={shown}
                title="Show password"
                edge="end"
                size="small"
                disabled={props.disabled}
                onClick={() => setShown(value => !value)}
                // Keeps focus, and so the caret, in the field on a pointer press;
                // the keyboard reaches the button by Tab as any other.
                onMouseDown={(event) => event.preventDefault()}
              >
                {shown ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
