/**
 * Reading the local Wikidata subset's entities and labels (#1459, #1460),
 * shared by every kind's twins: a batch of kept entities, the label chain of
 * any entity the subset names, and the best-rank test on a claim.
 */

import { pool } from '../../../db/index.js';
import type { CompactEntity } from '../../dumps/wikidata/compactEntity.js';
import { LABEL_LANGS } from '../wikidataUtils.js';

export const LANGUAGES = LABEL_LANGS.split(',');

/**
 * A statement still standing: not deprecated, and carrying no end time (`P582`)
 * but a no-value one. An absent `qualifiers` is SQL NULL on the claims table,
 * so the test is spelled over an empty array rather than with `?`, which
 * would make the clause NULL and drop every unqualified statement.
 */
export const STANDING = (alias: string) => `${alias}.rank >= 0 AND NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(coalesce(${alias}.qualifiers -> 'P582', '[]'::jsonb)) ended
   WHERE ended <> '{"novalue": true}'::jsonb)`;

/** Claim `c` is one of its subject's best statements of its property: none outranks it. */
export const BEST = (alias: string) => `NOT EXISTS (
  SELECT 1 FROM wikidata_claims h WHERE h.subject = ${alias}.subject AND h.property = ${alias}.property AND h.rank > ${alias}.rank)`;

export interface Kept {
  sitelinks: number;
  entity: CompactEntity;
}

export async function entitiesOf(ids: string[]): Promise<Map<string, Kept>> {
  if (!ids.length) return new Map();
  const result = await pool.query<{ id: string; sitelink_count: number; entity: CompactEntity }>(
    'SELECT id, sitelink_count, entity FROM wikidata_entities WHERE id = ANY($1::text[])',
    [ids],
  );
  return new Map(result.rows.map(row => [row.id, { sitelinks: row.sitelink_count, entity: row.entity }]));
}

export interface Terms {
  label: string | null;
  description: string | null;
}

/**
 * Each entity's label and description in the first of the label service's
 * languages that has one, as `SERVICE wikibase:label` answers; kept entities
 * and the labels ring both have theirs in `wikidata_labels`.
 */
export async function termsOf(ids: string[]): Promise<Map<string, Terms>> {
  const out = new Map<string, Terms>();
  if (!ids.length) return out;
  const result = await pool.query<{ id: string; language: string; label: string | null; description: string | null }>(
    'SELECT id, language, label, description FROM wikidata_labels WHERE id = ANY($1::text[]) AND language = ANY($2::text[])',
    [ids, LANGUAGES],
  );
  const byId = new Map<string, Map<string, { label: string | null; description: string | null }>>();
  for (const row of result.rows) {
    if (!byId.has(row.id)) byId.set(row.id, new Map());
    byId.get(row.id)!.set(row.language, row);
  }
  for (const [id, languages] of byId) {
    const first = (field: 'label' | 'description') =>
      LANGUAGES.map(language => languages.get(language)?.[field] ?? null).find(value => value !== null) ?? null;
    out.set(id, { label: first('label'), description: first('description') });
  }
  return out;
}

