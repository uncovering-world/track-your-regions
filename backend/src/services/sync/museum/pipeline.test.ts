/**
 * Tests for the works-first museum pipeline.
 *
 * The fixture is a small world of works and venues, served by a stub that answers on the shape
 * of the query rather than on the order the calls arrive in: the class closure walks three roots
 * and so sends at least three queries before the pool is touched, which a positional stub cannot
 * survive.
 *
 * Two of the cases exist because the composition — not any single module — is where the rule can
 * go wrong, and neither module's own tests can see it: a work belongs to the *branch* two levels
 * below the institution that owns it, and a fold map chains.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { collectTier1Museums } from './pipeline.js';
import { fetchBroadPool, fetchClassPool, POOL_BANDS, type SparqlFn } from './queries.js';
import type { SparqlBinding } from '../wikidataUtils.js';

const POOL_BAND_COUNT = POOL_BANDS.length;

const ENTITY = 'http://www.wikidata.org/entity/';
const RANK = 'http://wikiba.se/ontology#';

/** Art museum — the only class this fixture treats as a museum. */
const ART_MUSEUM = 'Q207694';
const MUSEUM_CLASSES = new Set([ART_MUSEUM]);

interface FixtureEntity {
  label: string;
  classes: string[];
  lat: number | null;
  lon: number | null;
  parents: string[];
  dissolved?: string;
}

interface FixtureWork {
  label: string;
  sitelinks: number;
  /** The narrow class it answers a `VALUES ?cls` batch under, with the label that batch returns. */
  cls: string;
  clsLabel: string;
  /** The broad root whose fame bands it answers under. Those rows bind no class label. */
  broadRoot?: string;
  artist?: string;
  year?: number;
  statements: { property: 'P195' | 'P276'; venue: string; rank?: 'preferred' | 'normal' }[];
}

const PAINTING = 'Q3305213';
/** A pinned edition class: a work printed from one block exists in many true impressions. */
const WOODBLOCK_PRINT = 'Q28913685';
const FRESCO = 'Q1476300';
/** A real class whose label is 68 characters — longer than `treasures.treasure_type`. */
const LONG_CLASS = 'Q574422';
const LONG_LABEL = 'Anthropomorphic wooden cult figurines of Central and Northern Europe';
/** One of the 46 artwork classes with no label in the fallback chain: the service answers a QID. */
const UNLABELLED_CLASS = 'Q900999';

const ENTITIES: Record<string, FixtureEntity> = {
  // The Louvre and the two entities the Mona Lisa actually names: a curatorial department
  // (killed by class) and the room it hangs in (no museum class), both parts of the museum.
  Q19675: { label: 'Louvre Museum', classes: [ART_MUSEUM], lat: 48.8611, lon: 2.3358, parents: [] },
  Q3044768: {
    label: 'Department of Paintings of the Louvre',
    classes: ['Q7328910', 'Q11681271'], lat: 48.86, lon: 2.335, parents: ['Q19675'],
  },
  Q10292830: {
    label: 'Salle des États', classes: ['Q180516'], lat: 48.8601, lon: 2.3352, parents: ['Q19675'],
  },
  // Three art museums, each holding one impression of the same print.
  Q900401: { label: 'Print Museum A', classes: [ART_MUSEUM], lat: 35.7, lon: 139.7, parents: [] },
  Q900402: { label: 'Print Museum B', classes: [ART_MUSEUM], lat: 21.3, lon: -157.8, parents: [] },
  Q900403: { label: 'Print Museum C', classes: [ART_MUSEUM], lat: 48.2, lon: 16.3, parents: [] },
  // A church: a place a work hangs that no walk can turn into a museum.
  Q1876: { label: 'Santa Maria delle Grazie', classes: ['Q16970'], lat: 45.4659, lon: 9.1709, parents: [] },

  // A branch inside a wing inside an institution. The wing is not a venue and carries no
  // coordinates, which is what makes the ancestor walk have to be transitive.
  Q900001: { label: 'Branch Gallery', classes: [ART_MUSEUM], lat: 51.5, lon: -0.1, parents: ['Q900002'] },
  Q900002: { label: 'East Wing', classes: [], lat: null, lon: null, parents: ['Q900003'] },
  Q900003: { label: 'Grand Institution', classes: [ART_MUSEUM], lat: 51.54, lon: -0.1, parents: [] },

  // A venue whose only work sits in the hysteresis band: iconic enough to keep a badge it
  // already has, never enough to admit a museum.
  Q900311: { label: 'Almost Gallery', classes: [ART_MUSEUM], lat: 10.0, lon: 20.0, parents: [] },
  // Three unrelated venues, far apart, that one work claims at once.
  Q900301: { label: 'First Claimant', classes: [ART_MUSEUM], lat: 40.0, lon: -3.0, parents: [] },
  Q900302: { label: 'Second Claimant', classes: [ART_MUSEUM], lat: 41.0, lon: -4.0, parents: [] },
  Q900303: { label: 'Third Claimant', classes: [ART_MUSEUM], lat: 42.0, lon: -5.0, parents: [] },

  // A room inside a gallery inside a palace, each 55 m from the next: two folds that chain.
  Q900011: { label: 'Palazzo', classes: [ART_MUSEUM], lat: 45.0, lon: 9.0, parents: [] },
  Q900012: { label: 'Galleria', classes: [ART_MUSEUM], lat: 45.0005, lon: 9.0, parents: ['Q900011'] },
  Q900013: { label: 'Sala', classes: [ART_MUSEUM], lat: 45.001, lon: 9.0, parents: ['Q900012'] },
};

