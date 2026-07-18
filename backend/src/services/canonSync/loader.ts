/**
 * Loads a derived CanonDraft into the DB. Slug is the stable identity:
 * countries upsert by slug (ids survive rebuilds, so user prefs survive);
 * coverage/claims/members/presets are replaced wholesale (they are pure
 * derivations). Never touches user_disputed_preferences.
 */
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

async function fetchPrevState(): Promise<{ slug: string; fingerprint: string }[]> {
  const res = await pool.query(`
    SELECT c.slug, c.name, c.class, c.iso_alpha2, c.iso_alpha3, c.m49_code,
           s.slug AS sovereign_slug, c.wikidata_qid
    FROM countries c LEFT JOIN countries s ON s.id = c.sovereign_id`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    slug: r.slug as string,
    fingerprint: JSON.stringify([r.name, r.class, r.iso_alpha2, r.iso_alpha3,
      r.m49_code === null ? null : Number(r.m49_code), r.sovereign_slug ?? null, r.wikidata_qid ?? null]),
  }));
}

async function upsertCountries(draft: CanonDraft): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (const c of draft.countries) {
    const res = await pool.query(`
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
    await pool.query('UPDATE countries SET sovereign_id = $1 WHERE slug = $2',
      [c.sovereignSlug ? ids.get(c.sovereignSlug) ?? null : null, c.slug]);
  }
  // Entries no longer produced by the rules are removed (prefs cascade only
  // via dispute rows; country removal of a slug with history shows in diff)
  await pool.query('DELETE FROM countries WHERE NOT (slug = ANY($1))',
    [draft.countries.map((c) => c.slug)]);
  return ids;
}

async function replaceCoverage(crosswalk: Map<number, string>, ids: Map<string, number>): Promise<void> {
  await pool.query('DELETE FROM country_divisions');
  for (const [divisionId, slug] of crosswalk) {
    const countryId = ids.get(slug);
    if (countryId === undefined) continue;
    await pool.query(
      'INSERT INTO country_divisions (country_id, division_id) VALUES ($1, $2) ON CONFLICT (division_id) DO NOTHING',
      [countryId, divisionId]);
  }
}

async function replaceDisputes(
  draft: CanonDraft, ids: Map<string, number>,
  disputeUnits: Map<string, { divisionIds: number[]; approximate: boolean }>,
): Promise<{ slug: string; unitCount: number; approximate: boolean }[]> {
  const summary: { slug: string; unitCount: number; approximate: boolean }[] = [];
  await pool.query('DELETE FROM disputed_territory_members');
  await pool.query('DELETE FROM disputed_territory_claims');
  await pool.query('DELETE FROM disputed_territories WHERE NOT (slug = ANY($1))',
    [draft.disputes.map((d) => d.slug)]);
  for (const d of draft.disputes) {
    const units = disputeUnits.get(d.slug) ?? { divisionIds: [], approximate: true };
    const res = await pool.query(`
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
      await pool.query(`
        INSERT INTO disputed_territory_claims (dispute_id, country_id, role, note) VALUES ($1, $2, $3, $4)
        ON CONFLICT (dispute_id, country_id) DO UPDATE SET role = EXCLUDED.role, note = EXCLUDED.note`,
        [disputeId, countryId, claim.role, claim.note]);
    }
    for (const divisionId of units.divisionIds) {
      await pool.query(
        'INSERT INTO disputed_territory_members (dispute_id, division_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [disputeId, divisionId]);
    }
    summary.push({ slug: d.slug, unitCount: units.divisionIds.length, approximate: units.approximate });
  }
  return summary;
}

async function replacePresets(draft: CanonDraft, ids: Map<string, number>): Promise<void> {
  await pool.query('DELETE FROM disputed_preset_choices');
  for (const p of draft.presets) {
    const res = await pool.query(`
      INSERT INTO disputed_presets (slug, name, is_default) VALUES ($1, $2, $3)
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, is_default = EXCLUDED.is_default
      RETURNING id`, [p.slug, p.name, p.isDefault]);
    const presetId = (res.rows[0] as { id: number }).id;
    for (const choice of p.choices) {
      const disputeRes = await pool.query('SELECT id FROM disputed_territories WHERE slug = $1', [choice.disputeSlug]);
      if (disputeRes.rows.length === 0) continue;
      await pool.query(`
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

export async function loadCanon(
  draft: CanonDraft,
  crosswalk: Map<number, string>,
  disputeUnits: Map<string, { divisionIds: number[]; approximate: boolean }>,
  sourceVersions: Record<string, string>,
  unmatchedRootUnits: { id: number; name: string }[] = [],
): Promise<CanonSyncReport> {
  const prev = await fetchPrevState();
  const ids = await upsertCountries(draft);
  await replaceCoverage(crosswalk, ids);
  const disputes = await replaceDisputes(draft, ids, disputeUnits);
  await replacePresets(draft, ids);
  await pool.query('REFRESH MATERIALIZED VIEW division_canon_map');
  const { added, removed, changed } = diffCanon(prev, draft);
  return {
    countriesTotal: draft.countries.length,
    added, removed, changed,
    unmatchedRootUnits,
    disputes,
    warnings: draft.warnings,
    sourceVersions,
  };
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
