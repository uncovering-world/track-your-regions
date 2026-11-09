/**
 * A sculpture garden one artist made as a whole (#2037): the Vigeland
 * installation in Oslo, the Tarot Garden, Matthias Braun's Betlém near Kuks.
 * Wikidata types it `sculpture garden`, as it types a garden that gathers
 * many artists' works under a curator (Storm King, the Hakone Open-Air
 * Museum). Two things tell them apart: the maker the garden names of itself
 * (`P170`) — the Tarot Garden names Niki de Saint Phalle, while the
 * Vigeland installation names nobody — and the works the garden holds: every
 * one of the Vigeland installation's that names a maker names Gustav Vigeland,
 * while the Hakone Open-Air Museum's name Picasso and Tumarkin.
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
 * statement that still stands, as a street-art wall's murals are read; and
 * the makers the garden names of itself (`EntityFacts.ownMakers`). Every
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
  const makers = await fetchWorkMakers(run.sparql, [...new Set([...gardens, ...holdings.map((h) => h.work)])]);
  for (const garden of gardens) {
    const known = facts.get(garden)!;
    known.heldMakers = holdings.filter((h) => h.place === garden).map((h) => makers.get(h.work) ?? []);
    known.ownMakers = makers.get(garden) ?? [];
  }
}

/**
 * Whether a sculpture garden is one artist's work: every maker the garden
 * names of itself and every maker any of its works names is the same one,
 * and that one is named by the garden itself or by at least
 * `ONE_ARTIST_MIN_WORKS` of its works. A work or a garden naming two makers
 * names two. The garden's own maker alone is not enough when its works name
 * others: the Cullen Sculpture Garden names Isamu Noguchi, who laid it out,
 * and holds Ellsworth Kelly's and David Smith's.
 */
export function isOneArtistsGarden(e: { classes: string[]; heldMakers?: string[][]; ownMakers?: string[] }): boolean {
  if (!e.classes.includes(SCULPTURE_GARDEN)) return false;
  const own = e.ownMakers ?? [];
  const named = (e.heldMakers ?? []).filter((makers) => makers.length > 0);
  if (new Set([...own, ...named.flat()]).size !== 1) return false;
  return own.length > 0 || named.length >= ONE_ARTIST_MIN_WORKS;
}
