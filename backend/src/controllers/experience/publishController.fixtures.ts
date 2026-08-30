/**
 * What every test of publishing drives the endpoint with.
 *
 * Two files test `POST /:id/publish` — the object, its contents and its held
 * fields in `publishController.test.ts`, and the held fields of its *parts*
 * (ADR-0037) in `publishHeldParts.test.ts` — and both need the same fake
 * transaction: a client whose statements are recorded, whose locked read
 * answers with the row every decision rests on, and whose part reads answer
 * with the rows the record resolves to. One client rather than two, so the two
 * files cannot come to describe different servers.
 *
 * The mocks themselves stay in each test file: `vi.mock` is hoisted per file,
 * and what this module imports from `../../db/index.js` is whatever that file
 * mocked it as.
 */

import { vi } from 'vitest';
import { pool } from '../../db/index.js';
import { publishExperience } from './publishController.js';

export const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
export const mockedConnect = pool.connect as unknown as ReturnType<typeof vi.fn>;

export function makeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

export const CURATOR = { id: 7, role: 'curator' as const };
export const ADMIN = { id: 1, role: 'admin' as const };

/**
 * One entry of a gated run's `changed_fields`, as the changeset stores it.
 *
 * `held` is stated on every fixture that stands for a gate-held field, because
 * that is what the writer now keys on (#519): a fixture leaving it out describes a
 * field the run applied, and this endpoint has nothing to do with those.
 */
export interface Proposed {
  field: string; old?: unknown; new?: unknown; curatedConflict?: boolean; held?: boolean;
}

/**
 * What the changeset's contents record holds for one part (ADR-0037): the
 * entry as the run stored it, `held` said on each field that the gate refused.
 */
export interface ProposedPart {
  item: { name: string | null; ref: string | null };
  fields: Proposed[];
}

export interface ClientOptions {
  /** What the `FOR UPDATE` re-read returns; `null` is the row that vanished before the lock. */
  row?: Record<string, unknown> | null;
  proposal?: Proposed[];
  /** The contents record on the same changeset row, keyed by kind. */
  contents?: { locations?: { changed: ProposedPart[] }; treasures?: { changed: ProposedPart[] } };
  /**
   * The stored rows the record's parts resolve to, locked for the write. `null`
   * is a part the record names that no offered row answers to any more.
   */
  parts?: { location?: Record<string, unknown> | null; treasure?: Record<string, unknown> | null };
  /**
   * Held rows a curator has already answered (#722), as `answeredHeldRows`
   * returns them: the object's own field carries three nulls, a part's the kind
   * and the record's pair.
   *
   * Absent is the ordinary case — a proposal nobody has answered yet — which is
   * what every test written before per-row answers describes.
   */
  answered?: Array<{
    kind: string | null; ref: string | null; name: string | null; field: string;
    /** Which answer stands — the credit rule reads it, so a test can drive either. */
    answer?: 'published' | 'refused';
  }>;
  rowCounts?: Record<string, number>;
}

export interface Recorded {
  sql: string;
  params: unknown[];
}

/** Every column the locked read carries in production, so a guard cannot be deleted unnoticed. */
function lockedRow(opts: ClientOptions) {
  if (opts.row === null) return [];
  return [{
    // `admission` is here for the reason the others are: a mock missing it
    // would let the refused-row guard be deleted without a test noticing.
    curation_state: 'pending',
    curated_fields: [],
    metadata: null,
    // Read for the credit rule (#722): the run's credit belongs to the run's
    // picture, so writing it means knowing whether that picture is the stored one.
    image_url: null,
    admission: 'admitted',
    pending_change_sync_log_id: null,
    ...(opts.row ?? {}),
  }];
}

/** The changeset row the pointer names, or none. */
function proposalRow(opts: ClientOptions) {
  if (opts.proposal === undefined && opts.contents === undefined) return [];
  return [{ changed_fields: opts.proposal ?? [], contents: opts.contents ?? null }];
}

