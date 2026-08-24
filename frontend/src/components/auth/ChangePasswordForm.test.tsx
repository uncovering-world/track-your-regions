/**
 * Tests for the form that rotates a local account's password.
 *
 * What is worth pinning is the division of labour between form and server. The
 * form refuses without spending a round trip what it can decide alone — the
 * confirmation not matching, and a password outside the schema's bounds at
 * either end — and refuses to invent
 * anything else: whether the current password is right, and whether the new one
 * has been breached, come back as sentences from the server and are shown as
 * they arrive. A form that paraphrases "appeared in 41,203 data breaches" loses
 * the number that makes it convincing.
 *
 * The success path pins the other half: the fields empty, and the server's
 * message — which is where the user learns their other devices were signed out.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const changePassword = vi.fn();
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ changePassword }) }));

import { ChangePasswordForm } from './ChangePasswordForm';

beforeEach(() => {
  changePassword.mockReset();
  changePassword.mockResolvedValue(
    'Password changed successfully. All other sessions have been logged out.',
  );
});

/** Fill the three fields; each defaults to something the form would accept. */
function fill({
  current = 'old-passphrase',
  next = 'new-passphrase',
  confirm = 'new-passphrase',
} = {}) {
  fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: current } });
  fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: next } });
  fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: confirm } });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: /change password/i }));
}

describe('ChangePasswordForm', () => {
  it('says up front that other devices are signed out', () => {
    render(<ChangePasswordForm />);
    expect(screen.getByText(/signs you out everywhere else/i)).toBeInTheDocument();
  });

  it('cannot be submitted until all three fields are filled', () => {
    render(<ChangePasswordForm />);
    const button = screen.getByRole('button', { name: /change password/i });
    expect(button).toBeDisabled();

    fill();
    expect(button).toBeEnabled();
  });

  it('refuses a mismatched confirmation without asking the server', async () => {
    render(<ChangePasswordForm />);
    fill({ confirm: 'new-passphras' });
    submit();

    // The alert, not the field's own helper text — the field says it while
    // typing, the alert is what answers the press.
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('refuses a password below the schema floor without asking the server', async () => {
    render(<ChangePasswordForm />);
    fill({ next: 'short7!', confirm: 'short7!' });
    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 8 characters/i);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('refuses a password past the schema ceiling without asking the server', async () => {
    render(<ChangePasswordForm />);
    const tooLong = 'x'.repeat(129);
    fill({ next: tooLong, confirm: tooLong });
    submit();

    // Past 128 the schema rejects the body, and every ZodError renders as the
    // bare string "Validation error" -- the one place the server's own words
    // name nothing the user can act on.
    expect(await screen.findByRole('alert')).toHaveTextContent(/at most 128 characters/i);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal in its own words', async () => {
    changePassword.mockRejectedValue(new Error('Current password is incorrect'));
    render(<ChangePasswordForm />);
    fill();
    submit();

    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    expect(screen.getByLabelText(/current password/i)).toHaveValue('old-passphrase');
  });

  it('keeps the breach count the server counted', async () => {
    changePassword.mockRejectedValue(
      new Error('This password has appeared in 41,203 data breaches. Please choose a different password.'),
    );
    render(<ChangePasswordForm />);
    fill();
    submit();

    expect(await screen.findByText(/41,203 data breaches/)).toBeInTheDocument();
  });

  it('sends what the user typed, then clears the fields and shows the server’s message', async () => {
    render(<ChangePasswordForm />);
    fill();
    submit();

    expect(
      await screen.findByText('Password changed successfully. All other sessions have been logged out.'),
    ).toBeInTheDocument();
    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: 'old-passphrase',
      newPassword: 'new-passphrase',
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/current password/i)).toHaveValue('');
      expect(screen.getByLabelText(/^new password/i)).toHaveValue('');
      expect(screen.getByLabelText(/confirm new password/i)).toHaveValue('');
    });
  });

  it('keeps the fields typed as passwords and pastable', () => {
    render(<ChangePasswordForm />);
    for (const label of [/current password/i, /^new password/i, /confirm new password/i]) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveAttribute('type', 'password');
      expect(field).not.toHaveAttribute('onpaste');
    }
    // Password managers need to be told which field is which (ASVS V6.2.7).
    expect(screen.getByLabelText(/current password/i)).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    expect(screen.getByLabelText(/^new password/i)).toHaveAttribute('autocomplete', 'new-password');
  });
});
