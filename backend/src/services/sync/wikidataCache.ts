/**
 * Keeping Wikidata's answers, so a failed run resumes and a repeated question
 * costs their cluster nothing.
 *
 * Museum run 61 died in its third collection phase having already paid for 1166
 * artwork classes, and threw all of it away. The endpoint's own guidance is to
 * treat the service as degraded and to work in batches — which only helps if the
 * batches that succeeded are kept — and their front end caches nothing we send,
 * because every one of our queries is a POST.
 *
 * **This is a cache, not a second source of truth**, and three things keep it
 * one:
 *
 * - the key is the hash of the source and the query text, so a changed filter
 *   is a different question and misses by construction rather than by somebody
 *   remembering to invalidate, and one source's rows are never another's;
 * - every row carries its own expiry, written when it was fetched, so the rule
 *   that applied then stays with it and the panel shows the same expiry the
 *   reader honours;
 * - a run can be told to ignore it entirely, and the admin panel can drop any
 *   kind with one button. A cache that cannot be bypassed is a fork of reality.
 *
 * A miss is never fatal: every path here falls through to the live query, and a
 * cache write that fails is logged and swallowed. The catalogue must not stop
 * importing because a cache table is unhappy.
 */

import { createHash } from 'crypto';
import { pool, rollbackQuietly } from '../../db/index.js';
import type { SparqlBinding } from './wikidataUtils.js';

/**
 * What a cached answer is about, which decides how long it is worth keeping.
 *
 * Named by the question rather than by the function that asks it: `classes` is
 * "which classes count as artworks", whoever wants to know.
 */
export type CacheKind = 'classes' | 'pool' | 'statements' | 'entities' | 'edges';

/**
 * How long each kind stays fresh, and why.
 *
 * These are the rates the *facts* change at, not guesses about traffic. The
 * class closure is ontology — Wikidata's class tree moves over months, and the
 * closure itself takes eleven minutes to rebuild, so a week is both safe and the
 * difference between a resumable run and a lost one. A pool of works changes as
 * fast as people write articles about them, which is days rather than hours,
 * but a day keeps a re-run of a broken import honest. Statements and edges are
 * the venue graph — a painting moving between departments is the thing this
 * whole branch is about, so half a day. Entity details are labels and images,
 * which change constantly and matter least: six hours.
 *
 * None of these is a promise that the catalogue is at most this stale. A sync
 * that must see today's Wikidata runs with the cache off, which is one button.
 */
export const DEFAULT_TTL_MS: Record<CacheKind, number> = {
  classes: 7 * 24 * 60 * 60 * 1000,
  pool: 24 * 60 * 60 * 1000,
  statements: 12 * 60 * 60 * 1000,
  entities: 6 * 60 * 60 * 1000,
  edges: 12 * 60 * 60 * 1000,
};

/**
 * The lock both writers take before touching one source's kind.
 *
 * Transaction-scoped, so it is released by COMMIT or ROLLBACK and no path can
 * leak it. The key is the pair the policy is keyed by, which is the narrowest
 * thing that serialises what has to be serialised: two runs writing different
 * kinds never wait for each other, and a run writing `pool` waits only for an
 * admin changing `pool`'s lifetime.
 *
 * It covers a database-only critical section — the policy read and the insert.
 * The source's answer is already in hand by the time `writeCached` is called,
 * so nothing here waits on a network request.
 */
const LOCK_SQL = 'SELECT pg_advisory_xact_lock($1::int, hashtext($2)::int)';

/**
 * Set a kind's lifetime, and apply it to what is already kept.
 *
 * Re-stamping is the point rather than a side effect: an admin who shortens
 * `pool` to an hour means "stop using yesterday's pools", and a policy that only
 * governed future writes would leave the old ones in use for another day while
 * the panel showed the new number.
 *
 * `fetched_at + ttl` rather than `now + ttl`, so an answer keeps its own age: a
 * row fetched three days ago under a one-week rule is four days from expiry, and
 * setting the rule to two days must expire it rather than grant it two more.
 */