const WORKS: Record<string, FixtureWork> = {
  Q12418: {
    label: 'Mona Lisa', sitelinks: 146, cls: PAINTING, clsLabel: 'painting',
    broadRoot: PAINTING, artist: 'Leonardo da Vinci', year: 1503,
    statements: [
      { property: 'P195', venue: 'Q3044768' },
      { property: 'P276', venue: 'Q10292830', rank: 'preferred' },
      { property: 'P276', venue: 'Q19675' },
    ],
  },
  // The work the hand-picked type list lost: a fresco, in a church, owned by nobody.
  Q207947: {
    label: 'The Last Supper', sitelinks: 88, cls: FRESCO, clsLabel: 'fresco',
    statements: [{ property: 'P276', venue: 'Q1876' }],
  },
  Q900101: {
    label: 'Work of the Branch', sitelinks: 40, cls: PAINTING, clsLabel: 'painting',
    broadRoot: PAINTING,
    statements: [
      { property: 'P195', venue: 'Q900003' },
      { property: 'P276', venue: 'Q900001' },
    ],
  },
  Q900201: {
    label: 'Work in the Sala', sitelinks: 30, cls: PAINTING, clsLabel: 'painting',
    broadRoot: PAINTING, statements: [{ property: 'P276', venue: 'Q900013' }],
  },
  Q900202: {
    label: 'Work in the Galleria', sitelinks: 28, cls: PAINTING, clsLabel: 'painting',
    broadRoot: PAINTING, statements: [{ property: 'P276', venue: 'Q900012' }],
  },
  // Fetched twice: as a painting by a fame band, which names no class, and as a fresco by its
  // narrow class. The narrower name is the one a reader wants on the treasure.
  Q900203: {
    label: 'Fresco in the Palazzo', sitelinks: 26, cls: FRESCO, clsLabel: 'fresco',
    broadRoot: PAINTING, statements: [{ property: 'P276', venue: 'Q900011' }],
  },
  Q900204: {
    label: 'Cult Figurine in the Palazzo', sitelinks: 24, cls: LONG_CLASS, clsLabel: LONG_LABEL,
    statements: [{ property: 'P276', venue: 'Q900011' }],
  },
  // An edition: three museums each hold a true impression. Under the blanket cap this admitted
  // nobody, which is what removed printmaking from the catalogue as a class.
  Q900250: {
    label: 'The Great Print', sitelinks: 63, cls: WOODBLOCK_PRINT, clsLabel: 'woodblock print',
    statements: [
      { property: 'P195', venue: 'Q900401' },
      { property: 'P195', venue: 'Q900402' },
      { property: 'P195', venue: 'Q900403' },
    ],
  },
  Q900205: {
    label: 'Unlabelled Class in the Palazzo', sitelinks: 23, cls: UNLABELLED_CLASS,
    clsLabel: UNLABELLED_CLASS, broadRoot: PAINTING,
    statements: [{ property: 'P276', venue: 'Q900011' }],
  },
  // 20 sitelinks: inside the hysteresis band, below the threshold that admits a museum.
  Q900402: {
    label: 'Work Below the Threshold', sitelinks: 20, cls: PAINTING, clsLabel: 'painting',
    broadRoot: PAINTING, statements: [{ property: 'P276', venue: 'Q900311' }],
  },
  // Held by three venues at once, each of which owns it outright: the Great Wave shape.
  Q900401: {
    label: 'Work Claimed Three Times', sitelinks: 35, cls: PAINTING, clsLabel: 'painting',
    broadRoot: PAINTING,
    statements: [
      { property: 'P195', venue: 'Q900301' },
      { property: 'P195', venue: 'Q900302' },
      { property: 'P195', venue: 'Q900303' },
    ],
  },
};

