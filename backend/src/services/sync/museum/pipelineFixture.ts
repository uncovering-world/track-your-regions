/**
 * The shared fixture behind the works-first museum pipeline's tests: a small world of works and
 * venues, served by a stub that answers on the shape of the query rather than on the order the
 * calls arrive in — the class closure walks at least three roots before the pool is touched,
 * which a positional stub cannot survive.
 *
 * `pipeline.test.ts` drives it through `collectTier1Museums`, the museum tail included;
 * `worksCollector.test.ts` drives it through `collectWorks` directly, the stages every
 * works-first kind shares. Both need the same works and venues, so one fixture serves both.
 */

import { vi } from 'vitest';
import { MUSEUM_BROAD_ROOTS, MUSEUM_WHOLE_ROOTS, MUSEUM_PINNED_CLASSES } from './worksCollector.js';
import type { SparqlBinding } from '../wikidataUtils.js';

const ENTITY = 'http://www.wikidata.org/entity/';
const RANK = 'http://wikiba.se/ontology#';
/** How the query service spells Wikidata's *unknown value*: a skolem node under genid. */
const UNKNOWN_VALUE = 'http://www.wikidata.org/.well-known/genid/1d6a3e0f9c2b';

/** Art museum, the class most venues here carry; a bare museum passes the venue test too. */
const ART_MUSEUM = 'Q207694';
const MUSEUM = 'Q33506';
export const MUSEUM_CLASSES = new Set([ART_MUSEUM, MUSEUM]);

interface FixtureEntity {
  label: string;
  classes: string[];
  lat: number | null;
  lon: number | null;
  parents: string[];
  /** What it is located in (`P276`); the graph follows it from a museum-class entity. */
  locations?: string[];
  /** Ten unless a case is about fame, which the door rule compares (#781). */
  sitelinks?: number;
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
  artists?: string[];
  year?: number;
  /** `venue: UNKNOWN` is a statement whose value is Wikidata's *unknown value* (#868). */
  statements: { property: 'P195' | 'P276'; venue: string; rank?: 'preferred' | 'normal' }[];
}

/** The venue of a statement whose value is unknown. */
export const UNKNOWN = 'unknown';

export const PAINTING = 'Q3305213';
const STATUE = 'Q179700';
/** The lost tree (#868): `lost artwork` and the three classes under it, as Wikidata holds them. */
export const LOST_ARTWORK = 'Q4140840';
export const LOST_PAINTING = 'Q104438958';
const DESTROYED_ARTWORK = 'Q21745157';
const LOST_TREE = [LOST_ARTWORK, DESTROYED_ARTWORK, 'Q26883973', LOST_PAINTING];
/** A pinned edition class: a work printed from one block exists in many true impressions. */
const WOODBLOCK_PRINT = 'Q28913685';
const FRESCO = 'Q1476300';
/** A real class whose label is 68 characters — longer than `treasures.treasure_type`. */
const LONG_CLASS = 'Q574422';
export const LONG_LABEL = 'Anthropomorphic wooden cult figurines of Central and Northern Europe';
/** One of the 46 artwork classes with no label in the fallback chain: the service answers a QID. */
const UNLABELLED_CLASS = 'Q900999';
/** A relic — one of a kind that admits a place of worship rather than a museum (#753). */
const RELIC = 'Q187616';

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

  // A collection housed in a better-known palace that no work names: the Galleria Palatina is
  // located in Palazzo Pitti, 5 m away, and is part of nothing — the palace is reachable only
  // through the collection's location (#781).
  Q866498: {
    label: 'Galleria Palatina', classes: [ART_MUSEUM], lat: 43.7651, lon: 11.25,
    parents: [], locations: ['Q29286'], sitelinks: 12,
  },
  Q29286: { label: 'Palazzo Pitti', classes: [ART_MUSEUM], lat: 43.76514, lon: 11.25004, parents: [], sitelinks: 59 },
  // A museum standing in a better-known quarter that Wikidata types an art museum and the
  // editors excluded: the Leopold Museum in the MuseumsQuartier, 78 m away.
  Q59435: {
    label: 'Leopold Museum', classes: [ART_MUSEUM], lat: 48.2033, lon: 16.3594,
    parents: ['Q699943'], locations: ['Q699943'], sitelinks: 25,
  },
  Q699943: { label: 'MuseumsQuartier', classes: [ART_MUSEUM], lat: 48.2036, lon: 16.3603, parents: [], sitelinks: 27 },

  // A collection housed in a gallery housed in a palace, each better known than the last and a
  // few metres apart: the door walk goes on from the gallery to the palace, and the gallery —
  // a door that holds no work — becomes a key of the fold map without ever being a venue.
  Q900021: {
    label: 'Collection in the Gallery', classes: [ART_MUSEUM], lat: 45.5, lon: 10.5,
    parents: [], locations: ['Q900022'], sitelinks: 5,
  },
  Q900022: {
    label: 'Gallery in the Palace', classes: [ART_MUSEUM], lat: 45.50005, lon: 10.5,
    parents: [], locations: ['Q900023'], sitelinks: 20,
  },
  Q900023: { label: 'Palace of Doors', classes: [ART_MUSEUM], lat: 45.5001, lon: 10.5, parents: [], sitelinks: 60 },
  // A second collection in the same palace, holding only a work nobody can see: as if seen, it
  // folds into the palace like the first, so the palace lost a work and the collection is not
  // reported under a name the catalogue never uses (#868).
  Q900031: {
    label: 'Collection of Lost Things', classes: [ART_MUSEUM], lat: 45.50008, lon: 10.5,
    parents: [], locations: ['Q900023'], sitelinks: 5,
  },

  // Two real museums for the works nobody can see (#868): the Gardner, whose two famous works
  // were stolen in 1990, and the Capitoline, where a destroyed colossus's fragments are on show.
  Q49135: { label: 'Isabella Stewart Gardner Museum', classes: [ART_MUSEUM], lat: 42.3382, lon: -71.0991, parents: [] },
  Q333906: { label: 'Capitoline Museums', classes: [ART_MUSEUM], lat: 41.8931, lon: 12.4826, parents: [] },
  // A bare museum with no art class, judged by the painting share of what it holds: two
  // sub-iconic statues and one iconic painting nobody can see. As if that painting could be
  // seen, it is still not an art museum, so it is not told its works cannot be seen.
  Q900901: { label: 'Hall of Casts', classes: [MUSEUM], lat: 52.52, lon: 13.4, parents: [] },
};

