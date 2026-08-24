/**
 * Tests for the account area.
 *
 * The decision the page carries is which accounts are offered a password form.
 * A Google account has no password hash — the endpoint answers it with "not
 * available for OAuth accounts" — so offering the form there is a promise the
 * server refuses. The reverse mistake is worse and less visible: an account
 * whose provider the profile does not name (`auth_provider` is nullable) may
 * still hold a password, and withholding the form from it leaves a person with
 * no way to rotate a credential they actually have.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { User } from '../../types/auth';

let currentUser: User | null = null;
let loading = false;
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: currentUser,
    isAuthenticated: currentUser !== null,
    isLoading: loading,
    changePassword: vi.fn(),
  }),
}));

import { AccountPage } from './AccountPage';

function user(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    uuid: '00000000-0000-0000-0000-000000000001',
    email: 'traveller@example.com',
    displayName: 'Traveller',
    role: 'user',
    avatarUrl: null,
    emailVerified: true,
    authProvider: 'local',
    ...overrides,
  };
}

beforeEach(() => {
  currentUser = user();
  loading = false;
});

const passwordForm = () => screen.queryByLabelText(/current password/i);

describe('AccountPage', () => {
  it('asks a signed-out visitor to sign in', () => {
    currentUser = null;
    render(<AccountPage />);

    expect(screen.getByText(/sign in to see your account/i)).toBeInTheDocument();
    expect(passwordForm()).not.toBeInTheDocument();
  });

  it('offers the form to an email-and-password account', () => {
    render(<AccountPage />);

    expect(screen.getByText('Traveller')).toBeInTheDocument();
    expect(screen.getByText('traveller@example.com')).toBeInTheDocument();
    expect(screen.getByText(/signs in with: email and password/i)).toBeInTheDocument();
    expect(passwordForm()).toBeInTheDocument();
  });

  it('sends a Google account to Google instead of offering a form', () => {
    currentUser = user({ authProvider: 'google' });
    render(<AccountPage />);

    expect(passwordForm()).not.toBeInTheDocument();
    expect(screen.getByText(/signs in with Google, so it has no password here/i)).toBeInTheDocument();
  });

  it('still offers the form when the profile names no provider', () => {
    currentUser = user({ authProvider: undefined });
    render(<AccountPage />);

    expect(passwordForm()).toBeInTheDocument();
  });

  it('names the role of anyone who has one', () => {
    currentUser = user({ role: 'curator' });
    render(<AccountPage />);

    expect(screen.getByText('Curator')).toBeInTheDocument();
  });

  it('shows nothing while the session is still being resolved', () => {
    loading = true;
    const { container } = render(<AccountPage />);

    expect(container).toBeEmptyDOMElement();
  });
});
