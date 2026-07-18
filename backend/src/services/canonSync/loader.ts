/**
 * Loads a derived CanonDraft into the DB inside a single transaction. Slug is
 * the stable identity: countries upsert by slug (ids survive rebuilds, so
 * user prefs survive); coverage/claims/members/presets are replaced
 * wholesale (they are pure derivations). A country or disputed territory the
 * current draft no longer produces is deleted only when no
 * user_disputed_preferences row references it; when referenced, the row is
 * retained (its members/claims/coverage are already gone via the wholesale
 * rebuild, so it is inert) and a warning is added to the report instead.
 * Never writes to user_disputed_preferences.
 */
import type { PoolClient } from 'pg';
import { pool } from '../../db/index.js';
import type { CanonDraft, CanonSyncReport, CountryDraft } from './types.js';

export function fingerprintCountry(c: CountryDraft): string {
  return JSON.stringify([c.name, c.class, c.iso2, c.iso3, c.m49, c.sovereignSlug, c.wikidataQid]);
}

export function diffCanon(
  prev: { slug: string; fingerprint: string }[],
  draft: CanonDraft,
): { added: string[]; removed: string[]; changed: string[] } {
  const prevMap = new Map(prev.map((p) => [p.slug, p.fingerprint]));
  const nextMap = new Map(draft.countries.map((c) => [c.slug, fingerprintCountry(c)]));
  const added = [...nextMap.keys()].filter((s) => !prevMap.has(s)).sort();
  const removed = [...prevMap.keys()].filter((s) => !nextMap.has(s)).sort();
  const changed = [...nextMap.entries()]
    .filter(([slug, fp]) => prevMap.has(slug) && prevMap.get(slug) !== fp)
    .map(([slug]) => slug).sort();
  return { added, removed, changed };
}

async function fetchPrevState(client: PoolClient): Promise<{ slug: string; fingerprint: string }[]> {
  const res = await client.query(`
    SELECT c.slug, c.name, c.class, c.iso_alpha2, c.iso_alpha3, c.m49_code,
           s.slug AS sovereign_slug, c.wikidata_qid
    FROM countries c LEFT JOIN countries s ON s.id = c.sovereign_id`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    slug: r.slug as string,
    fingerprint: JSON.stringify([r.name, r.class, r.iso_alpha2, r.iso_alpha3,
      r.m49_code === null ? null : Number(r.m49_code), r.sovereign_slug ?? null, r.wikidata_qid ?? null]),
  }));
}

async function upsertCountries(client: PoolClient, draft: CanonDraft): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (const c of draft.countries) {
    const res = await client.query(`
      INSERT INTO countries (slug, name, class, iso_alpha2, iso_alpha3, m49_code, wikidata_qid, sources, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name, class = EXCLUDED.class, iso_alpha2 = EXCLUDED.iso_alpha2,
        iso_alpha3 = EXCLUDED.iso_alpha3, m49_code = EXCLUDED.m49_code,
        wikidata_qid = EXCLUDED.wikidata_qid, sources = EXCLUDED.sources, updated_at = NOW()
      RETURNING id`,
      [c.slug, c.name, c.class, c.iso2, c.iso3, c.m49, c.wikidataQid, JSON.stringify(c.provenance)]);
    ids.set(c.slug, (res.rows[0] as { id: number }).id);
  }
  // Sovereign links in a second pass (all ids known)
  for (const c of draft.countries) {
    await client.query('UPDATE countries SET sovereign_id = $1 WHERE slug = $2',
      [c.sovereignSlug ? ids.get(c.sovereignSlug) ?? null : null, c.slug]);
  }
  // Stale-country deletion happens LAST (see deleteStaleCountries): it must
  // run after disputes/presets are rebuilt, and it is preference-aware.
  return ids;
}

async function replaceCoverage(
  client: PoolClient, crosswalk: Map<number, string>, ids: Map<string, number>,
): Promise<void> {
  await client.query('DELETE FROM country_divisions');
  for (const [divisionId, slug] of crosswalk) {
    const countryId = ids.get(slug);
    if (countryId === undefined) continue;
    await client.query(
      'INSERT INTO country_divisions (country_id, division_id) VALUES ($1, $2) ON CONFLICT (division_id) DO NOTHING',
      [countryId, divisionId]);
  }
}

interface StaleRow { slug: string; id: number; pref_count: string }

