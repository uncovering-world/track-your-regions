/**
 * A password is verified exactly as received (ASVS V6.2.8, #2553): bcrypt
 * reads only 72 bytes, so the whole password is digested first (ADR-0215).
 */
import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, verifyPassword } from './passwordHash.js';

const first72 = 'correct horse battery staple '.repeat(3).slice(0, 72);

describe('a password past 72 bytes', () => {
  it('is checked whole: one that shares only its first 72 bytes is refused', async () => {
    const stored = await hashPassword(`${first72}AAAAAAAA`);
    expect(await verifyPassword(`${first72}AAAAAAAA`, stored)).toBe(true);
    expect(await verifyPassword(`${first72}BBBBBBBB`, stored)).toBe(false);
  });

  it('is checked whole where it is not ASCII: 64 Cyrillic characters are 128 bytes', async () => {
    const phrase = 'Поездка в Казань была долгой, но Кремль стоил каждого километра!!'.slice(0, 64);
    expect(Buffer.byteLength(phrase, 'utf8')).toBeGreaterThan(72);
    const stored = await hashPassword(phrase);
    expect(await verifyPassword(phrase, stored)).toBe(true);
    expect(await verifyPassword(`${phrase.slice(0, 40)}${'x'.repeat(24)}`, stored)).toBe(false);
  });

  it('fits the column and names its scheme', async () => {
    const stored = await hashPassword('x'.repeat(128));
    expect(stored.length).toBeLessThanOrEqual(255);
    expect(needsRehash(stored)).toBe(false);
  });
});

describe('a hash from before the scheme: bcrypt over the raw password', () => {
  it('still verifies the password it was made from, and asks to be made again', async () => {
    const legacy = bcrypt.hashSync('Kremlin-1552', 4);
    expect(await verifyPassword('Kremlin-1552', legacy)).toBe(true);
    expect(await verifyPassword('Kremlin-1553', legacy)).toBe(false);
    expect(needsRehash(legacy)).toBe(true);
  });

  it('is never matched by a password past 72 bytes, which bcrypt read only in part', async () => {
    const legacy = bcrypt.hashSync(`${first72}AAAAAAAA`, 4);
    expect(await verifyPassword(`${first72}BBBBBBBB`, legacy)).toBe(false);
    expect(await verifyPassword(`${first72}AAAAAAAA`, legacy)).toBe(false);
  });
});
