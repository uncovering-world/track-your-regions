/**
 * Tests for the way into the account area.
 *
 * The page exists to be reached, and the only route to it a person will find
 * is this menu — so the entry and where it goes are as much of the feature as
 * the form itself. Also pinned: it is offered to everyone signed in, not only
 * to admins, because an account that signs in with Google still has an account
 * page worth reading even though it has no password to change.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { User } from '../../types/auth';

const navigate = vi.fn();
vi.mock('react-router', () => ({ useNavigate: () => navigate }));

let currentUser: User | null = null;
let admin = false;
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: currentUser,
    isAuthenticated: currentUser !== null,
    isAdmin: admin,
    isLoading: false,
    logout: vi.fn(),
  }),
}));

import { UserMenu } from './UserMenu';

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
  navigate.mockReset();
  currentUser = user();
  admin = false;
});

/**
 * Open the avatar menu — the items live behind it. Reached positionally
 * because the control's accessible name is the initials the avatar draws
 * ("T"), which names the person rather than the press; that belongs to the
 * icon-button sweep in #564, not here.
 */
function openMenu() {
  fireEvent.click(screen.getAllByRole('button')[0]);
}

describe('UserMenu', () => {
  it('offers the account page to a signed-in user', () => {
    render(<UserMenu />);
    openMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Account' }));
    expect(navigate).toHaveBeenCalledWith('/account');
  });

  it('offers it to a plain user, not only to an admin', () => {
    render(<UserMenu />);
    openMenu();

    expect(screen.getByRole('menuitem', { name: 'Account' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /admin panel/i })).not.toBeInTheDocument();
  });

  it('offers nothing of the sort to a visitor', () => {
    currentUser = null;
    render(<UserMenu />);

    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Account' })).not.toBeInTheDocument();
  });
});