/** Direct `P279` children, so the closure finds `fresco` under `painting` and stops. */
const SUBCLASSES: Record<string, string[]> = {
  [PAINTING]: [FRESCO, LONG_CLASS, UNLABELLED_CLASS],
};

function uri(qid: string) {
  return { value: `${ENTITY}${qid}` };
}

function askedFor(query: string): string[] {
  return [...query.matchAll(/wd:(Q\d+)/g)].map((m) => m[1]);
}

function poolRow(qid: string, work: FixtureWork, clsLabel?: string): SparqlBinding {
  const row: SparqlBinding = {
    w: uri(qid),
    wLabel: { value: work.label },
    sl: { value: String(work.sitelinks) },
  };
  // The class comes back as an entity URI beside its label, because the medium test is asked
  // of the tree and a label cannot be asked that. A batch answers with the class it matched;
  // an anchored query names its root literally and binds nothing.
  if (clsLabel) {
    row.clsLabel = { value: clsLabel };
    row.cls = uri(work.cls);
  }
  if (work.artist) row.creatorLabel = { value: work.artist };
  if (work.year) row.year = { value: String(work.year) };
  return row;
}

function statementRows(qids: string[]): SparqlBinding[] {
  const rows: SparqlBinding[] = [];
  for (const qid of qids) {
    for (const s of WORKS[qid]?.statements ?? []) {
      rows.push({
        w: uri(qid),
        rel: { value: s.property },
        venue: uri(s.venue),
        rank: { value: `${RANK}${s.rank === 'preferred' ? 'Preferred' : 'Normal'}Rank` },
      });
    }
  }
  return rows;
}

function detailRows(qids: string[]): SparqlBinding[] {
  return qids.filter((q) => ENTITIES[q]).map((qid) => {
    const e = ENTITIES[qid];
    const row: SparqlBinding = { e: uri(qid), eLabel: { value: e.label }, sl: { value: '10' } };
    if (e.lat !== null && e.lon !== null) row.coord = { value: `Point(${e.lon} ${e.lat})` };
    if (e.dissolved) row.dissolved = { value: e.dissolved };
    return row;
  });
}

function edgeRows(qids: string[]): SparqlBinding[] {
  const rows: SparqlBinding[] = [];
  for (const qid of qids) {
    const e = ENTITIES[qid];
    if (!e) continue;
    for (const cls of e.classes) rows.push({ e: uri(qid), cls: uri(cls) });
    for (const parent of e.parents) rows.push({ e: uri(qid), parent: uri(parent) });
  }
  return rows;
}

/**
 * The fame band a pool query is asking about.
 *
 * Read from the query rather than counted off against a call index, for the reason the whole
 * stub is shaped this way: a band that answered with works outside it would hide the one thing
 * the bands have to get right, which is tiling the range without a gap or an overlap.
 */
function bandOf(query: string): { min: number; max: number | null } {
  const bounded = /FILTER\(\?sl >= (\d+) && \?sl < (\d+)\)/.exec(query);
  if (bounded) return { min: Number(bounded[1]), max: Number(bounded[2]) };
  const open = /FILTER\(\?sl >= (\d+)\)/.exec(query);
  if (!open) throw new Error(`pool query with no band: ${query}`);
  return { min: Number(open[1]), max: null };
}

