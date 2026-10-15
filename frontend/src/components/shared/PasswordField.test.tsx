import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PasswordField } from './PasswordField';

/** A password a person can check before sending it (#1062, ASVS V6.2.6). */
function form(onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())) {
  render(
    <form onSubmit={onSubmit}>
      <PasswordField label="Current password" autoComplete="current-password" defaultValue="hunter2" />
      <PasswordField label="New password" autoComplete="new-password" defaultValue="correct horse" />
      <button type="submit">Save</button>
    </form>,
  );
  return onSubmit;
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const toggles = () => screen.getAllByRole('button', { name: /password$/ });

describe('PasswordField', () => {
  it('is masked at first, with the autocomplete it was given', () => {
    form();
    expect(field('Current password')).toHaveAttribute('type', 'password');
    expect(field('Current password')).toHaveAttribute('autocomplete', 'current-password');
    expect(field('New password')).toHaveAttribute('autocomplete', 'new-password');
    expect(toggles()[0]).toHaveAccessibleName('Show password');
    expect(toggles()[0]).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows and hides its own field only, and never submits the form', () => {
    const onSubmit = form();
    fireEvent.click(toggles()[1]);

    expect(field('New password')).toHaveAttribute('type', 'text');
    expect(field('Current password')).toHaveAttribute('type', 'password');
    // One name, the state on aria-pressed: a toggle's name does not flip.
    expect(toggles()[1]).toHaveAccessibleName('Show password');
    expect(toggles()[1]).toHaveAttribute('aria-pressed', 'true');
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(toggles()[1]);
    expect(field('New password')).toHaveAttribute('type', 'password');
  });

  it('is a native button the keyboard reaches by Tab and presses with Enter or Space', () => {
    form();
    const toggle = toggles()[0];
    // A real <button>, in the tab order: the browser gives it both keys.
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).not.toHaveAttribute('tabindex', '-1');
    expect(toggle).not.toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps the caret in the field when the button is pressed with a pointer', () => {
    form();
    field('Current password').focus();
    const press = fireEvent.mouseDown(toggles()[0]);
    // The default a mouse-down would take is focus moving to the button.
    expect(press).toBe(false);
    expect(field('Current password')).toHaveFocus();
  });

  it('masks again when its form is sent', () => {
    form();
    fireEvent.click(toggles()[0]);
    expect(field('Current password')).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(field('Current password')).toHaveAttribute('type', 'password');
  });
});
