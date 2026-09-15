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
import { collectSitesByFame, OsmAnswerFloorError, type SiteEntrance } from './sites.js';
import type { KeepWkt, OsmDigs, OsmObject } from '../osm/types.js';
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
const POOL: Record<string, { label: string; sitelinks: number; lat: number | null; lon: number | null; article?: string }> = {
  Q22647: { label: 'Troy', sitelinks: 121, lat: 39.9575, lon: 26.238889 },
  Q1524: { label: 'Athens', sitelinks: 288, lat: 37.984167, lon: 23.728056 },
  Q43332: { label: 'Pompeii', sitelinks: 122, lat: 40.750556, lon: 14.489722 },
  // Not a site at all: what the source admits through its other door
  // (`wbgetentities`, 2026-09-14: 109 sitelinks, `museum`, `art museum`).
  Q6373: { label: 'British Museum', sitelinks: 109, lat: 51.51944, lon: -0.12694 },
  // The second entrance's rows (#895, `wbgetentities` 2026-09-15): no class
  // under the tree on any of them. Gerasa is under it and below the floor.
  Q184427: { label: 'Ajanta Caves', sitelinks: 83, lat: 20.55342, lon: 75.70047 },
  Q207917: { label: 'Mount Nemrut', sitelinks: 61, lat: 37.98074, lon: 38.74083 },
  Q3543: { label: 'Potenza', sitelinks: 106, lat: 40.63333, lon: 15.8, article: 'https://en.wikipedia.org/wiki/Potenza' },
  Q31565: { label: 'Jerash', sitelinks: 54, lat: 32.27228, lon: 35.8914, article: 'https://en.wikipedia.org/wiki/Jerash' },
  Q56072866: { label: 'Gerasa', sitelinks: 12, lat: 32.2808, lon: 35.8993 },
  // A mapper's `wikidata` tag on a ruin that names a person: no coordinate,
  // no place (`wbgetentities` 2026-09-15, 159 sitelinks, class human).
  Q43347: { label: 'Rumi', sitelinks: 159, lat: null, lon: null },
};

/** Their `P31`s, in full: not one of Troy's says "dig", and none of Athens' does. */
const CLASSES: Record<string, string[]> = {
  Q22647: ['Q148837', 'Q133442', 'Q1708422', 'Q65064889'],
  Q1524: ['Q1549591', 'Q51929311', 'Q200250', 'Q5500203'],
  Q43332: ['Q839954', 'Q15661340'],
  Q6373: ['Q33506', 'Q207694'],
  Q184427: ['Q1131329', 'Q88778578', 'Q44539'],
  Q207917: ['Q8502'],
  Q3543: ['Q515', 'Q747074'],
  Q31565: ['Q515'],
  Q56072866: ['Q15661340', 'Q839954'],
  Q43347: ['Q5'],
};

/** `P757`: Troy is World Heritage 849 itself, Ajanta 242, Nemrut 448. */
const WORLD_HERITAGE = new Set(['Q22647', 'Q184427', 'Q207917']);

/** `P1082`: Athens counts 643,452 people and Pompeii counts 0 — both say so; so do Potenza and Jerash. */
const POPULATION = new Set(['Q1524', 'Q43332', 'Q3543', 'Q31565']);