/** Answers on the shape of the query, so the pipeline is free to reorder its calls. */
function stubSparql() {
  return vi.fn(async (query: string): Promise<SparqlBinding[]> => {
    const qids = askedFor(query);
    if (query.includes('?c wdt:P279 ?p')) {
      return qids.flatMap((q) => SUBCLASSES[q] ?? []).map((c) => ({ c: uri(c) }));
    }
    if (query.includes('p:P195')) return statementRows(qids);
    if (query.includes('?e wdt:P31 ?cls')) return edgeRows(qids);
    if (query.includes('?e wdt:P625 ?coord')) return detailRows(qids);
    if (query.includes('VALUES ?cls')) {
      return Object.entries(WORKS)
        .filter(([, w]) => qids.includes(w.cls))
        .map(([qid, w]) => poolRow(qid, w, w.clsLabel));
    }
    if (query.includes('?w wdt:P31 wd:')) {
      const band = bandOf(query);
      return Object.entries(WORKS)
        .filter(([, w]) => w.broadRoot === qids[0]
          && w.sitelinks >= band.min && (band.max === null || w.sitelinks < band.max))
        .map(([qid, w]) => poolRow(qid, w));
    }
    throw new Error(`unexpected query: ${query}`);
  });
}

function run(previousPlacements: Record<string, string[]> = {}) {
  return collectTier1Museums({
    sparql: stubSparql(),
    previousPlacements,
    museumClasses: MUSEUM_CLASSES,
  });
}

