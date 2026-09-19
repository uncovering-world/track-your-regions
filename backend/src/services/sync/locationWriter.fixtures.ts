/**
 * What every test of `writeExperienceLocations` drives it with: a run that can
 * name itself, two points, a client whose statements are recorded, and a name
 * for each statement the writer can send, so an assertion says which one it is
 * about.
 *
 * The `vi.mock` of the pool stays in each test file — it is hoisted per file,
 * and what this module's `pool` is, is whatever that file mocked it as
 * (`publishController.fixtures.ts` works the same way).
 */

import { vi } from 'vitest';
import { pool } from '../../db/index.js';
import { writeExperienceLocations as write } from './locationWriter.js';
import type { IncomingLocation } from './locationIncoming.js';

export const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
export const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;

/**
 * A run that can name itself, which is what every test here stands in for
 * unless it says otherwise. Named rather than defaulted, because the production
 * signature takes the run with no default at all: a writer that forgot it would
 * hold a field and never point the object at the run that held it.
 */
export const RUN: { syncLogId: number | null } = { syncLogId: 42 };
export const writeExperienceLocations = (
  experienceId: number, offered: IncomingLocation[], run = RUN,
) => write(experienceId, offered, run);

export const A = { name: 'A', externalRef: 'r1', lon: 10, lat: 20 };
export const B = { name: 'B', externalRef: 'r2', lon: 11, lat: 21 };

/**
 * A client whose every statement is recorded, so the write path can be read
 * back. `answers` lets one statement return rows: the arms are told apart by
 * what they say, which is also how a reader tells them apart.
 */
export function fakeClient(answers: Array<[RegExp, { rows?: unknown[]; rowCount?: number }]> = []) {
  const statements: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      statements.push(sql);
      const hit = answers.find(([pattern]) => pattern.test(sql));
      return { rows: hit?.[1].rows ?? [], rowCount: hit?.[1].rowCount ?? 0 };
    }),
    release: vi.fn(),
  };
  return { client, statements };
}

/** The arm that gives a point back its place in the source's list. */
export const RESURRECT = /missing_since = NULL/;
/** The arm that renumbers a point the source has offered all along. */
export const KEEP = /SET ordinal = i\.ordinal/;
/** The arm that records that the source stopped offering a point. */
export const MARK = /missing_since = NOW\(\)/;
/** The arm that writes a point the experience did not have. */
export const INSERT = /INSERT INTO experience_locations/;
/** The statement that retires the venue's pass because it gained a point. */
export const DECAY = /UPDATE experience_kind_memberships m SET curation_state = 'auto'/;
/** The statement that names, on each arrival, the point it replaces. */
export const PAIR = /SET withdrawal_deferred_for_location_id = m\.old_id/;
/** The arm that takes a held point out of the list without withdrawing it. */
export const HOLD = /el\.ordinal IS NOT NULL/;
/** The statement that lets go of a pairing the source has made pointless. */
export const UNPAIR = /n\.withdrawal_deferred_for_location_id = old\.id/;

/** The one statement matching `pattern`, or a failure naming what went wrong. */
export function only(statements: string[], pattern: RegExp): string {
  const found = statements.filter(s => pattern.test(s));
  if (found.length === 0) throw new Error(`no statement matched ${String(pattern)}`);
  if (found.length > 1) throw new Error(`${found.length} statements matched ${String(pattern)}`);
  return found[0];
}
