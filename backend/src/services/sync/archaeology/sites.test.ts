/**
 * The site pool: what it asks, in what order, and which answers it names.
 *
 * The door itself is `siteTest.test.ts`'s. What is asserted here is the wiring
 * — the bands, the batches, the one OSM read after the pool is known, and the
 * silence below the line that keeps a curator's refusal list readable.
 *
 * Every QID, class, tag and object id below is real: read off
 * `data/cache/osm-sites/` (`wd-sites.json`, `osm-tags.json`) and confirmed with
 * `wbgetentities` on 2026-09-14. Athens is worth the note — its classes are
 * `big city, largest city, metropolis, free city`, and it reaches a pool of
 * *archaeological sites* through `free city` alone, which is under
 * `archaeological site` and under `human settlement` both. That is the pool
 * this wiring has to carry.
 */
import { describe, it, expect } from 'vitest';
import { buildArchaeologyTrees, OSM_KEEP_WKT, SITE_ROOT } from './classes.js';
import { collectSitesByFame, OsmAnswerFloorError } from './sites.js';
import type { KeepWkt, OsmObject } from '../osm/types.js';
import type { SparqlBinding } from '../wikidataUtils.js';

const uri = (qid: string) => ({ value: `http://www.wikidata.org/entity/${qid}` });
const LINE = { enterSitelinks: 22, staySitelinks: 18 };

/**
 * The trees a run fetches, as far as these three rows need them. Real edges,
 * checked on 2026-09-14: `polis`, `ancient city`, `settlement site`, `free
 * city` and `Bronze Age settlement` are under `archaeological site`, and every
 * one of them is under `human settlement` too; `big city`, `largest city`,
 * `metropolis` and `city-state` are under the settlement root only.
 */
const TREES = buildArchaeologyTrees({
  museum: [], park: [], naturalHistory: [], artefact: [],
  site: [SITE_ROOT, 'Q148837', 'Q15661340', 'Q1708422', 'Q5500203', 'Q65064889'],
  settlement: ['Q486972', 'Q133442', 'Q148837', 'Q1549591', 'Q15661340',
    'Q1708422', 'Q200250', 'Q51929311', 'Q5500203', 'Q65064889'],
  shipwreck: ['Q852190'],
});

/** Troy, Athens and Pompeii as the pool answers for them (`wd-sites.json`). */
const POOL: Record<string, { label: string; sitelinks: number; lat: number; lon: number }> = {
  Q22647: { label: 'Troy', sitelinks: 121, lat: 39.9575, lon: 26.238889 },
  Q1524: { label: 'Athens', sitelinks: 288, lat: 37.984167, lon: 23.728056 },
  Q43332: { label: 'Pompeii', sitelinks: 122, lat: 40.750556, lon: 14.489722 },
  // Not a site at all: what the source admits through its other door
  // (`wbgetentities`, 2026-09-14: 109 sitelinks, `museum`, `art museum`).
  Q6373: { label: 'British Museum', sitelinks: 109, lat: 51.51944, lon: -0.12694 },
};

/** Their `P31`s, in full: not one of Troy's says "dig", and none of Athens' does. */
const CLASSES: Record<string, string[]> = {
  Q22647: ['Q148837', 'Q133442', 'Q1708422', 'Q65064889'],
  Q1524: ['Q1549591', 'Q51929311', 'Q200250', 'Q5500203'],
  Q43332: ['Q839954', 'Q15661340'],
  Q6373: ['Q33506', 'Q207694'],
};

/** `P757`: Troy is World Heritage 849 itself. */
const WORLD_HERITAGE = new Set(['Q22647']);

/** `P1082`: Athens counts 643,452 people and Pompeii counts 0 — both say so. */
const POPULATION = new Set(['Q1524', 'Q43332']);

