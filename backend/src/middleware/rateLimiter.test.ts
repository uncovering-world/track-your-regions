/**
 * The two read ceilings the environment may raise, and what it may not do.
 *
 * A limit that reads its value from the environment is a security control with
 * a way to weaken it, so what is pinned here is the direction: an unset, empty,
 * fractional, zero, negative or unparseable value is the **production** number,
 * and only a positive integer moves it. The one place that sets them is
 * `docker-compose.test.yml`, where every request comes from a single browser
 * container and the whole smoke suite shares one per-IP budget (#592).
 *
 * The wiring is read out of the module's own source rather than off the
 * limiter: `express-rate-limit` keeps its resolved options private, so the
 * alternative would be firing requests through the middleware to infer a number
 * it was told once at import. What matters is that each tier reads *its own*
 * variable and states its production default beside it, which the source says
 * exactly.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { readCeiling } from './rateLimiter.js';

const VARIABLE = 'RATE_LIMIT_PUBLIC_READ_MAX';
const source = readFileSync(new URL('./rateLimiter.ts', import.meta.url), 'utf8');

describe('the read ceilings', () => {
  afterEach(() => {
    delete process.env[VARIABLE];
  });

  it('is the production number when the environment says nothing', () => {
    expect(readCeiling(VARIABLE, 60)).toBe(60);
  });

  it('is raised by a positive integer, which is what the E2E stack sets', () => {
    process.env[VARIABLE] = '10000';
    expect(readCeiling(VARIABLE, 60)).toBe(10000);
  });

  it.each([
    ['an empty value', ''],
    ['a word', 'unlimited'],
    ['a fraction', '60.5'],
    ['zero', '0'],
    ['a negative', '-1'],
    ['a number with a suffix', '100rpm'],
  ])('falls back to the production number for %s', (_label, value) => {
    // The direction that matters: a value nobody meant must not become a
    // ceiling of its own — least of all zero, which express-rate-limit reads as
    // "refuse everything", so a typo would take the site down rather than open
    // it up, and neither is what an operator asked for.
    process.env[VARIABLE] = value;
    expect(readCeiling(VARIABLE, 60)).toBe(60);
  });

  it('lowers where a deployment asks for it', () => {
    // Not a one-way valve: an operator who wants a stricter tier gets one. The
    // default being the strict value is what makes an absent environment safe.
    process.env[VARIABLE] = '10';
    expect(readCeiling(VARIABLE, 60)).toBe(10);
  });

  it('gives each read tier its own variable and states its production default', () => {
    expect(source).toMatch(/max: readCeiling\('RATE_LIMIT_SEARCH_MAX', 30\)/);
    expect(source).toMatch(/max: readCeiling\('RATE_LIMIT_PUBLIC_READ_MAX', 60\)/);
  });

  it('leaves every write and auth tier on a literal nobody can move', () => {
    // The knob exists for read tiers a browser container exhausts by browsing.
    // Login, registration, refresh, verification, resends and the expensive
    // admin operation are not that, and an environment variable that could
    // loosen them would be a way to turn the strict tiers off in production.
    const wired = source.match(/max: readCeiling\(/g) ?? [];
    expect(wired).toHaveLength(2);
  });
});