function poolRow(qid: string): SparqlBinding {
  const row = POOL[qid];
  return {
    e: uri(qid),
    eLabel: { value: row.label },
    sl: { value: String(row.sitelinks) },
    ...(row.lat !== null && row.lon !== null ? { coord: { value: `Point(${row.lon} ${row.lat})` } } : {}),
    ...(row.article ? { article: { value: row.article } } : {}),
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

  // The sitelinks question of the second entrance: a count per item, nothing else.
  if (/SELECT \?e \?sl WHERE/.test(query)) {
    return [...query.matchAll(/wd:(Q\d+)/g)]
      .map((m) => m[1])
      .filter((qid) => qid in POOL)
      .map((qid) => ({ e: uri(qid), sl: { value: String(POOL[qid].sitelinks) } }));
  }

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

/** The second entrance with nothing on it: what the class-pool tests run against. */
const NO_ENTRANCE: SiteEntrance = {
  digs: async () => ({ byItem: new Map(), byArticle: new Map() }),
  resolveArticles: async () => new Map(),
  categories: async () => new Map(),
};

describe('collectSitesByFame', () => {
  it('admits the dig, refuses the city, and says which object decided each', async () => {
    const { run } = runner();
    const answer = await collectSitesByFame(run, TREES, new Set<string>(), LINE, osmReader([]), NO_ENTRANCE);

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
    await collectSitesByFame(run, TREES, new Set<string>(), LINE, osmReader(asked), NO_ENTRANCE);
    expect(asked).toHaveLength(1);
    expect([...asked[0].qids].sort()).toEqual(['Q1524', 'Q22647', 'Q43332']);
  });

  it('asks the reader for this kind\'s geometries and no others', async () => {
    const { run } = runner();
    const asked: OsmCall[] = [];
    await collectSitesByFame(run, TREES, new Set<string>(), LINE, osmReader(asked), NO_ENTRANCE);
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
      run, TREES, new Set<string>(), LINE, osmReader([], { ...OSM, Q1524: [] }), NO_ENTRANCE,
    );
    expect(answer.sites.has('Q1524')).toBe(false);
    const athens = answer.filtered.find((row) => row.externalId === 'Q1524')!;
    expect(athens.reason).toContain('no ruin on the map');
    expect(athens.reason).toContain('no OSM object carries this item');
  });

  it('gives a tree-named row no signal from an object that carried only an article', async () => {
    // Athens is in the pool by class and refused as a city on its own node.
    // Let one `historic=ruins` node in the Agora carry `wikipedia=en:Athens`
    // and no item: the enumeration names Athens by it, and merged into the
    // per-item read's answer it would be the first ruin tag `siteSignal`
    // finds and Athens would be written as a dig with no note. The map's
    // objects are a row's signal only where the map is what vouched for it.
    const { run } = runner();
    const digs: OsmDigs = {
      byItem: new Map(),
      byArticle: new Map([['en:Athens', [{
        ref: 'node/9', kind: 'node', tags: { historic: 'ruins', name: 'Stoa of Attalos' }, geometryType: null, wkt: null,
      }]]]),
    };
    const answer = await collectSitesByFame(run, TREES, new Set<string>(), LINE, osmReader([]), {
      ...NO_ENTRANCE, digs: async () => digs, resolveArticles: async () => new Map([['en:Athens', 'Q1524']]),
    });
    expect(answer.sites.has('Q1524')).toBe(false);
    const athens = answer.filtered.find((row) => row.externalId === 'Q1524')!;
    expect(athens.reason).toContain('a living place');
  });

  it('judges a pool row whose classes vanished on the object that carried only an article', async () => {
    // The same Agora node, and Athens with its site class gone: nothing lets a
    // ruin tag short-circuit any more, so the map's word is read through the
    // vetoes — and the row is refused by name as a living place, not dropped
    // in silence because the per-item read never saw the node.
    const { run } = runner();
    const gone = {
      ...run,
      sparql: async (query: string) => door(query)
        .filter((row) => !(query.includes('?whc') && row.e?.value.endsWith('/Q1524') && row.cls)),
    };
    const digs: OsmDigs = {
      byItem: new Map(),
      byArticle: new Map([['en:Athens', [{
        ref: 'node/9', kind: 'node', tags: { historic: 'ruins', name: 'Stoa of Attalos' }, geometryType: null, wkt: null,
      }]]]),
    };
    const answer = await collectSitesByFame(gone, TREES, new Set<string>(), LINE, osmReader([]), {
      ...NO_ENTRANCE, digs: async () => digs, resolveArticles: async () => new Map([['en:Athens', 'Q1524']]),
    });
    expect(answer.sites.has('Q1524')).toBe(false);
    const athens = answer.filtered.find((row) => row.externalId === 'Q1524');
    expect(athens?.reason).toContain('only OpenStreetMap maps ruins here (historic=ruins on node/9)');
  });

  it('counts every entity it named as fetched, refused and admitted alike', async () => {
    const { run } = runner();
    const answer = await collectSitesByFame(run, TREES, new Set<string>(), LINE, osmReader([]), NO_ENTRANCE);
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
      run, TREES, new Set<string>(), { enterSitelinks: 200, staySitelinks: 150 }, osmReader(asked), NO_ENTRANCE,
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
      run, TREES, new Set(['Q22647']), { enterSitelinks: 200, staySitelinks: 100 }, osmReader(asked), NO_ENTRANCE,
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
    await expect(collectSitesByFame(run, TREES, new Set<string>(), LINE, empty, NO_ENTRANCE))
      .rejects.toThrow(OsmAnswerFloorError);
    await expect(collectSitesByFame(run, TREES, new Set<string>(), LINE, empty, NO_ENTRANCE))
      .rejects.toThrow(
        /answered for 0 of 3 site candidates it can answer about \(0%\), below the floor of 50%/,
      );
  });

  it('reads an ordinary share of silence as silence', async () => {
    // Two of the three carry an object and one does not, which is the shape of
    // the real pool (79%): the floor is there for zero, not for a quiet month's
    // mapping, and Athens is refused on the branch rather than on the read.
    const { run } = runner();
    const answer = await collectSitesByFame(
      run, TREES, new Set<string>(), LINE, osmReader([], { ...OSM, Q1524: [] }), NO_ENTRANCE,
    );
    expect(answer.sites.has('Q22647')).toBe(true);
    expect(answer.filtered.map((row) => row.externalId)).toContain('Q1524');
  });

  it('tags each refusal with the answer it came from, for the run to group by', async () => {
    const { run } = runner();
    const answer = await collectSitesByFame(run, TREES, new Set<string>(), LINE, osmReader([]), NO_ENTRANCE);
    expect(answer.filtered.map((row) => [row.externalId, row.group])).toEqual([['Q1524', 'living']]);
  });

  it('asks after an admitted row the pool no longer names', async () => {
    const { run } = runner();
    const answer = await collectSitesByFame(
      run, TREES, new Set(['Q999999']), LINE, osmReader([]), NO_ENTRANCE,
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
    const answer = await collectSitesByFame(run, TREES, new Set(['Q6373']), LINE, osmReader(seen), NO_ENTRANCE);
    expect(answer.sites.has('Q6373')).toBe(false);
    expect(answer.filtered.find((row) => row.externalId === 'Q6373')).toEqual({
      externalId: 'Q6373',
      name: 'British Museum',
      reason: 'no class under archaeological sites on Wikidata, and no OpenStreetMap object tagged as a dig carries it',
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
    await expect(collectSitesByFame(silent, TREES, new Set<string>(), LINE, osmReader([]), NO_ENTRANCE))
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
    const answer = await collectSitesByFame(merged, TREES, new Set<string>(), LINE, osmReader(seen), NO_ENTRANCE);
    expect(answer.sites.has('Q43332')).toBe(true);
    expect(answer.filtered.find((row) => row.externalId === 'Q22647')).toEqual({
      externalId: 'Q22647',
      name: 'Troy',
      reason: 'no class under archaeological sites on Wikidata, and no OpenStreetMap object tagged as a dig carries it',
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
    const answer = await collectSitesByFame(alone, TREES, new Set<string>(), LINE, osmReader([]), NO_ENTRANCE);
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
    const answer = await collectSitesByFame(merged, TREES, new Set<string>(), raised, osmReader(seen), NO_ENTRANCE);
    expect(answer.filtered.map((row) => row.externalId)).not.toContain('Q22647');
    expect(seen.flatMap((call) => call.qids)).not.toContain('Q22647');
  });
});

/**
 * The second entrance (#895): what OpenStreetMap tags as a dig or as ruins,
 * resolved, counted, and judged by the one rule. Rows and objects are real
 * (2026-09-15, `data/cache/895-site-doors/`).
 */
describe('the OpenStreetMap entrance', () => {
  const obj = (ref: string, tags: Record<string, string>): OsmObject => ({
    ref, kind: ref.split('/')[0] as OsmObject['kind'], tags, geometryType: null, wkt: null,
  });
  /** What the enumeration answered: three items, one article, and Troy again. */
  const DIGS: OsmDigs = {
    byItem: new Map([
      ['Q184427', [obj('way/115567314', { historic: 'archaeological_site', name: 'Ajanta Caves' })]],
      ['Q3543', [obj('node/1687849903', { historic: 'archaeological_site', name: 'Potentia' })]],
      ['Q56072866', [obj('way/28969503', { historic: 'archaeological_site', archaeological_site: 'city' })]],
      ['Q22647', [obj('way/423938794', { historic: 'archaeological_site' })]],
      ['Q43347', [obj('node/9', { historic: 'ruins', name: 'Mevlana' })]],
    ]),
    byArticle: new Map([
      ['tr:Nemrut Dağı', [obj('way/1069114387', { historic: 'archaeological_site', name: 'Nemrut Dağı Tümülüsü' })]],
      ['de:Nirgendwo', [obj('node/1', { historic: 'ruins' })]],
    ]),
  };
  /** What the map carries under the items themselves: Nemrut's peak and its heritage zone, Potenza's town. */
  const MAPPED: Record<string, OsmObject[]> = {
    ...OSM,
    Q184427: [],
    Q207917: [
      obj('node/75969654', { name: 'Nemrut Dağı' }),
      { ...obj('way/974945296', { heritage: '1', boundary: 'protected_area' }), geometryType: 'POLYGON', wkt: 'POLYGON((38.7 37.9,38.8 37.9,38.8 38.0,38.7 37.9))' },
    ],
    Q3543: [obj('node/1687849903', { place: 'city', name: 'Potenza' })],
    Q31565: [obj('node/250367730', { place: 'city', name: 'Jerash' })],
  };
  function entrance(over: Partial<SiteEntrance> = {}) {
    const asked: string[][] = [];
    const doors: SiteEntrance = {
      digs: async () => DIGS,
      resolveArticles: async (tags) => {
        asked.push([...tags]);
        return new Map([['tr:Nemrut Dağı', 'Q207917']]);
      },
      categories: async (titles) => new Map(titles.map((title) => [title, [`Comuni of ${title}`]])),
      ...over,
    };
    return { doors, articlesAsked: asked };
  }

  it('admits what the map names and the classes do not contradict, and says so on each card', async () => {
    const { run, phases } = runner();
    const seen: OsmCall[] = [];
    const { doors, articlesAsked } = entrance();
    const answer = await collectSitesByFame(run, TREES, new Set<string>(), LINE, osmReader(seen, MAPPED), doors);

    // Ajanta on the enumeration's object alone: the per-item read carried nothing.
    const ajanta = answer.sites.get('Q184427')!;
    expect(ajanta.osm.object).toBe('way/115567314');
    expect(ajanta.note).toBe(
      'no class of a site on Wikidata; OpenStreetMap maps an archaeological site here '
      + '(historic=archaeological_site on way/115567314)',
    );
    // Nemrut through the article the tumulus carried, merged with the item's own objects.
    expect(articlesAsked).toEqual([['tr:Nemrut Dağı', 'de:Nirgendwo']]);
    const nemrut = answer.sites.get('Q207917')!;
    expect(nemrut.osm.object).toBe('way/1069114387');
    // The extent is the heritage zone the item carries, as at Nazca; the
    // tumulus way that named it came without a geometry.
    expect(nemrut.osm.extentFrom).toBe('way/974945296');
    // Potenza: the town the mapper linked, refused by name.
    expect(answer.filtered.find((row) => row.externalId === 'Q3543')).toMatchObject({ name: 'Potenza', group: 'living' });
    // Troy came in by class and is not a second row.
    expect(answer.sites.get('Q22647')?.note).toBeUndefined();
    // Rumi: the map's tag names a person with no coordinate. Nothing claimed
    // a place, so nothing is refused — silence, not a card (dry run 136
    // named 43 such rows, "tumulus" and "Nikola Tesla" among them).
    expect(answer.sites.has('Q43347')).toBe(false);
    expect(answer.filtered.map((row) => row.externalId)).not.toContain('Q43347');
    expect(phases).toContain('Asking Wikidata how many articles each dig OpenStreetMap maps has (batch 1/1)...');
  });

  it('counts the sitelinks of every item only the map named, and asks the pool about those at the floor', async () => {
    const { run } = runner();
    const sent: string[] = [];
    const counting = { ...run, sparql: async (query: string) => { sent.push(query); return door(query); } };
    const answer = await collectSitesByFame(counting, TREES, new Set<string>(), LINE, osmReader([], MAPPED), entrance().doors);

    const sitelinks = sent.filter((q) => /SELECT \?e \?sl WHERE/.test(q));
    expect(sitelinks).toHaveLength(1);
    expect([...sitelinks[0].matchAll(/wd:(Q\d+)/g)].map((m) => m[1]).sort())
      .toEqual(['Q184427', 'Q207917', 'Q3543', 'Q43347', 'Q56072866']);
    // Gerasa at 12 sitelinks is below the pool's floor: never asked about, never fetched.
    const byId = sent.filter((q) => /VALUES \?e \{/.test(q) && !/\?sl WHERE/.test(q) && !q.includes('?whc'));
    expect(byId.flatMap((q) => [...q.matchAll(/wd:(Q\d+)/g)].map((m) => m[1])).sort())
      .toEqual(['Q184427', 'Q207917', 'Q3543', 'Q43347']);
    expect(answer.fetched.has('Q56072866')).toBe(false);
    expect(answer.fetched.has('Q184427')).toBe(true);
  });

  it('gives a living place the map named English Wikipedia\'s second vote', async () => {
    const { run } = runner();
    const titlesAsked: string[][] = [];
    const digs: OsmDigs = {
      byItem: new Map([['Q31565', [obj('way/28969503', { historic: 'archaeological_site', archaeological_site: 'city' })]]]),
      byArticle: new Map(),
    };
    const { doors } = entrance({
      digs: async () => digs,
      categories: async (titles) => {
        titlesAsked.push([...titles]);
        return new Map([['Jerash', ['Archaeological sites in Jordan', 'Roman towns and cities in Jordan']]]);
      },
    });
    const answer = await collectSitesByFame(run, TREES, new Set<string>(), LINE, osmReader([], MAPPED), doors);
    expect(titlesAsked).toEqual([['Jerash']]);
    expect(answer.sites.get('Q31565')?.note).toContain('English Wikipedia files it under its archaeological sites');
  });
});

describe('the OpenStreetMap entrance, on the rows the class pool named', () => {
  const obj = (ref: string, tags: Record<string, string>): OsmObject => ({
    ref, kind: ref.split('/')[0] as OsmObject['kind'], tags, geometryType: null, wkt: null,
  });
  const troyDig: OsmDigs = {
    byItem: new Map([['Q22647', [obj('way/423938794', { historic: 'archaeological_site' })]]]),
    byArticle: new Map(),
  };
  const naming: SiteEntrance = { ...NO_ENTRANCE, digs: async () => troyDig };

  it('judges a pool row whose classes vanished by the map\'s word, rather than refusing it as retyped', async () => {
    // Troy named by a class question, its facts back with no class at all —
    // merged, or its one statement deprecated — and OpenStreetMap still tags
    // its excavation. The map names it, so the second entrance judges it;
    // "no OSM object tagged as a dig carries it" would be false.
    const { run } = runner();
    const merged = {
      ...run,
      sparql: async (query: string) => door(query)
        .filter((row) => !(query.includes('?whc') && row.e?.value.endsWith('/Q22647'))),
    };
    const answer = await collectSitesByFame(merged, TREES, new Set<string>(), LINE, osmReader([]), naming);
    expect(answer.filtered.map((row) => row.externalId)).not.toContain('Q22647');
    expect(answer.sites.get('Q22647')?.note).toContain('OpenStreetMap maps an archaeological site here');
  });

  it('asks English Wikipedia\'s vote of a pool row the map names, when its classes vanished', async () => {
    // Athens with its classes gone and OSM tagging a dig under its item: a
    // living place the map names, whichever question named it first — the
    // vote is asked, and the row is admitted on it as a map-only row would be.
    // The Agora way carries the item, so the per-item read answers with it,
    // as the real read does; with the site class gone the enumeration's
    // objects are merged in as well, which the test on the article-carried
    // node pins. What this one pins is the vote.
    const { run } = runner();
    const titlesAsked: string[][] = [];
    const agora = obj('way/1', { historic: 'archaeological_site', name: 'Ancient Agora' });
    const digs: OsmDigs = { byItem: new Map([['Q1524', [agora]]]), byArticle: new Map() };
    const reader = osmReader([], { ...OSM, Q1524: [...OSM.Q1524, agora] });
    const withArticle = {
      ...run,
      sparql: async (query: string) => door(query)
        .filter((row) => !(query.includes('?whc') && row.e?.value.endsWith('/Q1524') && row.cls))
        .map((row) => (row.eLabel && row.e?.value.endsWith('/Q1524')
          ? { ...row, article: { value: 'https://en.wikipedia.org/wiki/Athens' } } : row)),
    };
    const answer = await collectSitesByFame(withArticle, TREES, new Set<string>(), LINE, reader, {
      ...NO_ENTRANCE,
      digs: async () => digs,
      categories: async (titles) => {
        titlesAsked.push([...titles]);
        return new Map([['Athens', ['Archaeological sites in Attica']]]);
      },
    });
    expect(titlesAsked).toEqual([['Athens']]);
    expect(answer.sites.get('Q1524')?.note).toContain('English Wikipedia files it under its archaeological sites');
  });

  it('keeps a row reached through an article alone out of the floor, and in the pool', async () => {
    // The per-item read asks by the `wikidata` tag with no tag filter, and an
    // item the enumeration reached through an article only may or may not
    // carry the tag elsewhere — Nemrut's peak node carries the item while its
    // tumulus carries the article — so its silence is evidence neither way.
    // Nemrut here with no per-item object, beside Troy, Athens and Pompeii
    // answered by the per-item read: in the pool, and not on the floor's count.
    const { run } = runner();
    const digs: OsmDigs = {
      byItem: new Map(),
      byArticle: new Map([['tr:Nemrut Dağı', [obj('way/1069114387', { historic: 'archaeological_site' })]]]),
    };
    const reader = async (qids: string[]) => new Map(qids.map((qid) => [qid, OSM[qid] ?? []]));
    const answer = await collectSitesByFame(run, TREES, new Set<string>(), LINE, reader, {
      ...NO_ENTRANCE, digs: async () => digs, resolveArticles: async () => new Map([['tr:Nemrut Dağı', 'Q207917']]),
    });
    expect(answer.sites.has('Q207917')).toBe(true);
  });

  it('lets no article-reached row vouch for a silent per-item read', async () => {
    // Troy, Athens and Pompeii carry the tag and the read is silent about all
    // three; Nemrut, Ajanta and Jerash were reached through articles alone.
    // Counted as answered, the three would hold the share at half and the
    // silence would pass; they are counted on neither side, and it fails.
    const { run } = runner();
    const silent = async (qids: string[]) => new Map(qids.map((qid) => [qid, [] as OsmObject[]]));
    const digs: OsmDigs = {
      byItem: new Map(),
      byArticle: new Map([
        ['tr:Nemrut Dağı', [obj('way/1069114387', { historic: 'archaeological_site' })]],
        ['en:Ajanta Caves', [obj('way/115567314', { historic: 'archaeological_site' })]],
        ['en:Jerash', [obj('way/28969503', { historic: 'archaeological_site' })]],
      ]),
    };
    const resolveArticles = async () => new Map([
      ['tr:Nemrut Dağı', 'Q207917'], ['en:Ajanta Caves', 'Q184427'], ['en:Jerash', 'Q31565'],
    ]);
    await expect(collectSitesByFame(run, TREES, new Set<string>(), LINE, silent, { ...NO_ENTRANCE, digs: async () => digs, resolveArticles }))
      .rejects.toThrow(OsmAnswerFloorError);
  });

  it('still fails the run when the per-item read is silent about rows that carry the tag', async () => {
    // An item under `byItem` carries a `wikidata` tag by construction, so
    // the per-item read should answer about it; its silence is what the
    // floor exists to catch, and the enumeration's own objects must not mask it.
    const { run } = runner();
    const silent = async (qids: string[]) => new Map(qids.map((qid) => [qid, [] as OsmObject[]]));
    const digs: OsmDigs = {
      byItem: new Map([
        ['Q22647', [obj('way/423938794', { historic: 'archaeological_site' })]],
        ['Q43332', [obj('node/4753980853', { historic: 'archaeological_site' })]],
      ]),
      byArticle: new Map(),
    };
    await expect(collectSitesByFame(run, TREES, new Set<string>(), LINE, silent, { ...NO_ENTRANCE, digs: async () => digs }))
      .rejects.toThrow(OsmAnswerFloorError);
  });

  it('fails the run when a facts batch answers nothing about the rows the map named', async () => {
    // The entrance's rows land in batches of their own, and a batch of them
    // that comes back empty is a batch that failed quietly: with no classes,
    // no listing and no population, not one veto can fire and a comune or a
    // business walks in with the map's note on it.
    const { run } = runner();
    const digs: OsmDigs = {
      byItem: new Map([
        ['Q184427', [obj('way/115567314', { historic: 'archaeological_site' })]],
        ['Q3543', [obj('node/1687849903', { historic: 'archaeological_site' })]],
      ]),
      byArticle: new Map(),
    };
    // A pool of the entrance's rows alone — the class questions answer
    // nothing this time — whose facts batch comes back empty.
    const silentAboutThem = {
      ...run,
      sparql: async (query: string) => door(query)
        .filter((row) => !/\/(Q22647|Q1524|Q43332)$/.test(row.e?.value ?? ''))
        .filter((row) => !(query.includes('?whc') && /\/(Q184427|Q3543)$/.test(row.e?.value ?? ''))),
    };
    await expect(collectSitesByFame(silentAboutThem, TREES, new Set<string>(), LINE, osmReader([]), { ...NO_ENTRANCE, digs: async () => digs }))
      .rejects.toThrow(/answered nothing about any of the/);
  });
});