// The venue and work QIDs below (here and in ENTITIES) are illustrative, not a claim about the
// real Wikidata item — Q216141 is not the Shroud of Turin. Only the class QIDs (PAINTING, FRESCO,
// LONG_CLASS, …) have to be real, since the medium and closure logic is tested against the
// actual Wikidata subclass tree they sit in.
export const WORKS: Record<string, FixtureWork> = {
  Q12418: {
    label: 'Mona Lisa', sitelinks: 146, cls: PAINTING, clsLabel: 'painting',
    broadRoot: PAINTING, artists: ['Leonardo da Vinci'], year: 1503,
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
  // Two makers, which the endpoint answers with as two rows, and fetched twice
  // over besides — by its narrow class and by its fame band — so the parse has
  // to keep the list and the merge has to leave it alone (#720).
  Q900201: {
    label: 'Work in the Sala', sitelinks: 30, cls: PAINTING, clsLabel: 'painting',
    broadRoot: PAINTING, artists: ['Ivan Shishkin', 'Konstantin Savitsky'],
    statements: [{ property: 'P276', venue: 'Q900013' }],
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
  // Owned by and located in the collection, which names no building: the palace has to come
  // from the collection's own location edge.
  Q948034: {
    label: 'La velata', sitelinks: 25, cls: PAINTING, clsLabel: 'painting', broadRoot: PAINTING,
    statements: [
      { property: 'P195', venue: 'Q866498' },
      { property: 'P276', venue: 'Q866498' },
    ],
  },
  Q1445107: {
    label: 'Danaë', sitelinks: 24, cls: PAINTING, clsLabel: 'painting', broadRoot: PAINTING,
    statements: [
      { property: 'P195', venue: 'Q59435' },
      { property: 'P276', venue: 'Q59435' },
    ],
  },
  Q900601: {
    label: 'Work in the Collection', sitelinks: 30, cls: PAINTING, clsLabel: 'painting', broadRoot: PAINTING,
    statements: [
      { property: 'P195', venue: 'Q900021' },
      { property: 'P276', venue: 'Q900021' },
    ],
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
  // Held whole under an extra class no closure reaches (relic), by a church — which fails the
  // museum venue rule, so this work stays homeless under `MUSEUM_CLASSES` (#753's own kind reads
  // this same row through a rule the church passes).
  Q216141: {
    label: 'Shroud of Turin', sitelinks: 67, cls: RELIC, clsLabel: 'relic',
    statements: [{ property: 'P276', venue: 'Q1876' }],
  },

  // The works nobody can see (#868), each with the statements Wikidata really holds
  // (`wbgetentities`, 2026-09-12). Stolen from the Gardner in 1990 and never found: the Storm,
  // a `lost painting` whose collection is an unknown value at preferred rank beside the museum
  // at normal rank; the Concert, whose location is an unknown value at preferred rank.
  Q2246489: {
    label: 'The Storm on the Sea of Galilee', sitelinks: 32, cls: LOST_PAINTING, clsLabel: 'lost painting',
    broadRoot: PAINTING, artists: ['Rembrandt'], year: 1633,
    statements: [
      { property: 'P195', venue: UNKNOWN, rank: 'preferred' },
      { property: 'P195', venue: 'Q49135' },
    ],
  },
  Q1169395: {
    label: 'The Concert', sitelinks: 25, cls: PAINTING, clsLabel: 'painting',
    broadRoot: PAINTING, artists: ['Johannes Vermeer'],
    statements: [
      { property: 'P276', venue: UNKNOWN, rank: 'preferred' },
      { property: 'P195', venue: 'Q49135' },
    ],
  },
  // A `lost artwork` beside `painting` — a class the closure under painting never reaches, so
  // the work arrives typed `painting` and only the lost tree's own question names it.
  Q2395137: {
    label: 'Portrait of a Courtesan', sitelinks: 10, cls: LOST_ARTWORK, clsLabel: 'lost artwork',
    broadRoot: PAINTING, statements: [{ property: 'P276', venue: 'Q900011' }],
  },
  // A `destroyed artwork` whose fragments are on show: the one name on `REMAINS_ON_SHOW`.
  Q1289781: {
    label: 'Colossus of Constantine', sitelinks: 20, cls: DESTROYED_ARTWORK, clsLabel: 'destroyed artwork',
    broadRoot: STATUE,
    statements: [{ property: 'P276', venue: 'Q333906' }, { property: 'P195', venue: 'Q333906' }],
  },
  // What admits the Capitoline, so the colossus has a museum to be linked to.
  Q900701: {
    label: 'Capitoline Wolf', sitelinks: 60, cls: STATUE, clsLabel: 'statue', broadRoot: STATUE,
    statements: [{ property: 'P276', venue: 'Q333906' }],
  },
  // A work of unknown whereabouts whose collection is the quarter the editors excluded: the
  // quarter was never going to be admitted, so it is not told its works cannot be seen.
  Q900801: {
    label: 'Lost Work of the Quarter', sitelinks: 30, cls: PAINTING, clsLabel: 'painting',
    broadRoot: PAINTING,
    statements: [
      { property: 'P276', venue: UNKNOWN, rank: 'preferred' },
      { property: 'P195', venue: 'Q699943' },
    ],
  },
  // The Hall of Casts' holdings: two statues below the line, and an iconic painting of unknown
  // whereabouts that alone would read as a painting share of one to nothing.
  Q900902: {
    label: 'Cast in the Hall', sitelinks: 15, cls: STATUE, clsLabel: 'statue', broadRoot: STATUE,
    statements: [{ property: 'P276', venue: 'Q900901' }],
  },
  Q900903: {
    label: 'Second Cast in the Hall', sitelinks: 14, cls: STATUE, clsLabel: 'statue', broadRoot: STATUE,
    statements: [{ property: 'P276', venue: 'Q900901' }],
  },
  Q900904: {
    label: 'Lost Painting of the Hall', sitelinks: 30, cls: PAINTING, clsLabel: 'painting',
    broadRoot: PAINTING,
    statements: [
      { property: 'P276', venue: UNKNOWN, rank: 'preferred' },
      { property: 'P195', venue: 'Q900901' },
    ],
  },
  // The only work of the Collection of Lost Things, and nobody can see it.
  Q900905: {
    label: 'Lost Work of the Collection', sitelinks: 30, cls: PAINTING, clsLabel: 'painting',
    broadRoot: PAINTING,
    statements: [
      { property: 'P276', venue: UNKNOWN, rank: 'preferred' },
      { property: 'P195', venue: 'Q900031' },
    ],
  },
  // Owned by an anonymous collector (an unknown value at normal rank) and hanging on loan:
  // the shape an unknown value must *not* be read as.
  Q152849: {
    label: 'Nude, Green Leaves and Bust', sitelinks: 16, cls: PAINTING, clsLabel: 'painting',
    broadRoot: PAINTING,
    statements: [{ property: 'P195', venue: UNKNOWN }, { property: 'P276', venue: 'Q333906' }],
  },
};

/**
 * Direct `P279` children, so the closure finds `fresco` under `painting` and stops. `lost
 * painting` is under `painting` on the live graph too, which is how the Storm arrived typed
 * `lost painting` while the import still hung it in the Gardner.
 */
const SUBCLASSES: Record<string, string[]> = {
  [PAINTING]: [FRESCO, LONG_CLASS, UNLABELLED_CLASS, LOST_PAINTING],
};

/**
 * Every class the museum's own roots and pinned list make reachable in this fixture: its broad
 * and whole roots, what `SUBCLASSES` says the closure finds under them, and the pinned classes
 * beside it. A work whose narrow class is outside this set — a relic, a future tomb — is one no
 * museum run asks for, whatever else adds it to the shared pool. Built from the real exported
 * constants rather than hand-copied, so a class added to the museum's own list here needs no
 * matching edit.
 */
export const MUSEUM_REACHABLE = new Set([
  ...MUSEUM_BROAD_ROOTS.map((r) => r.qid),
  ...MUSEUM_WHOLE_ROOTS.map((r) => r.qid),
  ...Object.keys(MUSEUM_PINNED_CLASSES),
  ...Object.values(SUBCLASSES).flat(),
]);

/** A bare entity URI binding, the shape every SPARQL answer wraps a QID in. */
export function uri(qid: string) {
  return { value: `${ENTITY}${qid}` };
}

function askedFor(query: string): string[] {
  return [...query.matchAll(/wd:(Q\d+)/g)].map((m) => m[1]);
}

function poolRows(qid: string, work: FixtureWork, clsLabel?: string): SparqlBinding[] {
  const creators = work.artists ?? [];
  if (creators.length <= 1) return [poolRow(qid, work, clsLabel, creators[0])];
  // The endpoint answers a work with two makers twice, which is the whole of
  // what #720 is about: the parse used to keep whichever arrived first.
  return creators.map(creator => poolRow(qid, work, clsLabel, creator));
}

function poolRow(qid: string, work: FixtureWork, clsLabel?: string, creator?: string): SparqlBinding {
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
  if (creator) row.creatorLabel = { value: creator };
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
        venue: s.venue === UNKNOWN ? { value: UNKNOWN_VALUE } : uri(s.venue),
        rank: { value: `${RANK}${s.rank === 'preferred' ? 'Preferred' : 'Normal'}Rank` },
      });
    }
  }
  return rows;
}