function poolRow(qid: string): SparqlBinding {
  const row = POOL[qid];
  return {
    e: uri(qid),
    eLabel: { value: row.label },
    sl: { value: String(row.sitelinks) },
    coord: { value: `Point(${row.lon} ${row.lat})` },
  };
}

function factRows(query: string): SparqlBinding[] {
  const asked = [...query.matchAll(/wd:(Q\d+)/g)].map((m) => m[1]);
  return asked.flatMap((qid) => [
    ...(CLASSES[qid] ?? []).map((cls) => ({ e: uri(qid), cls: uri(cls) })),
    ...(WORLD_HERITAGE.has(qid) ? [{ e: uri(qid), whc: { value: '849' } }] : []),
    ...(POPULATION.has(qid) ? [{ e: uri(qid), pop: { value: '643452' } }] : []),
  ]);
}

function door(query: string): SparqlBinding[] {
  if (/wdt:P279\* wd:/.test(query)) throw new Error('the trees are fetched elsewhere');
  if (query.includes('?whc')) return factRows(query);

  // A batch asked for by id: whatever the pool holds under those ids, whatever
  // their classes — a question by id vouches for nothing but the id.
  if (/VALUES \?e \{/.test(query)) {
    return [...query.matchAll(/wd:(Q\d+)/g)]
      .map((m) => m[1])
      .filter((qid) => qid in POOL)
      .map(poolRow);
  }

  // A banded pool question over the root, or a batch of narrow classes. The
  // floor and the ceiling are read separately: a band states both, and the
  // narrow-class question states only the pool's floor.
  const floor = /\?sl >= (\d+)/.exec(query);
  if (!floor) return [];
  const ceiling = /\?sl < (\d+)/.exec(query);
  const min = Number(floor[1]);
  const max = ceiling ? Number(ceiling[1]) : null;
  const root = /\?e wdt:P31 wd:(Q\d+)/.exec(query);
  const asked = [...query.matchAll(/wd:(Q\d+)/g)].map((m) => m[1]);
  return Object.keys(POOL)
    .filter((qid) => {
      const { sitelinks } = POOL[qid];
      if (sitelinks < min || (max !== null && sitelinks >= max)) return false;
      const carried = CLASSES[qid] ?? [];
      return root ? carried.includes(root[1]) : carried.some((cls) => asked.includes(cls));
    })
    .map(poolRow);
}

/**
 * What OSM maps under each item, as `osm-tags.json` holds it. The polygon is
 * cut to four points: the measurement kept every object's geometry *type*, not
 * the tracing, and the rule reads the type and the length.
 */
const OSM: Record<string, OsmObject[]> = {
  Q22647: [{
    ref: 'way/423938794',
    kind: 'way',
    tags: {
      historic: 'archaeological_site',
      archaeological_site: 'city',
      heritage: '1',
      tourism: 'attraction',
      boundary: 'protected_area',
      name: "Troya'nın Arkeolojik Alanı",
    },
    geometryType: 'POLYGON',
    wkt: 'POLYGON((26.23 39.95,26.24 39.95,26.24 39.96,26.23 39.95))',
  }],
  Q1524: [{
    ref: 'node/441183',
    kind: 'node',
    tags: { place: 'city', name: 'Αθήνα' },
    geometryType: 'POINT',
    wkt: null,
  }],
  Q43332: [{
    ref: 'node/4753980853',
    kind: 'node',
    tags: { place: 'locality', name: 'Pompei Antica' },
    geometryType: 'POINT',
    wkt: null,
  }],
};

function runner() {
  const phases: string[] = [];
  let steps = 0;
  return {
    run: {
      sparql: async (query: string) => door(query),
      phase: (message: string) => { phases.push(message); },
      step: async () => { steps += 1; },
    },
    phases,
    steps: () => steps,
  };
}

/** What the pool asked OSM, question by question. */
interface OsmCall { qids: string[]; keep: KeepWkt }

const osmReader = (seen: OsmCall[], mapped: Record<string, OsmObject[]> = OSM) =>
  async (qids: string[], keep: KeepWkt) => {
    seen.push({ qids: [...qids], keep });
    return new Map(qids.map((qid) => [qid, mapped[qid] ?? []]));
  };

describe('collectSitesByFame', () => {
  it('admits the dig, refuses the city, and says which object decided each', async () => {
    const { run } = runner();
    const answer = await collectSitesByFame(run, TREES, new Set<string>(), LINE, osmReader([]));

    expect([...answer.sites.keys()].sort()).toEqual(['Q22647', 'Q43332']);
    const troy = answer.sites.get('Q22647')!;
    expect(troy.entity.label).toBe('Troy');
    expect(troy.classes.sort()).toEqual(['Q133442', 'Q148837', 'Q1708422', 'Q65064889']);
    expect(troy.osm.verdict).toBe('ruin');
    expect(troy.osm.object).toBe('way/423938794');
    expect(troy.osm.tag).toBe('historic=archaeological_site');
    expect(troy.osm.extentFrom).toBe('way/423938794');
    expect(troy.extentWkt).toMatch(/^POLYGON/);
    expect(Number.isFinite(Date.parse(troy.osm.readAt))).toBe(true);

    // A node tagged `place=locality` is not a town and not a ruin: Pompeii is
    // admitted on its own class, with nothing to draw.
    const pompeii = answer.sites.get('Q43332')!;
    expect(pompeii.osm.verdict).toBe('none');
    expect(pompeii.osm.extentFrom).toBeNull();
    expect(pompeii.extentWkt).toBeNull();

    expect(answer.filtered).toHaveLength(1);
    expect(answer.filtered[0]).toMatchObject({ externalId: 'Q1524', name: 'Athens' });
    expect(answer.filtered[0].reason).toContain('place=city on node/441183');
  });

  it('reads OpenStreetMap once, after the pool is known, about every candidate', async () => {
    const { run } = runner();
    const asked: OsmCall[] = [];
    await collectSitesByFame(run, TREES, new Set<string>(), LINE, osmReader(asked));
    expect(asked).toHaveLength(1);
    expect([...asked[0].qids].sort()).toEqual(['Q1524', 'Q22647', 'Q43332']);
  });

  it('asks the reader for this kind\'s geometries and no others', async () => {
    const { run } = runner();
    const asked: OsmCall[] = [];
    await collectSitesByFame(run, TREES, new Set<string>(), LINE, osmReader(asked));
    // Without it the reader would fetch the administrative outline of every
    // city in the pool — megabytes of geometry this kind never draws.
    expect(asked[0].keep).toBe(OSM_KEEP_WKT);
  });

  it('reads the settlement branch off the item\'s own classes', async () => {
    const { run } = runner();
    // The same Athens, with nothing mapped under its item. Nothing says ruin
    // and nothing says town, so the branch is the whole of the answer: on the
    // settlement branch with no site class of its own, it is a city. Judged
    // with a defaulted `settlementBranch: false` it would be admitted.
    const answer = await collectSitesByFame(
      run, TREES, new Set<string>(), LINE, osmReader([], { ...OSM, Q1524: [] }),
    );
    expect(answer.sites.has('Q1524')).toBe(false);
    const athens = answer.filtered.find((row) => row.externalId === 'Q1524')!;
    expect(athens.reason).toContain('no ruin on the map');
    expect(athens.reason).toContain('no OSM object carries this item');
  });

  it('counts every entity it named as fetched, refused and admitted alike', async () => {
    const { run } = runner();
    const answer = await collectSitesByFame(run, TREES, new Set<string>(), LINE, osmReader([]));
    expect([...answer.fetched].sort()).toEqual(['Q1524', 'Q22647', 'Q43332']);
  });

  it('does not ask OpenStreetMap about a row the line has already put out', async () => {
    // The same three rows against a line only Athens clears: `siteVerdict`
    // answers `out` for a row below the line the source does not admit, whatever
    // the map says, so asking about Troy and Pompeii here would spend somebody
    // else's bandwidth on an answer nothing reads. 830 of the real pool's rows
    // sit below the line, and the register record's promise is that this
    // connector is not a heavy user.
    const { run } = runner();
    const asked: OsmCall[] = [];
    await collectSitesByFame(
      run, TREES, new Set<string>(), { enterSitelinks: 200, staySitelinks: 150 }, osmReader(asked),
    );
    expect(asked).toHaveLength(1);
    expect(asked[0].qids).toEqual(['Q1524']);
  });

  it('still asks about an admitted row that has slipped, since its refusal is named', async () => {
    // Hysteresis keeps Troy in at 121 against a stay line of 100, so the rule
    // runs on it and its answer is a sentence a curator reads — which needs the
    // map.
    const { run } = runner();
    const asked: OsmCall[] = [];
    await collectSitesByFame(
      run, TREES, new Set(['Q22647']), { enterSitelinks: 200, staySitelinks: 100 }, osmReader(asked),
    );
    expect([...asked[0].qids].sort()).toEqual(['Q1524', 'Q22647']);
  });

  it('fails the run when the mirror answers about almost nothing', async () => {
    // A mirror that answers HTTP 200 with no bindings — a renamed `osmkey:`
    // IRI, a rebuilt dataset, the host moving again — says "no OSM object
    // carries this item" about every candidate at once, which refuses the
    // settlement branch the rule exists to admit and lets the sweep withdraw
    // them. 885 of the 1,126 measured candidates carry an object; the floor is
    // half of that share.
    const { run } = runner();
    const empty = async (qids: string[]) => new Map(qids.map((qid) => [qid, []]));
    await expect(collectSitesByFame(run, TREES, new Set<string>(), LINE, empty))
      .rejects.toThrow(OsmAnswerFloorError);
    await expect(collectSitesByFame(run, TREES, new Set<string>(), LINE, empty))
      .rejects.toThrow(/answered for 0 of 3 site candidates \(0%\), below the floor of 50%/);
  });

  it('reads an ordinary share of silence as silence', async () => {
    // Two of the three carry an object and one does not, which is the shape of
    // the real pool (79%): the floor is there for zero, not for a quiet month's
    // mapping, and Athens is refused on the branch rather than on the read.
    const { run } = runner();
    const answer = await collectSitesByFame(
      run, TREES, new Set<string>(), LINE, osmReader([], { ...OSM, Q1524: [] }),
    );
    expect(answer.sites.has('Q22647')).toBe(true);
    expect(answer.filtered.map((row) => row.externalId)).toContain('Q1524');
  });

  it('tags each refusal with the answer it came from, for the run to group by', async () => {
    const { run } = runner();
    const answer = await collectSitesByFame(run, TREES, new Set<string>(), LINE, osmReader([]));
    expect(answer.filtered.map((row) => [row.externalId, row.group])).toEqual([['Q1524', 'living']]);
  });

  it('asks after an admitted row the pool no longer names', async () => {
    const { run } = runner();
    const answer = await collectSitesByFame(
      run, TREES, new Set(['Q999999']), LINE, osmReader([]),
    );
    // Wikidata answers nothing about it, so nothing is admitted and nothing
    // crashes: a row asked for by id that has vanished is simply not in the pool.
    expect(answer.sites.has('Q999999')).toBe(false);
  });

  it('refuses by name an admitted row Wikidata no longer files under archaeological sites, and never asks the map about it', async () => {
    // The British Museum is what the source admits through its other door, and
    // the shape of any row Wikidata has retyped: no kill class, no OSM signal,
    // no settlement class. Judged, it would reach the final admit of step 4 on
    // its 109 sitelinks and be written as a site.
    const seen: OsmCall[] = [];
    const { run } = runner();
    const answer = await collectSitesByFame(run, TREES, new Set(['Q6373']), LINE, osmReader(seen));
    expect(answer.sites.has('Q6373')).toBe(false);
    expect(answer.filtered.find((row) => row.externalId === 'Q6373')).toEqual({
      externalId: 'Q6373',
      name: 'British Museum',
      reason: 'Wikidata no longer files it under archaeological sites',
      group: 'class-or-name',
    });
    expect(seen.flatMap((call) => call.qids)).not.toContain('Q6373');
  });

  it('fails the run when a facts batch answers nothing about any row the pool named by its class', async () => {
    // Every row a class question named carries a `P31` under the tree, so a
    // batch with no class on any of them is a batch that failed quietly — and
    // read as "no facts", Athens would leave the settlement branch and be
    // admitted.
    const { run } = runner();
    const silent = {
      ...run,
      sparql: async (query: string) => (query.includes('?whc') ? [] : door(query)),
    };
    await expect(collectSitesByFame(silent, TREES, new Set<string>(), LINE, osmReader([])))
      .rejects.toThrow(/answered nothing about any of the 3 rows/);
  });

  it('refuses by name one row whose facts come back empty, and lets the run go on', async () => {
    // The pool is cached for a day and the facts for twelve hours: an item
    // merged into another, deleted or with its one site statement deprecated
    // in between answers with no class at all. One such row is not a failed
    // batch; it is Wikidata no longer filing it as a site, and it says so.
    const seen: OsmCall[] = [];
    const { run } = runner();
    const merged = {
      ...run,
      sparql: async (query: string) => door(query)
        .filter((row) => !(query.includes('?whc') && row.e?.value.endsWith('/Q22647'))),
    };
    const answer = await collectSitesByFame(merged, TREES, new Set<string>(), LINE, osmReader(seen));
    expect(answer.sites.has('Q43332')).toBe(true);
    expect(answer.filtered.find((row) => row.externalId === 'Q22647')).toEqual({
      externalId: 'Q22647',
      name: 'Troy',
      reason: 'Wikidata no longer files it under archaeological sites',
      group: 'class-or-name',
    });
    expect(seen.flatMap((call) => call.qids)).not.toContain('Q22647');
  });

  it('refuses by name the one silent row of a batch that holds only one, rather than failing', async () => {
    // A pool size ending in 1 leaves a tail batch of a single row, and silence
    // on one row is evidence of nothing: merged, deleted or deprecated, it is
    // Wikidata no longer filing it as a site, and the run goes on.
    const { run } = runner();
    const alone = {
      ...run,
      sparql: async (query: string) => door(query).filter((row) => (
        query.includes('?whc')
          ? !row.e?.value.endsWith('/Q1524')
          : Boolean(row.e?.value.endsWith('/Q1524'))
      )),
    };
    const answer = await collectSitesByFame(alone, TREES, new Set<string>(), LINE, osmReader([]));
    expect(answer.filtered.map((row) => [row.externalId, row.group]))
      .toEqual([['Q1524', 'class-or-name']]);
  });

  it('names no classless row the line had already put out', async () => {
    // With the line raised past Troy's 121 sitelinks, Troy is a row the source
    // never admitted and the line never let in: no rule ran on it, so its
    // silent facts are not a refusal a curator has to read (`sourceLine.ts`),
    // and the map is not asked about it either.
    const seen: OsmCall[] = [];
    const { run } = runner();
    const merged = {
      ...run,
      sparql: async (query: string) => door(query)
        .filter((row) => !(query.includes('?whc') && row.e?.value.endsWith('/Q22647'))),
    };
    const raised = { enterSitelinks: 130, staySitelinks: 125 };
    const answer = await collectSitesByFame(merged, TREES, new Set<string>(), raised, osmReader(seen));
    expect(answer.filtered.map((row) => row.externalId)).not.toContain('Q22647');
    expect(seen.flatMap((call) => call.qids)).not.toContain('Q22647');
  });
});
