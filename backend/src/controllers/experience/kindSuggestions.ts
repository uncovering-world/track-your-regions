/**
 * The writes to `experience_kind_suggestions` — Jev's reading of which kind,
 * live or planned, an arriving place belongs to (#2342, ADR-0087) — under the
 * place's lock (ADR-0077 decision 4), and the SQL the card, the usage count and
 * the writer read the question's inputs by.
 *
 * The table's writers are a closed list the backend lint names
 * (`KIND_SUGGESTION_WRITE_RULES`): this module alone. A reading is recorded
 * for the place and the kinds offered as the question was built from them
 * (`askedSql`), so it is that place's reading against those kinds and no
 * other: once the place is renamed or gains an article, or the register is
 * reloaded with a kind added, built or redefined, the card asks again. One row
 * per call.
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';
import { KINDS, kindIsRealSql } from '../../db/membership.js';
import { INSCRIBED_KIND_ID } from './kindAddController.js';

/**
 * The kinds Jev is offered, as rows `(kind_id, slug, name, definition, issue)`
 * in the order the question lists them: every real kind of the catalogue but
 * World Heritage Sites, with the register's definition of it (its name where
 * the register holds none), then every place kind the register plans. A live
 * kind's row has no slug, a planned one's no kind id.
 */
export function kindOptionsSql(): string {
  return `(SELECT k.id AS kind_id, NULL::text AS slug, k.name::text AS name,
                  COALESCE(ck.definition, k.name)::text AS definition, NULL::int AS issue, 0 AS rank
             FROM ${KINDS} k
             LEFT JOIN coverage_kinds ck ON ck.experience_kind_id = k.id AND ck.status = 'live'
            WHERE ${kindIsRealSql('k')} AND k.id <> ${INSCRIBED_KIND_ID}
           UNION ALL
           SELECT NULL, ck.slug::text, ck.name::text, ck.definition, ck.issue_number, 1
             FROM coverage_kinds ck
            WHERE ck.status = 'proposed' AND ck.form = 'place')`;
}

/** A digest of the kinds Jev is offered, which a reading is recorded for with the place. */
function kindOptionsDigestSql(): string {
  return `(SELECT md5(COALESCE(string_agg(concat_ws('|', o.kind_id, o.slug, o.name, o.definition), E'\\n'
                                         ORDER BY o.rank, o.kind_id, o.slug), ''))
             FROM ${kindOptionsSql()} o)`;
}

/**
 * The place as a question is built from it, off its row `e`, with the digest
 * of the kinds offered: what a reading is recorded for, and what the card
 * compares a reading with. Built in SQL on every side, so they never differ in
 * how a name is spelled.
 */
export function askedSql(e = 'e'): string {
  return `jsonb_build_object(
            'name', ${e}.name,
            'countries', to_jsonb(COALESCE(${e}.country_names, '{}'::text[])),
            'description', ${e}.subtitle,
            'map', ${e}.metadata->'osm'->>'tag',
            'article', ${e}.metadata->>'wikipediaUrl',
            'kinds', ${kindOptionsDigestSql()})`;
}

/**
 * The newest reading recorded for the place `e` as it stands, as
 * `{ reading, kindId, plannedKind, confidence }` (a null reading for an
 * answer the client refused), or null where none was: what the card reads
 * before it pays for a new one.
 */
export function newestKindReadingSql(e = 'e'): string {
  return `(SELECT jsonb_build_object('reading', g.reading, 'kindId', g.kind_id, 'plannedKind', g.planned_kind,
                                     'confidence', g.confidence)
             FROM experience_kind_suggestions g
            WHERE g.experience_id = ${e}.id AND g.asked = ${askedSql(e)}
            ORDER BY g.asked_at DESC, g.id DESC LIMIT 1)`;
}

/** What Jev's pick names: a live kind, a planned one, or neither. */
export type KindReading =
  | { reading: 'live'; kindId: number }
  | { reading: 'planned'; plannedKind: string }
  | { reading: 'none' };

/** What Jev answered for one place. */
export interface KindSuggestionRecord {
  /** Jev's reading, or null for an answer the client refused. */
  pick: KindReading | null;
  confidence: number;
  probabilities: Record<string, number>;
  model: string;
  inputTokens: number;
  /** The place and the kinds offered as the question was built from them (`askedSql`), as they stood when asked. */
  asked: unknown;
  /** The article lead Jev read, or null. */
  lead: string | null;
}

/**
 * Record a call, a row per call, since the rows are what the calls cost. It
 * is recorded for the place Jev was asked about, so an answer about a place a
 * run renamed during the call is kept and never the card's. Answers whether
 * this one is about the place and the kinds as they stand now, under the lock;
 * whether the place is still arriving is the caller's to ask under the same lock.
 */
export async function recordKindSuggestion(
  client: PoolClient,
  lock: LockedExperience,
  record: KindSuggestionRecord,
): Promise<boolean> {
  const { pick } = record;
  const inserted = await client.query<{ current: boolean }>(
    `INSERT INTO experience_kind_suggestions
       (experience_id, asked, article_lead, reading, kind_id, planned_kind, confidence, probabilities, model, input_tokens)
     SELECT e.id, $2::jsonb, $3, $4, $5, $6, $7, $8::jsonb, $9, $10
       FROM experiences e WHERE e.id = $1
     RETURNING asked = (SELECT ${askedSql('e')} FROM experiences e WHERE e.id = $1) AS current`,
    [lock.id, JSON.stringify(record.asked), record.lead, pick?.reading ?? null,
      pick?.reading === 'live' ? pick.kindId : null, pick?.reading === 'planned' ? pick.plannedKind : null,
      record.confidence, JSON.stringify(record.probabilities), record.model, record.inputTokens],
  );
  return inserted.rows[0]?.current === true;
}