describe('collectTier1Museums', () => {
  it('proposes a museum for the iconic work it holds, and names the reason', async () => {
    const out = await run();

    expect(out.items.map((i) => i.qid)).toContain('Q19675');
    const louvre = out.items.find((i) => i.qid === 'Q19675')!;
    expect(louvre.admittedFor).toEqual({ qid: 'Q12418', label: 'Mona Lisa' });
    expect(louvre.details?.museumLabel).toBe('Louvre Museum');
    expect(louvre.artworks.map((a) => a.externalId)).toEqual(['Q12418']);
    expect(louvre.artworks[0]).toMatchObject({
      name: 'Mona Lisa', treasureType: 'painting', artist: 'Leonardo da Vinci', year: 1503,
    });
    // The whole pool is fetched, including the works that place nowhere.
    expect(out.fetched).toBe(Object.keys(WORKS).length);
  });

  it('records why a venue an iconic work named was dropped', async () => {
    const out = await run();

    const church = out.filtered.find((f) => f.externalId === 'Q1876');
    expect(church).toBeDefined();
    expect(church!.name).toBe('Santa Maria delle Grazie');
    expect(church!.reason).toContain('not a museum class');
    expect(church!.reason).toContain('The Last Supper');
    // The department and the room both resolve to the Louvre, so neither is a loss.
    expect(out.filtered.map((f) => f.externalId)).not.toContain('Q3044768');
    expect(out.filtered.map((f) => f.externalId)).not.toContain('Q10292830');
  });

  it('places a work in the branch two levels below the institution that owns it', async () => {
    const out = await run();

    // P195 names the institution, P276 names the branch inside its wing. They corroborate each
    // other only if the ancestor walk is transitive; with direct parents the two statements
    // agree about nothing, the owner wins on the fallback path, and the work lands in the wrong
    // building — one level up, where placement's own tests cannot see it.
    const branch = out.items.find((i) => i.qid === 'Q900001');
    expect(branch?.artworks.map((a) => a.externalId)).toEqual(['Q900101']);
    expect(out.items.map((i) => i.qid)).not.toContain('Q900003');
  });

  it('follows a fold chain to the venue that survives it', async () => {
    const out = await run();

    // Sala folds into Galleria, which folds into Palazzo. A single lookup would leave the
    // Sala's work at the Galleria — a venue that is itself gone.
    const palazzo = out.items.find((i) => i.qid === 'Q900011');
    // The Sala's work and the Galleria's arrive alongside the Palazzo's own three.
    expect(palazzo?.artworks.map((a) => a.externalId).sort())
      .toEqual(['Q900201', 'Q900202', 'Q900203', 'Q900204', 'Q900205']);
    expect(out.items.map((i) => i.qid)).not.toContain('Q900012');
    expect(out.items.map((i) => i.qid)).not.toContain('Q900013');

    const folded = out.filtered.filter((f) => f.reason.includes('folded into'));
    expect(folded.map((f) => f.externalId).sort()).toEqual(['Q900012', 'Q900013']);
    expect(folded.find((f) => f.externalId === 'Q900013')!.reason).toContain('Galleria');
  });

  it('names the class a work was collected under as its treasure type', async () => {
    const out = await run();

    const palazzo = out.items.find((i) => i.qid === 'Q900011')!;
    const fresco = palazzo.artworks.find((a) => a.externalId === 'Q900203');
    expect(fresco?.treasureType).toBe('fresco');
  });

  it('keeps a treasure type inside the column that has to hold it', async () => {
    const out = await run();

    const palazzo = out.items.find((i) => i.qid === 'Q900011')!;
    const figurine = palazzo.artworks.find((a) => a.externalId === 'Q900204')!;
    expect(LONG_LABEL.length).toBeGreaterThan(50);
    expect(figurine.treasureType).toBe(LONG_LABEL.slice(0, 50));
    expect(figurine.treasureType.length).toBe(50);
  });

  it('does not show a reader a QID when the class has no label', async () => {
    const out = await run();

    const palazzo = out.items.find((i) => i.qid === 'Q900011')!;
    const unlabelled = palazzo.artworks.find((a) => a.externalId === 'Q900205');
    // The bare QID must neither reach the reader nor beat the broad root it was also fetched by.
    expect(unlabelled?.treasureType).toBe('painting');
  });

  it('admits every museum holding an impression of the same print', async () => {
    const out = await run();

    // Three holders of one edition, all admitted. The cap asks which of these is the one to
    // travel for, and an edition has no such answer — each impression is the thing itself.
    const holders = ['Q900401', 'Q900402', 'Q900403'];
    for (const qid of holders) {
      const museum = out.items.find((i) => i.qid === qid);
      expect(museum, `${qid} should be admitted`).toBeDefined();
      expect(museum!.admittedFor).toEqual({ qid: 'Q900250', label: 'The Great Print' });
    }
  });

  it('asks Wikidata for the four roots no closure reaches from a painting', async () => {
    const sparql = stubSparql();
    await collectTier1Museums({ sparql, previousPlacements: {}, museumClasses: MUSEUM_CLASSES });

    // Drawing, print, mosaic and tapestry are not kinds of painting, sculpture or statue, so
    // nothing under those three reaches them. They were measured in the dry run and lost on the
    // way into the pipeline, and the catalogue held zero prints until they came back.
    const asked = sparql.mock.calls.map((c) => String(c[0])).join('\n');
    for (const root of ['Q93184', 'Q11060274', 'Q133067', 'Q184296']) {
      expect(asked, `root ${root} was never fetched`).toContain(root);
    }
  });

  it('asks for the collection classes that are not kinds of work at all', async () => {
    const sparql = stubSparql();
    await collectTier1Museums({ sparql, previousPlacements: {}, museumClasses: MUSEUM_CLASSES });

    // A painting series and a group of casts hold works rather than being one, so they sit
    // outside every subclass tree — which is where Monet's Water Lilies, Van Gogh's Sunflowers
    // and Rodin's Thinker live.
    const asked = sparql.mock.calls.map((c) => String(c[0])).join('\n');
    expect(asked).toContain('Q15727816');
    expect(asked).toContain('Q28890616');
  });

  it('admits nobody for a work below the threshold, or for one held too widely', async () => {
    const out = await run();
    const admitted = out.items.map((i) => i.qid);

    // 20 sitelinks is above the release floor and below the join threshold: the venue holding
    // only that work is not a top art museum.
    expect(admitted).not.toContain('Q900311');
    // A work three venues own admits none of them.
    expect(admitted).not.toContain('Q900301');
    expect(admitted).not.toContain('Q900302');
    expect(admitted).not.toContain('Q900303');
  });

  it('reports what moved since the previous run, and what the pool no longer offers', async () => {
    const out = await run({
      Q12418: ['Q19675'],
      Q900101: ['Q900003'],
      Q555555: ['Q19675'],
    });

    expect(out.diff.moved).toEqual([{ work: 'Q900101', from: ['Q900003'], to: ['Q900001'] }]);
    expect(out.diff.dropped).toEqual(['Q555555']);
  });
});

