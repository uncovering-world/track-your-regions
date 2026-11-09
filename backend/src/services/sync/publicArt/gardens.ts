/**
 * A sculpture garden one artist made as a whole (#2037): the Vigeland
 * installation in Oslo, Millesgården, Matthias Braun's Betlém near Kuks.
 * Wikidata types it `sculpture garden`, as it types a garden that gathers
 * many artists' works under a curator (Storm King, the Hakone Open-Air
 * Museum), and names the maker of neither garden: a garden's own creator
 * statement is missing on all three of the calibration list's. What tells
 * them apart is the works the garden holds: every one of the Vigeland
 * installation's that names a maker names Gustav Vigeland, while the Hakone
 * Open-Air Museum's name Picasso and Tumarkin.
 */

import { extractQid, isQid } from '../wikidataUtils.js';
import { chunk, ENTITY_PREFIX, values, type QueryRunner, type SparqlFn } from '../wikidataQueries.js';
import { readsSubset } from '../subset/reader.js';
import { subsetWorkMakers } from '../subset/publicArt.js';
import { SCULPTURE_GARDEN } from './classes.js';
import type { EntityFacts } from './queries.js';
import { fetchStreetArtHoldings } from './streetArtQueries.js';

const BATCH = 200;

/**
 * The fewest of a garden's works that must name a maker before their one
 * maker makes the garden that artist's work. One is not enough: Storm King
 * holds a single work Wikidata gives a maker (Andy Goldsworthy's), and so do
 * Ekebergparken and Jupiter Artland, all three collections of many artists.
 * Measured on the subset on 2026-11-09: at two, Park Güell, the Vigeland
 * installation, Millesgården and Betlém pass, and the one collection that
 * does is the Donald M. Kendall Sculpture Gardens, whose four recorded works
 * are all Henry Moore's.
 */
export const ONE_ARTIST_MIN_WORKS = 2;

/** The makers (`P170`, items only) each of `works` names, best-ranked; a work that names none is absent. */
export async function fetchWorkMakers(sparql: SparqlFn, works: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const batch of chunk(works.filter(isQid), BATCH)) {
    if (readsSubset(sparql)) {
      for (const [work, makers] of await subsetWorkMakers(batch)) out.set(work, makers);
      continue;
    }
    const rows = await sparql(`
      SELECT ?work ?maker WHERE {
        VALUES ?work { ${values(batch)} }
        ?work wdt:P170 ?maker . FILTER(STRSTARTS(STR(?maker), "${ENTITY_PREFIX}Q"))
      }`, { kind: 'edges', label: `the makers of ${batch.length} works` });
    for (const row of rows) {
      const work = extractQid(row.work?.value ?? '');
      const maker = extractQid(row.maker?.value ?? '');
      if (!isQid(work) || !isQid(maker)) continue;
      const makers = out.get(work) ?? [];
      if (!makers.includes(maker)) makers.push(maker);
      out.set(work, makers);
    }
  }
  return out;
}

/**
 * The makers of every work each sculpture garden among the candidates holds,
 * written onto the garden's facts (`EntityFacts.heldMakers`): a work standing
 * in it (`P276`), part of it (`P361`) or named as its part (`P527`), by a
 * statement that still stands, as a street-art wall's murals are read. Every
 * candidate whose facts were read is asked, not the shared pool alone: a
 * garden in the kind's own admission pool, one an entrance named and an
 * admitted one read by id are judged by the same rule.
 */
export async function readGardenMakers(run: QueryRunner, facts: Map<string, EntityFacts>): Promise<void> {
  const gardens = [...facts].filter(([, known]) => known.classes.includes(SCULPTURE_GARDEN)).map(([qid]) => qid);
  if (!gardens.length) return;
  run.phase(`Reading who made the works of ${gardens.length} sculpture gardens...`);
  await run.step();
  const holdings = await fetchStreetArtHoldings(run.sparql, gardens);
  await run.step();
  const makers = await fetchWorkMakers(run.sparql, [...new Set(holdings.map((h) => h.work))]);
  for (const garden of gardens) {
    facts.get(garden)!.heldMakers = holdings.filter((h) => h.place === garden).map((h) => makers.get(h.work) ?? []);
  }
}

/**
 * Whether a sculpture garden is one artist's work: at least
 * `ONE_ARTIST_MIN_WORKS` of its works name a maker, and every maker any of
 * them names is the same one. A work naming two makers names two.
 */
export function isOneArtistsGarden(e: { classes: string[]; heldMakers?: string[][] }): boolean {
  if (!e.classes.includes(SCULPTURE_GARDEN)) return false;
  const named = (e.heldMakers ?? []).filter((makers) => makers.length > 0);
  return named.length >= ONE_ARTIST_MIN_WORKS && new Set(named.flat()).size === 1;
}