function detailRows(qids: string[]): SparqlBinding[] {
  return qids.filter((q) => ENTITIES[q]).map((qid) => {
    const e = ENTITIES[qid];
    const row: SparqlBinding = { e: uri(qid), eLabel: { value: e.label }, sl: { value: String(e.sitelinks ?? 10) } };
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
    for (const loc of e.locations ?? []) rows.push({ e: uri(qid), loc: uri(loc) });
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
export function makeSparql() {
  return vi.fn(async (query: string): Promise<SparqlBinding[]> => {
    const qids = askedFor(query);
    // The lost tree, asked whole (#868). No other tree is asked this way here: the museum
    // classes are injected, and the artwork classes walk hop by hop below.
    if (query.includes(`wdt:P279* wd:${LOST_ARTWORK}`)) return LOST_TREE.map((c) => ({ c: uri(c) }));
    if (query.includes('?c wdt:P279 ?p')) {
      return qids.flatMap((q) => SUBCLASSES[q] ?? []).map((c) => ({ c: uri(c) }));
    }
    if (query.includes('p:P195')) return statementRows(qids);
    if (query.includes('?e wdt:P31 ?cls')) return edgeRows(qids);
    if (query.includes('?e wdt:P625 ?coord')) return detailRows(qids);
    if (query.includes('VALUES ?cls')) {
      return Object.entries(WORKS)
        .filter(([, w]) => qids.includes(w.cls))
        .flatMap(([qid, w]) => poolRows(qid, w, w.clsLabel));
    }
    if (query.includes('?w wdt:P31 wd:')) {
      const band = bandOf(query);
      return Object.entries(WORKS)
        .filter(([, w]) => w.broadRoot === qids[0]
          && w.sitelinks >= band.min && (band.max === null || w.sitelinks < band.max))
        .flatMap(([qid, w]) => poolRows(qid, w));
    }
    throw new Error(`unexpected query: ${query}`);
  });
}
