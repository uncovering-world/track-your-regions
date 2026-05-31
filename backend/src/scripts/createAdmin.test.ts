import { describe, expect, it, vi, beforeEach } from 'vitest';

const { findUserByEmail, createUser, hashPassword } = vi.hoisted(() => ({
  findUserByEmail: vi.fn(),
  createUser: vi.fn(),
  hashPassword: vi.fn(async () => 'HASH'),
}));
vi.mock('../services/authService.js', () => ({ findUserByEmail, createUser, hashPassword }));

import { runCreateAdmin } from './createAdmin.js';

beforeEach(() => {
  findUserByEmail.mockReset();
  createUser.mockReset();
  hashPassword.mockClear();
  hashPassword.mockResolvedValue('HASH');
});

describe('runCreateAdmin', () => {
  it('creates a verified admin when none exists', async () => {
    findUserByEmail.mockResolvedValue(null);
    createUser.mockResolvedValue({ id: 1, email: 'a@b.com' });
    const res = await runCreateAdmin({ email: 'A@b.com', displayName: 'A', password: 'StrongPass123' });
    expect(res.created).toBe(true);
    expect(hashPassword).toHaveBeenCalledWith('StrongPass123');
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: 'a@b.com', role: 'admin', emailVerified: true, passwordHash: 'HASH', authProvider: 'local',
    }));
  });

  it('is idempotent when a verified admin already exists', async () => {
    findUserByEmail.mockResolvedValue({ id: 1, email: 'a@b.com', role: 'admin', emailVerified: true });
    const res = await runCreateAdmin({ email: 'a@b.com', displayName: 'A', password: 'x' });
    expect(res.created).toBe(false);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('throws when the email exists but is not a verified admin', async () => {
    findUserByEmail.mockResolvedValue({ id: 1, email: 'a@b.com', role: 'user', emailVerified: true });
    await expect(
      runCreateAdmin({ email: 'a@b.com', displayName: 'A', password: 'x' }),
    ).rejects.toThrow(/not a verified admin/);
    expect(createUser).not.toHaveBeenCalled();
  });
});
