/**
 * Logout ends a token this server signed, and only that.
 *
 * `POST /api/auth/logout` is public, and the blacklist is an in-memory Map
 * swept by expiry. A token stored without verification would let anyone add
 * entries with any `exp` they claim, and the sweep would never take them out.
 * A forged token that reuses a live token's `jti` must not end that token.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { blacklistAccessToken, generateAccessToken, verifyAccessToken } from './authService.js';
import type { User } from '../types/auth.js';

const user = { id: 7, uuid: '00000000-0000-4000-8000-000000000007', role: 'user' } as User;

function jtiOf(token: string): string {
  return (jwt.decode(token) as { jti: string }).jti;
}

describe('blacklistAccessToken', () => {
  it('ends a live token this server signed', () => {
    const token = generateAccessToken(user);
    expect(verifyAccessToken(token)).not.toBeNull();

    blacklistAccessToken(token);

    expect(verifyAccessToken(token)).toBeNull();
  });

  it('stores nothing for a token it did not sign, even one naming a live jti', () => {
    const live = generateAccessToken(user);
    const forged = jwt.sign(
      { sub: user.id, uuid: user.uuid, role: user.role },
      crypto.randomBytes(32).toString('hex'),
      { issuer: 'track-your-regions', expiresIn: '100y', jwtid: jtiOf(live) },
    );

    blacklistAccessToken(forged);

    expect(verifyAccessToken(live)).not.toBeNull();
  });

  it('ignores what is not a token at all', () => {
    expect(() => blacklistAccessToken('not.a.jwt')).not.toThrow();
  });
});
