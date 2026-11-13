/**
 * The account's sign-up time as the app reads it (#2120): `users.created_at`
 * allows null, so a row that records none reads as an account with no
 * sign-up time, which the date offered after a tick takes as not new, rather
 * than failing the sign-in, the refresh and `GET /me` that map it.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { pool } from '../db/index.js';
import { findUserById, toPublicUser } from './authService.js';

const row = (createdAt: Date | null) => ({
  id: 7, uuid: '00000000-0000-4000-8000-000000000007', email: 'traveller@example.org', display_name: 'Traveller',
  role: 'user', avatar_url: null, auth_provider: 'local', provider_id: null, email_verified: true,
  created_at: createdAt, last_seen_at: new Date('2026-11-14T09:00:00.000Z'),
});

async function publicUserOf(createdAt: Date | null) {
  vi.mocked(pool.query).mockResolvedValueOnce({ rows: [row(createdAt)] } as never);
  const user = await findUserById(7);
  if (!user) throw new Error('the row was not read');
  return toPublicUser(user);
}

describe("an account's sign-up time", () => {
  it('answers the time the row records', async () => {
    expect((await publicUserOf(new Date('2026-11-13T10:00:00.000Z'))).createdAt).toBe('2026-11-13T10:00:00.000Z');
  });

  it('answers null for a row that records none, without failing the read', async () => {
    expect((await publicUserOf(null)).createdAt).toBeNull();
  });
});