export async function setCacheTtl(
  categoryId: number, kind: string, ttlMs: number,
): Promise<{ restamped: number }> {
  // One transaction, because the two halves are one decision. Apart, a failure
  // between them leaves the panel showing a lifetime that nothing already kept
  // obeys — the exact disagreement decision 7 of ADR-0030 exists to prevent.
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    await client.query(LOCK_SQL, [categoryId, kind]);
    await client.query(
      `INSERT INTO wikidata_cache_policy (category_id, kind, ttl_ms, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (category_id, kind) DO UPDATE SET ttl_ms = EXCLUDED.ttl_ms, updated_at = NOW()`,
      [categoryId, kind, ttlMs],
    );
    const restamped = await client.query(
      `UPDATE wikidata_query_cache
          SET expires_at = fetched_at + ($3::bigint * INTERVAL '1 millisecond')
        WHERE category_id = $1 AND kind = $2`,
      [categoryId, kind, ttlMs],
    );
    await client.query('COMMIT');
    return { restamped: restamped.rowCount ?? 0 };
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed rather than pooled:
    // it would carry an open transaction into the next request.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

/**
 * Which kinds of question each source's collector actually describes — and
 * therefore which caches exist for it at all.
 *
 * The two Wikidata collectors pass descriptors: each is a pipeline of distinct
 * questions worth keeping apart — the museums' class closure, work pools,
 * venue statements, entity details and edges; the public art's class trees,
 * entity pools, the facts about each candidate (`edges`) and about what holds
 * it (`entities`). The UNESCO run reads that source's own API and asks
 * Wikidata directly, without going through this door, so it keeps nothing,
 * and a panel offering to clear its "class trees" would be inventing a cache
 * to explain.
 *
 * The panel reads this rather than reading whatever rows happen to exist, so a
 * source with an empty cache shows the kinds it *would* fill rather than
 * nothing, and a source that caches nothing says exactly that.
 */
export const CACHED_KINDS_BY_CATEGORY: Record<number, CacheKind[]> = {
  // Art Museums.
  2: ['classes', 'pool', 'statements', 'entities', 'edges'],
  // Public Art & Monuments.
  3: ['classes', 'pool', 'edges', 'entities'],
};

/** What a caller says about the question it is asking. */
export interface CacheDescriptor {
  kind: CacheKind;
  /** One line a person reads in the panel: `pool: painting, 100+ sitelinks`. */
  label: string;
}

/**
 * The key: the source that asked, and the question (ADR-0047, narrowing
 * ADR-0030 decision 1).
 *
 * Two collectors ask for the children of `sculpture` in the same words, and
 * with the question alone as the key the public-art run read the museums'
 * week-old row and missed a class Wikidata had created since, while *Clear*
 * on one source left behind the rows the other had last written. A row is
 * one source's, so what the panel shows for a source is what its runs read,
 * and clearing it clears exactly that. Migration 043 drops the rows keyed the
 * old way.
 */
function hashOf(categoryId: number, query: string): string {
  return createHash('sha256').update(`${categoryId}\n${query}`).digest('hex');
}

/**
 * The answer we already have, or nothing.
 *
 * Expiry is compared in the database rather than here, so a row is fresh or not
 * by one clock — the panel reads the same column and would otherwise disagree
 * with the reader by whatever the two processes' clocks differ by.
 */
async function readCached(categoryId: number, query: string): Promise<SparqlBinding[] | null> {
  try {
    const hit = await pool.query(
      `SELECT result FROM wikidata_query_cache
        WHERE query_hash = $1 AND expires_at > NOW()`,
      [hashOf(categoryId, query)],
    );
    return hit.rows.length > 0 ? (hit.rows[0].result as SparqlBinding[]) : null;
  } catch (error) {
    console.warn('[Wikidata Cache] Read failed, asking the source:', (error as Error).message);
    return null;
  }
}

/**
 * Keep an answer, replacing whatever was there for the same question.
 *
 * `ON CONFLICT` rather than delete-then-insert: two runs of the same category
 * cannot overlap, but a dry run and a real one can, and the second writer should
 * win rather than fail.
 */
async function writeCached(
  categoryId: number, query: string, descriptor: CacheDescriptor, rows: SparqlBinding[],
): Promise<void> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    // Both halves of the rule, and both are needed.
    //
    // The lifetime is read **inside the insert** rather than before it, so the
    // statement has no read-then-write gap of its own; and the whole thing runs
    // under the same advisory lock `setCacheTtl` takes, so a policy change
    // cannot commit and re-stamp between this statement's snapshot and its
    // commit. Without the lock a row could land carrying an expiry the panel no
    // longer shows — the disagreement ADR-0030 decision 7 exists to prevent.
    await client.query('BEGIN');
    await client.query(LOCK_SQL, [categoryId, descriptor.kind]);
    await client.query(
      `INSERT INTO wikidata_query_cache
         (category_id, query_hash, kind, label, query_text, result, row_count, fetched_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW(),
               NOW() + (COALESCE(
                 (SELECT ttl_ms FROM wikidata_cache_policy
                   WHERE category_id = $1 AND kind = $3),
                 $8::bigint
               ) * INTERVAL '1 millisecond'))
       ON CONFLICT (query_hash) DO UPDATE SET
         category_id = EXCLUDED.category_id,
         kind = EXCLUDED.kind,
         label = EXCLUDED.label,
         result = EXCLUDED.result,
         row_count = EXCLUDED.row_count,
         fetched_at = EXCLUDED.fetched_at,
         expires_at = EXCLUDED.expires_at`,
      [
        categoryId, hashOf(categoryId, query), descriptor.kind, descriptor.label, query,
        JSON.stringify(rows), rows.length, DEFAULT_TTL_MS[descriptor.kind],
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    // Swallowed on purpose: the run has the answer in hand. Failing here would
    // throw away a query the source has already paid for.
    unusable = await rollbackQuietly(client);
    console.warn('[Wikidata Cache] Write failed, continuing:', (error as Error).message);
  } finally {
    client.release(unusable);
  }
}

/**
 * Wrap a SPARQL door so its answers are kept and reused.
 *
 * The descriptor comes from the call site rather than being guessed from the
 * query text: only the caller knows that this particular `SELECT` is the class
 * closure, and a cache that classified by pattern-matching SPARQL would be one
 * refactor away from filing a pool under `classes`.
 *
 * A query with no descriptor is not cached at all. That is the honest default
 * for a one-off question, and it keeps every existing caller behaving exactly as
 * it did.
 */
export function withCache(
  sparql: (query: string) => Promise<SparqlBinding[]>,
  options: {
    /** Whose run this is. Every question an admin asks of the cache is per source. */
    categoryId: number;
    enabled: boolean;
    onHit?: (descriptor: CacheDescriptor, rows: number) => void;
  },
): (query: string, descriptor?: CacheDescriptor) => Promise<SparqlBinding[]> {
  return async (query, descriptor) => {
    if (!descriptor || !options.enabled) return sparql(query);

    const cached = await readCached(options.categoryId, query);
    if (cached) {
      options.onHit?.(descriptor, cached.length);
      return cached;
    }

    const rows = await sparql(query);
    await writeCached(options.categoryId, query, descriptor, rows);
    return rows;
  };
}

/** One line per kind for the admin panel. */
export interface CacheKindSummary {
  kind: string;
  entries: number;
  rows: number;
  /** The oldest answer of this kind, which is what "how stale is this" means. */
  oldestFetchedAt: string | null;
  /** The soonest it stops being used, so the panel can say "expires in 2 days". */
  nextExpiresAt: string | null;
  /** How many are already past their expiry and would be re-fetched. */
  expired: number;
  bytes: number;
  labels: string[];
  /** How long an answer of this kind stays fresh, in force right now. */
  ttlMs: number;
  /** Whether that number is ours or somebody's decision. */
  ttlSource: 'default' | 'set by an admin';
}

/**
 * What is in the cache, grouped the way the panel shows it.
 *
 * The label sample is capped at three per kind: a pool has one row per class
 * root and the panel is a summary, not a listing. `pg_column_size` rather than a
 * length of the JSON text, because that is the number the database will report
 * for the row and a person comparing the two should see them agree.
 */
export async function cacheSummary(categoryId: number): Promise<CacheKindSummary[]> {
  // Every kind the code knows about appears, even with nothing kept yet: a
  // panel that lists only what has been fetched cannot answer "how long would a
  // pool live if I ran this now", which is the question an admin has *before*
  // the first run rather than after it.
  const overrides = new Map<string, number>();
  try {
    const rows = await pool.query(
      'SELECT kind, ttl_ms FROM wikidata_cache_policy WHERE category_id = $1', [categoryId],
    );
    for (const row of rows.rows) overrides.set(row.kind as string, Number(row.ttl_ms));
  } catch (error) {
    console.warn('[Wikidata Cache] Policy read failed:', (error as Error).message);
  }

  const result = await pool.query(
    `SELECT kind,
            COUNT(*)::int AS entries,
            COALESCE(SUM(row_count), 0)::int AS rows,
            COUNT(*) FILTER (WHERE expires_at <= NOW())::int AS expired,
            MIN(fetched_at) AS oldest_fetched_at,
            MIN(expires_at) FILTER (WHERE expires_at > NOW()) AS next_expires_at,
            COALESCE(SUM(pg_column_size(result)), 0)::bigint AS bytes,
            (ARRAY_AGG(label ORDER BY fetched_at DESC))[1:3] AS labels
       FROM wikidata_query_cache
      WHERE category_id = $1
      GROUP BY kind
      ORDER BY kind`,
    [categoryId],
  );
  const stored = new Map(result.rows.map(row => [row.kind as string, row]));
  // What this source can keep, plus anything it has already kept — the second
  // half only matters after a kind is retired from the collector while its rows
  // outlive it, which is exactly when an admin needs the button to drop them.
  const declared = CACHED_KINDS_BY_CATEGORY[categoryId] ?? [];
  const kinds = [...new Set<string>([...declared, ...stored.keys()])].sort();

  return kinds.map((kind) => {
    const row = stored.get(kind);
    const ttlMs = overrides.get(kind) ?? DEFAULT_TTL_MS[kind as CacheKind] ?? 0;
    return {
      kind,
      entries: (row?.entries as number) ?? 0,
      rows: (row?.rows as number) ?? 0,
      expired: (row?.expired as number) ?? 0,
      oldestFetchedAt: row?.oldest_fetched_at ? new Date(row.oldest_fetched_at).toISOString() : null,
      nextExpiresAt: row?.next_expires_at ? new Date(row.next_expires_at).toISOString() : null,
      bytes: Number(row?.bytes ?? 0),
      labels: (row?.labels as string[] | null) ?? [],
      ttlMs,
      ttlSource: overrides.has(kind) ? ('set by an admin' as const) : ('default' as const),
    };
  });
}

/**
 * Drop everything, or one kind of it.
 *
 * Deliberately a delete rather than an expiry stamp: an admin pressing this is
 * saying "ask the source again", and a row marked expired reads the same as a
 * row that aged out, which is a worse story to debug.
 */
export async function clearCache(categoryId: number, kind?: string): Promise<number> {
  const result = kind
    ? await pool.query(
      'DELETE FROM wikidata_query_cache WHERE category_id = $1 AND kind = $2', [categoryId, kind],
    )
    : await pool.query('DELETE FROM wikidata_query_cache WHERE category_id = $1', [categoryId]);
  return result.rowCount ?? 0;
}
