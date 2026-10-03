/**
 * An umbrella organisation is never a door (#798), on a graph loaded the way a
 * run loads it: the walk's details and edges, then the museum parts of every
 * door candidate. The Kupferstich-Kabinett is part of the Staatliche
 * Kunstsammlungen Dresden, whose coordinate lies 11 m from its own and which
 * is the better-known name — the two signals the door rule reads — but whose
 * fifteen museums reach as far as the Grassi in Leipzig. Palazzo Pitti, the
 * door of the Galleria Palatina, counts only museums inside it.
 */
import { describe, it, expect, vi } from 'vitest';
import { foldVenues, loadVenueGraph } from './venueGraph.js';
import { museumRule } from './venueTest.js';
import type { SparqlBinding } from '../wikidataUtils.js';
import type { QueryRunner, SparqlFn } from '../wikidataQueries.js';
import { isWikipediaEditionsQuery, wikipediaEditionsRows } from '../wikipediaEditionsFixture.js';

const ENTITY = 'http://www.wikidata.org/entity/';
const ART_MUSEUM = 'Q207694';

const KABINETT = 'Q570620';
const SKD = 'Q653002';
const GRASSI = 'Q876610';
const PALATINA = 'Q866498';
const PITTI = 'Q29286';
const GAM_FLORENCE = 'Q3094628';

interface Entity {
  lat: number; lon: number; sitelinks: number; parents?: string[]; locations?: string[];
  /** Museums it counts among its parts, where they stand. */
  parts?: [string, number, number][];
}

const WORLD: Record<string, Entity> = {
  [KABINETT]: { lat: 51.0527, lon: 13.7373, sitelinks: 11, parents: [SKD] },
  [SKD]: {
    lat: 51.0528, lon: 13.7374, sitelinks: 17,
    parts: [[KABINETT, 51.0527, 13.7373], [GRASSI, 51.3369, 12.3886]],
  },
  [PALATINA]: { lat: 43.7651, lon: 11.2500, sitelinks: 30, locations: [PITTI] },
  [PITTI]: {
    lat: 43.7651, lon: 11.2501, sitelinks: 50,
    parts: [[PALATINA, 43.7651, 11.2500], [GAM_FLORENCE, 43.7652, 11.2504]],
  },
};

const uri = (qid: string) => ({ value: `${ENTITY}${qid}` });
const point = (lat: number, lon: number) => ({ value: `Point(${lon} ${lat})` });

/** The entities a question names in its `VALUES ?e` block. */
function askedFor(query: string): string[] {
  const block = /VALUES \?e \{([^}]*)\}/.exec(query)?.[1] ?? '';
  return [...block.matchAll(/wd:(Q\d+)/g)].map((m) => m[1]);
}

/** The museum parts each entity counts, as `fetchMuseumParts` asks for them. */
const partRows = (qids: string[]): SparqlBinding[] => qids.flatMap((qid) =>
  (WORLD[qid].parts ?? []).map(([part, lat, lon]) => ({ e: uri(qid), part: uri(part), coord: point(lat, lon) })));

/** Classes, parents and locations, as `fetchEntityEdges` asks for them. */
const edgeRows = (qids: string[]): SparqlBinding[] => qids.flatMap((qid) => [
  { e: uri(qid), cls: uri(ART_MUSEUM) },
  ...(WORLD[qid].parents ?? []).map((parent) => ({ e: uri(qid), parent: uri(parent) })),
  ...(WORLD[qid].locations ?? []).map((loc) => ({ e: uri(qid), loc: uri(loc) })),
]);

/** Where each entity stands and how known it is, as `fetchEntityDetails` asks for them. */
const detailRows = (qids: string[]): SparqlBinding[] => qids.map((qid) => ({
  e: uri(qid), eLabel: { value: qid }, coord: point(WORLD[qid].lat, WORLD[qid].lon),
  sl: { value: String(WORLD[qid].sitelinks) },
}));

function world(): { sparql: ReturnType<typeof vi.fn<SparqlFn>>; asked: string[][] } {
  const asked: string[][] = [];
  const sparql = vi.fn<SparqlFn>(async (query) => {
    if (isWikipediaEditionsQuery(query)) return wikipediaEditionsRows(query, (q) => WORLD[q]?.sitelinks);
    const qids = askedFor(query).filter((q) => WORLD[q]);
    if (query.includes('?e wdt:P527 ?part')) {
      asked.push(askedFor(query));
      return partRows(qids);
    }
    if (query.includes('?e wdt:P31 ?cls')) return edgeRows(qids);
    if (query.includes('?e wdt:P625 ?coord')) return detailRows(qids);
    throw new Error(`unexpected query: ${query}`);
  });
  return { sparql, asked };
}

async function graphFor() {
  const { sparql, asked } = world();
  const run: QueryRunner = { sparql, phase: () => {}, step: async () => {} };
  const rule = museumRule(new Set([ART_MUSEUM]));
  const graph = await loadVenueGraph(run, [KABINETT, PALATINA], rule);
  return { graph, rule, asked };
}

describe('an umbrella organisation and the door rule', () => {
  it('reads an entity whose museums stand across the country as an organisation, and a palace as a building', async () => {
    const { graph } = await graphFor();
    expect(graph.isOrganisation(SKD)).toBe(true);
    expect(graph.isOrganisation(PITTI)).toBe(false);
    // A venue with no parts of its own is no organisation.
    expect(graph.isOrganisation(KABINETT)).toBe(false);
  });

  it('asks the parts question of the door candidates only, not of the venues', async () => {
    const { asked } = await graphFor();
    expect(asked.flat().sort()).toEqual([PITTI, SKD].sort());
  });

  it('leaves a branch under its own name rather than folding it into its umbrella', async () => {
    const { graph, rule } = await graphFor();
    const folds = foldVenues({ Q1: [KABINETT], Q2: [PALATINA] }, graph, rule);

    expect(folds[KABINETT]).toBeUndefined();
    // The door rule is otherwise untouched: the Galleria Palatina is Palazzo Pitti's.
    expect(folds[PALATINA]).toMatchObject({ into: PITTI, kind: 'door' });
  });
});
