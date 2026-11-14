/**
 * An instant a request names is one the database reads (#2516):
 * `since=0050-04-14T14:36:45+17:19` on the curation activity read was a 500,
 * since Postgres reads no offset past about sixteen hours, and the year 0000
 * not at all. Every route that takes an instant refuses both with a 400, the
 * review queue's cursor reads such a value as no cursor, and the OpenAPI
 * document carries the rule as a pattern.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFile } from '../testSupport/repoFile.js';
import { decodeCursor, encodeCursor } from '../controllers/experience/reviewQueueKeys.js';
import { curationActivityQuerySchema } from './index.js';
import { INSTANT_MESSAGE, instantSchema, isReadableInstant } from './instants.js';
import { restoreVisitsBodySchema } from './trips.js';

const OFF_THE_CLOCK = '0050-04-14T14:36:45+17:19';
const YEAR_ZERO = '0000-01-01T00:00:00Z';

describe('an instant a request names (#2516)', () => {
  it('is answered as the UTC instant it names, from any offset a place keeps', () => {
    expect(instantSchema.parse('2001-10-05T09:00:00+02:00')).toBe('2001-10-05T07:00:00.000Z');
    // Kiribati's Line Islands keep +14:00, Baker Island -12:00.
    expect(instantSchema.parse('2026-11-14T00:00:00+14:00')).toBe('2026-11-13T10:00:00.000Z');
    expect(instantSchema.parse('2026-11-14T00:00:00-12:00')).toBe('2026-11-14T12:00:00.000Z');
    expect(instantSchema.parse('2026-11-14T00:00:00-14:00')).toBe('2026-11-14T14:00:00.000Z');
    expect(instantSchema.parse('2026-11-14T00:00:00+13:45')).toBe('2026-11-13T10:15:00.000Z');
    expect(instantSchema.parse('0050-04-14T14:36:45Z')).toBe('0050-04-14T14:36:45.000Z');
  });

  it('keeps every digit of the second it was written with, down to the database’s microsecond', () => {
    // `Date` keeps milliseconds: a `before` of `.123456` cut to `.123` would leave out a row at `.123`.
    expect(instantSchema.parse('2001-10-05T09:00:00.123456+02:00')).toBe('2001-10-05T07:00:00.123456Z');
    expect(instantSchema.parse('2001-10-05T07:00:00.5Z')).toBe('2001-10-05T07:00:00.500Z');
    expect(curationActivityQuerySchema.parse({ before: '2001-10-05T07:00:00.123456Z' }).before).toBe('2001-10-05T07:00:00.123456Z');
  });

  it('refuses an empty value and words with a 400, never by throwing', () => {
    // The API contract lane sent `since=` to the curation activity read, which answered 500.
    for (const value of ['', 'yesterday']) {
      expect(() => instantSchema.safeParse(value)).not.toThrow();
      expect(instantSchema.safeParse(value).success).toBe(false);
      expect(curationActivityQuerySchema.safeParse({ since: value }).success).toBe(false);
    }
  });

  it('keeps the UTC instant of the first and last years it takes inside the years Postgres reads', () => {
    expect(instantSchema.parse('0002-01-01T00:00:00+14:00')).toBe('0001-12-31T10:00:00.000Z');
    expect(instantSchema.parse('9998-12-31T23:00:00-14:00')).toBe('9999-01-01T13:00:00.000Z');
  });

  it('refuses an offset past fourteen hours, and a year whose UTC instant Postgres cannot read', () => {
    // The year 1 ahead of UTC becomes the year 0, and 9999 behind it the year 10000.
    for (const value of [OFF_THE_CLOCK, YEAR_ZERO, '2026-11-14T00:00:00+15:00', '2026-11-14T00:00:00+14:30', '2026-11-14T00:00:00-14:01', '0001-01-01T00:00:00+05:00', '9999-12-31T23:00:00-02:00']) {
      const parsed = instantSchema.safeParse(value);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toBe(INSTANT_MESSAGE);
      expect(isReadableInstant(value)).toBe(false);
    }
  });

  it('refuses the curation activity read’s since and before, and a restored visit’s mark, past the rule', () => {
    expect(curationActivityQuerySchema.safeParse({ since: OFF_THE_CLOCK }).success).toBe(false);
    expect(curationActivityQuerySchema.safeParse({ before: YEAR_ZERO }).success).toBe(false);
    expect(curationActivityQuerySchema.parse({ since: '2001-10-05T09:00:00+02:00' }).since).toBe('2001-10-05T07:00:00.000Z');
    const visit = { experienceId: 1, markedAt: OFF_THE_CLOCK, notes: null, rating: null, trips: [] };
    expect(restoreVisitsBodySchema.safeParse({ visits: [visit] }).success).toBe(false);
  });

  it('reads a review queue cursor naming such an instant as no cursor, which opens the first page', () => {
    expect(decodeCursor(encodeCursor({ askedAt: OFF_THE_CLOCK, rank: 1, id: 7 }))).toBeNull();
    expect(decodeCursor(encodeCursor({ askedAt: '2026-11-14T00:00:00Z', rank: 1, id: 7 }))).toEqual(
      { askedAt: '2026-11-14T00:00:00Z', rank: 1, id: 7 },
    );
  });

  it('is documented with its rule, so the generated clients send only what the route reads', () => {
    const document = JSON.parse(readFileSync(repoFile('packages', 'shared', 'src', 'openapi.generated.json'), 'utf8')) as {
      paths: Record<string, Record<string, { operationId?: string; parameters?: Array<{ name: string; schema: unknown }> }>>;
    };
    const operation = Object.values(document.paths).flatMap(path => Object.values(path))
      .find(one => one.operationId === 'getAdminCurationActivity');
    const since = JSON.stringify(operation?.parameters?.find(parameter => parameter.name === 'since')?.schema);
    expect(since).toContain('1[0-3]');
    expect(since).toContain('14(?::?00)?');
  });
});