/** Splits rows no longer produced by the draft into safe-to-delete ids vs. retained-with-warning. */
function splitStaleRows(rows: StaleRow[], kind: 'dispute' | 'country'): { staleIds: number[]; warnings: string[] } {
  const staleIds: number[] = [];
  const warnings: string[] = [];
  for (const row of rows) {
    const prefCount = parseInt(row.pref_count, 10);
    if (prefCount === 0) {
      staleIds.push(row.id);
    } else {
      warnings.push(`stale ${kind} ${row.slug} retained: ${prefCount} user preference(s) reference it`);
    }
  }
  return { staleIds, warnings };
}

/**
 * Deletes disputed_territories rows the current draft no longer produces,
 * unless a user_disputed_preferences row still references them. Retained
 * rows are already inert: their members/claims are gone via the wholesale
 * rebuild below (member/claim tables are wiped unconditionally and only
 * re-populated for disputes present in the current draft).
 */
async function deleteStaleDisputes(client: PoolClient, draft: CanonDraft): Promise<string[]> {
  const res = await client.query(`
    SELECT dt.slug, dt.id, COUNT(udp.user_id) AS pref_count
    FROM disputed_territories dt
    LEFT JOIN user_disputed_preferences udp ON udp.dispute_id = dt.id
    WHERE NOT (dt.slug = ANY($1))
    GROUP BY dt.slug, dt.id`,
    [draft.disputes.map((d) => d.slug)]);
  const { staleIds, warnings } = splitStaleRows(res.rows as StaleRow[], 'dispute');
  if (staleIds.length > 0) {
    await client.query('DELETE FROM disputed_territories WHERE id = ANY($1)', [staleIds]);
  }
  return warnings;
}

type DisputeSummary = CanonSyncReport['disputes'][number];

