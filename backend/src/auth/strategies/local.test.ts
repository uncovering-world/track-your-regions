/**
 * Signing in with a hash from before ADR-0215 makes it again in the current
 * scheme, from the password just checked; a current hash is left alone.
 */
import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUserByEmail, getPasswordHash, replacePasswordHash, strategies } = vi.hoisted(() => ({
  findUserByEmail: vi.fn(),
  getPasswordHash: vi.fn(),
  replacePasswordHash: vi.fn(async () => undefined),
  strategies: [] as { _verify: (email: string, password: string, done: (...args: unknown[]) => void) => void }[],
}));
vi.mock('passport', () => ({ default: { use: (strategy: (typeof strategies)[number]) => strategies.push(strategy) } }));
vi.mock('../../services/authService.js', async () => ({
  ...(await import('../../services/passwordHash.js')),
  findUserByEmail,
  getPasswordHash,
  replacePasswordHash,
}));

import { hashPassword, needsRehash, verifyPassword } from '../../services/passwordHash.js';
import { configureLocalStrategy } from './local.js';

configureLocalStrategy();

function signIn(password: string): Promise<unknown[]> {
  return new Promise((resolve) => strategies[0]._verify('curator@example.org', password, (...args) => resolve(args)));
}

beforeEach(() => {
  replacePasswordHash.mockClear();
  findUserByEmail.mockResolvedValue({ id: 20, uuid: 'u20', email: 'curator@example.org', role: 'curator', emailVerified: true });
});

describe('signing in on a hash from before the scheme', () => {
  it('signs in and stores the hash again in the current scheme, which the same password verifies', async () => {
    const legacy = bcrypt.hashSync('Kremlin-1552', 4);
    getPasswordHash.mockResolvedValue(legacy);
    const [error, user] = await signIn('Kremlin-1552');
    expect(error).toBeNull();
    expect(user).toMatchObject({ id: 20 });
    expect(replacePasswordHash).toHaveBeenCalledTimes(1);
    const [id, verified, rehashed] = replacePasswordHash.mock.calls[0] as unknown as [number, string, string];
    expect(id).toBe(20);
    // Only while the account still holds the hash just checked: a password changed meanwhile stays changed.
    expect(verified).toBe(legacy);
    expect(needsRehash(rehashed)).toBe(false);
    expect(await verifyPassword('Kremlin-1552', rehashed)).toBe(true);
  });

  it('writes nothing for a wrong password', async () => {
    getPasswordHash.mockResolvedValue(bcrypt.hashSync('Kremlin-1552', 4));
    const [, user] = await signIn('Kremlin-1553');
    expect(user).toBe(false);
    expect(replacePasswordHash).not.toHaveBeenCalled();
  });

  it('signs in even when the new hash cannot be written', async () => {
    getPasswordHash.mockResolvedValue(bcrypt.hashSync('Kremlin-1552', 4));
    replacePasswordHash.mockRejectedValueOnce(new Error('connection lost'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const [error, user] = await signIn('Kremlin-1552');
    expect(error).toBeNull();
    expect(user).toMatchObject({ id: 20 });
    warn.mockRestore();
  });
});

it('leaves a hash of the current scheme as it is', async () => {
  getPasswordHash.mockResolvedValue(await hashPassword('Kremlin-1552'));
  const [, user] = await signIn('Kremlin-1552');
  expect(user).toMatchObject({ id: 20 });
  expect(replacePasswordHash).not.toHaveBeenCalled();
});

it('refuses an unknown address after the same one compare a real account costs', async () => {
  findUserByEmail.mockResolvedValueOnce(null);
  const [error, user] = await signIn('Kremlin-1552');
  expect(error).toBeNull();
  expect(user).toBe(false);
});