/**
 * What the fake transaction answers each statement with, decided by the
 * statement's text. Fragments must not be prefixes of one another: the first
 * match wins, and two `UPDATE experience_locations` statements run in one
 * publish.
 */
function answer(sql: string, opts: ClientOptions): { rows: unknown[]; rowCount?: number } {
  if (sql.includes('experience_sync_changes') && sql.includes('SELECT changed_fields')) {
    return { rows: proposalRow(opts) };
  }
  // Which rows of that proposal already carry an answer. Read off the same
  // table, which is why this arm sits above nothing and is keyed on the
  // decisions table rather than on the changeset (#722).
  if (sql.includes('experience_held_decisions') && sql.includes('SELECT NULL::text AS kind')) {
    // `answer` defaults to the refusal, which is the verdict a rule can act
    // on: a published row means the column already holds the value, so a test
    // that omits it is describing the case with something to decide.
    return { rows: (opts.answered ?? []).map(row => ({ answer: 'refused', ...row })) };
  }
  // The part rows, resolved and locked by `publishHeldParts.ts`.
  if (sql.includes('FROM experience_locations el') && sql.includes('FOR UPDATE')) {
    return { rows: opts.parts?.location ? [opts.parts.location] : [] };
  }
  if (sql.includes('FROM treasures t') && sql.includes('FOR UPDATE')) {
    return { rows: opts.parts?.treasure ? [opts.parts.treasure] : [] };
  }
  if (sql.includes('FOR NO KEY UPDATE')) return { rows: lockedRow(opts) };
  const counted = Object.entries(opts.rowCounts ?? {}).find(([fragment]) => sql.includes(fragment));
  return { rows: [], rowCount: counted ? counted[1] : 0 };
}

/**
 * Captures what the transaction ran, so assertions can read the statements.
 *
 * `row` is what the `FOR UPDATE` re-read returns — the state every decision here
 * rests on, read inside the lock rather than before it. `null` is the row that
 * vanished between the handler's existence check and the lock.
 */
export function makeClient(opts: ClientOptions = {}) {
  const queries: Recorded[] = [];
  return {
    queries,
    client: {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params: params ?? [] });
        return answer(sql, opts);
      }),
      release: vi.fn(),
    },
  };
}

/** The one statement containing `fragment`, or a failure naming what went wrong. */
export function only(queries: Recorded[], fragment: string): Recorded {
  const found = queries.filter(q => q.sql.includes(fragment));
  if (found.length === 0) throw new Error(`no statement contained ${fragment}`);
  if (found.length > 1) throw new Error(`${found.length} statements contained ${fragment}`);
  return found[0];
}

export function none(queries: Recorded[], fragment: string): boolean {
  return !queries.some(q => q.sql.includes(fragment));
}

/**
 * Did the transaction write anything at all?
 *
 * Asked on how each statement *starts*, not on whether 'UPDATE' appears in it:
 * the locked read is `SELECT … FOR UPDATE`, so a substring test is true of every
 * refusal and would pass over any write this endpoint made.
 */
export function noWrites(queries: Recorded[]): boolean {
  return !queries.some(q => /^\s*(UPDATE|INSERT)/.test(q.sql));
}

/**
 * The handler's one pre-lock read every caller makes: the row exists.
 *
 * `resolveExperienceScope` short-circuits on `role === 'admin'` without a
 * query at all, which is what every test using the default `publish()` caller
 * gets — so this queues exactly one answer. A curator-scoped test queues the
 * scope-resolution read itself, right after calling this, because that one
 * only runs for a non-admin caller.
 */
export function grantScope(categoryId = 2) {
  mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, category_id: categoryId }] });
}

export async function publish(
  body: unknown,
  client: { query: unknown; release: unknown },
  user: { id: number; role: 'admin' | 'curator' } = ADMIN,
) {
  const res = makeRes();
  mockedConnect.mockResolvedValue(client);
  await publishExperience({ user, params: { id: '5' }, body } as never, res as never);
  return res;
}