async function replaceDisputes(
  client: PoolClient, draft: CanonDraft, ids: Map<string, number>,
  disputeUnits: Map<string, { divisionIds: number[]; approximate: boolean }>,
): Promise<{ summary: DisputeSummary[]; warnings: string[] }> {
  await client.query('DELETE FROM disputed_territory_members');
  await client.query('DELETE FROM disputed_territory_claims');
  const warnings = await deleteStaleDisputes(client, draft);

  const summary: DisputeSummary[] = [];
  for (const d of draft.disputes) {
    const units = disputeUnits.get(d.slug) ?? { divisionIds: [], approximate: true };
    const res = await client.query(`
      INSERT INTO disputed_territories (slug, name, kind, subject_country_id, is_approximate, wikidata_qid, sources)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name, kind = EXCLUDED.kind, subject_country_id = EXCLUDED.subject_country_id,
        is_approximate = EXCLUDED.is_approximate, wikidata_qid = EXCLUDED.wikidata_qid, sources = EXCLUDED.sources
      RETURNING id`,
      [d.slug, d.name, d.kind, d.subjectCountrySlug ? ids.get(d.subjectCountrySlug) ?? null : null,
        units.approximate, d.wikidataQid, JSON.stringify(d.provenance)]);
    const disputeId = (res.rows[0] as { id: number }).id;
    for (const claim of d.claims) {
      const countryId = ids.get(claim.countrySlug);
      if (countryId === undefined) continue;
      await client.query(`
        INSERT INTO disputed_territory_claims (dispute_id, country_id, role, note) VALUES ($1, $2, $3, $4)
        ON CONFLICT (dispute_id, country_id) DO UPDATE SET role = EXCLUDED.role, note = EXCLUDED.note`,
        [disputeId, countryId, claim.role, claim.note]);
    }
    for (const divisionId of units.divisionIds) {
      await client.query(
        'INSERT INTO disputed_territory_members (dispute_id, division_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [disputeId, divisionId]);
    }
    summary.push({ slug: d.slug, unitCount: units.divisionIds.length, approximate: units.approximate });
  }
  return { summary, warnings };
}

async function replacePresets(client: PoolClient, draft: CanonDraft, ids: Map<string, number>): Promise<void> {
  await client.query('DELETE FROM disputed_preset_choices');
  // Presets no longer produced by the rules: choices cascade, and nothing
  // else (incl. user_disputed_preferences) references presets, so this is a
  // plain wholesale cleanup — no preference-aware retention needed.
  await client.query('DELETE FROM disputed_presets WHERE NOT (slug = ANY($1))',
    [draft.presets.map((p) => p.slug)]);
  for (const p of draft.presets) {
    const res = await client.query(`
      INSERT INTO disputed_presets (slug, name, is_default) VALUES ($1, $2, $3)
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, is_default = EXCLUDED.is_default
      RETURNING id`, [p.slug, p.name, p.isDefault]);
    const presetId = (res.rows[0] as { id: number }).id;
    for (const choice of p.choices) {
      const disputeRes = await client.query('SELECT id FROM disputed_territories WHERE slug = $1', [choice.disputeSlug]);
      if (disputeRes.rows.length === 0) continue;
      await client.query(`
        INSERT INTO disputed_preset_choices (preset_id, dispute_id, counts_as, country_id, sources)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (preset_id, dispute_id) DO UPDATE SET
          counts_as = EXCLUDED.counts_as, country_id = EXCLUDED.country_id, sources = EXCLUDED.sources`,
        [presetId, (disputeRes.rows[0] as { id: number }).id, choice.countsAs,
          choice.countrySlug ? ids.get(choice.countrySlug) ?? null : null,
          JSON.stringify([choice.provenance])]);
    }
  }
}

/**
 * Deletes countries the current draft no longer produces, unless a
 * user_disputed_preferences row still references them. Runs LAST (after
 * disputes/presets are rebuilt): disputed_territories.subject_country_id and
 * disputed_preset_choices.country_id for every row touched by THIS sync only
 * ever resolve through `ids` (current countries), so by this point the only
 * remaining NO ACTION exposure on a stale country is user_disputed_preferences,
 * which the pref-count check below clears before deleting.
 */
async function deleteStaleCountries(client: PoolClient, draft: CanonDraft): Promise<string[]> {
  const res = await client.query(`
    SELECT c.slug, c.id, COUNT(udp.user_id) AS pref_count
    FROM countries c
    LEFT JOIN user_disputed_preferences udp ON udp.country_id = c.id
    WHERE NOT (c.slug = ANY($1))
    GROUP BY c.slug, c.id`,
    [draft.countries.map((c) => c.slug)]);
  const { staleIds, warnings } = splitStaleRows(res.rows as StaleRow[], 'country');
  if (staleIds.length > 0) {
    await client.query('DELETE FROM countries WHERE id = ANY($1)', [staleIds]);
  }
  return warnings;
}

export async function loadCanon(
  draft: CanonDraft,
  crosswalk: Map<number, string>,
  disputeUnits: Map<string, { divisionIds: number[]; approximate: boolean }>,
  sourceVersions: Record<string, string>,
  unmatchedRootUnits: { id: number; name: string }[] = [],
): Promise<CanonSyncReport> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Guard first, before any mutating statement: an empty derivation is
    // almost certainly a source/rule failure, not "the world has no
    // countries" — refuse rather than wipe the canon out from under it.
    if (draft.countries.length === 0) {
      throw new Error('refusing to load an empty canon (no countries derived)');
    }
    const draftWarnings = [...draft.warnings];
    if (draft.disputes.length === 0) {
      draftWarnings.push('no disputes derived — dispute layer will be emptied');
    }

    const prev = await fetchPrevState(client);
    const ids = await upsertCountries(client, draft);
    await replaceCoverage(client, crosswalk, ids);
    const { summary: disputes, warnings: disputeWarnings } = await replaceDisputes(client, draft, ids, disputeUnits);
    await replacePresets(client, draft, ids);
    const countryWarnings = await deleteStaleCountries(client, draft);
    await client.query('REFRESH MATERIALIZED VIEW division_canon_map');
    await client.query('COMMIT');

    const { added, removed, changed } = diffCanon(prev, draft);
    return {
      countriesTotal: draft.countries.length,
      added, removed, changed,
      unmatchedRootUnits,
      disputes,
      warnings: [...draftWarnings, ...disputeWarnings, ...countryWarnings],
      sourceVersions,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function createCanonSyncLog(triggeredBy: number | null): Promise<number> {
  const res = await pool.query(
    'INSERT INTO canon_sync_logs (status, triggered_by) VALUES ($1, $2) RETURNING id',
    ['running', triggeredBy]);
  return (res.rows[0] as { id: number }).id;
}

export async function finishCanonSyncLog(
  logId: number, status: 'success' | 'partial' | 'failed' | 'cancelled',
  report: CanonSyncReport | null,
): Promise<void> {
  await pool.query(
    `UPDATE canon_sync_logs SET status = $1, report = $2, source_versions = $3, completed_at = NOW() WHERE id = $4`,
    [status, report ? JSON.stringify(report) : null,
      report ? JSON.stringify(report.sourceVersions) : null, logId]);
}