describe('pool truncation', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  const rows = (n: number): SparqlBinding[] =>
    Array.from({ length: n }, (_, i) => ({
      w: uri(`Q${1000 + i}`), wLabel: { value: `Work ${i}` }, sl: { value: '30' },
    }));

  /** A runner that counts its steps, which is where a cancelled run would throw. */
  const runner = (sparql: SparqlFn) => {
    const phases: string[] = [];
    let steps = 0;
    return {
      run: { sparql, phase: (m: string) => { phases.push(m); }, step: async () => { steps += 1; } },
      phases,
      steps: () => steps,
    };
  };

  it('stops the run when a band comes back holding exactly its LIMIT', async () => {
    const { run } = runner(vi.fn(async () => rows(2)));

    // Fatal, not a warning. The pool decides which museums this category admits
    // (ADR-0024), so a pool cut off at its limit withdraws real museums and
    // calls the run a success — and with no ORDER BY inside a band, the rows
    // that survive are an arbitrary subset rather than the famous ones.
    await expect(fetchBroadPool(run, { qid: PAINTING, type: 'painting' }, 2))
      .rejects.toThrow(/LIMIT of 2/);
  });

  it('names the band it stopped on, so the next edit is obvious', async () => {
    const { run } = runner(vi.fn(async () => rows(2)));

    await expect(fetchBroadPool(run, { qid: PAINTING, type: 'painting' }, 2))
      .rejects.toThrow(/100\+ sitelinks/);
  });

  it('stops a truncated narrow-class batch too', async () => {
    const sparql = vi.fn(async () => rows(2));

    await expect(fetchClassPool(sparql, ['Q1476300'], 2)).rejects.toThrow(/narrow classes/);
  });

  it('asks one question per fame band, and merges them by work', async () => {
    // The same work in two answers is one work: bands do not overlap, but a class
    // query can reach the same painting, and the merge is what stops the pool's
    // own length lying to the admission rule that reads it.
    const sparql = vi.fn(async (_query: string, _descriptor?: { label: string }) => rows(1));
    const { run } = runner(sparql);

    const works = await fetchBroadPool(run, { qid: PAINTING, type: 'painting' }, 2);

    expect(sparql).toHaveBeenCalledTimes(POOL_BAND_COUNT);
    const filters = sparql.mock.calls.map(call => String(call[0]));
    expect(filters[0]).toContain('FILTER(?sl >= 100)');
    expect(filters[1]).toContain('FILTER(?sl >= 50 && ?sl < 100)');
    // The hint is the whole reason a band is answerable: without the fixed join
    // order the planner scans the class again, which is what timed out.
    expect(filters[0]).toContain('hint:optimizer "None"');
    expect(filters[0]).toContain('hint:rangeSafe true');
    // Every band is its own cached question, which is what lets a run that dies
    // in the fourth band keep the first three.
    const labels = sparql.mock.calls.map(call => call[1]?.label);
    expect(new Set(labels).size).toBe(POOL_BAND_COUNT);
    expect(works).toHaveLength(1);
  });

  it('paces and reports between bands, not only between roots', async () => {
    const { run, phases, steps } = runner(vi.fn(async () => rows(1)));

    await fetchBroadPool(run, { qid: PAINTING, type: 'painting' }, 2);

    // Each band is tens of seconds of somebody's afternoon: a Cancel pressed in
    // the middle of a root has to be acted on before the next band, and the
    // phase message has to move, or the run reads as hung.
    expect(steps()).toBe(POOL_BAND_COUNT);
    expect(new Set(phases).size).toBe(POOL_BAND_COUNT);
    expect(phases[0]).toContain('band 1/');
  });

  it('is content when the band fits', async () => {
    const { run } = runner(vi.fn(async () => rows(1)));
    await expect(fetchBroadPool(run, { qid: PAINTING, type: 'painting' }, 2)).resolves.toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('asks a batch of narrow classes once, without bands', async () => {
    // Narrow classes were never the query that failed, and banding them would
    // turn thirty affordable questions into two hundred.
    const sparql = vi.fn(async (_query: string) => rows(1));
    await fetchClassPool(sparql, ['Q1476300', 'Q93184'], 2);
    expect(sparql).toHaveBeenCalledTimes(1);
    expect(String(sparql.mock.calls[0][0])).toContain('VALUES ?cls');
  });
});
