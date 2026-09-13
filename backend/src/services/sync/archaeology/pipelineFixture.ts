/**
 * The world the archaeology pipeline's test runs against, and the fake door that
 * answers it.
 *
 * A file of its own for the reason `museum/pipelineFixture.ts` is one: a world
 * of museums and the finds they hold, with a stub that answers on the *shape* of
 * the query rather than on the order the calls arrive in. This pipeline sends
 * the public-art pool questions, the museum works questions and this kind's own
 * find facts, interleaved, and a positional stub cannot survive that. English
 * Wikipedia is a function the run is handed (`deps.categories`), so no category
 * is fetched here either.
 *
 * The QIDs are real and were verified with `wbgetentities` on 2026-09-13 — the
 * classes, the sitelink counts, the coordinates, the enwiki titles and the
 * statements each find carries (the Rosetta Stone is the British Museum's; the
 * Venus de' Medici the Uffizi's; the Charioteer the Delphi museum's; the
 * Laocoön belongs to the Pio-Clementino museum, which is `P361` the Vatican
 * Museums 86 m away and has no English article at all).
 *
 * Two things are this fixture's own, and each is a case the rule needs:
 *   - the **Venus of Buret'** is raised from 9 sitelinks to 25 and given a
 *     `P195` on the Hermitage. The Mal'ta–Buret' figurines are in the
 *     Hermitage's Paleolithic collection, but the item states no collection and
 *     at 9 sitelinks it is under the pool's own floor — and this kind judges the
 *     Hermitage only as the holder of a find above the line;
 *   - the **Louvre's categories** are its art ones alone. Its article carries
 *     `Archaeological museums in France` too, which would answer the nature
 *     question before its class ever did; left out, the Louvre is what the class
 *     door admits on its own.
 *
 * The **Vatican Museums** carry what their article carries — `Museums of ancient
 * Greece` and `Museums of ancient Rome`, department categories both — and they
 * are the survivor of a real fold, so two of the tests replace those categories
 * to ask what the fold filter does with the other answers a nature can give.
 */

import { LOST_WORK_ROOT } from '../museum/worksCollector.js';
import { POOL_MIN_SITELINKS } from '../publicArt/queries.js';
import {
  ARCHAEOLOGICAL_PARK,
  ARTEFACT_ROOT,
  NATURAL_HISTORY_ROOT,
} from './classes.js';
import type { SparqlBinding } from '../wikidataUtils.js';

const ENTITY = 'http://www.wikidata.org/entity/';
const RANK = 'http://wikiba.se/ontology#NormalRank';
const uri = (qid: string) => ({ value: `${ENTITY}${qid}` });

// Classes: real, labels verified with wbgetentities on 2026-09-13.
export const MUSEUM = 'Q33506'; // museum
export const ART_MUSEUM = 'Q207694'; // art museum
export const NATIONAL_MUSEUM = 'Q17431399'; // national museum
export const ARCHAEOLOGICAL_MUSEUM = 'Q3329412'; // archaeological museum
const EGYPTOLOGICAL_MUSEUM = 'Q3330834'; // egyptological museum
const PALACE = 'Q16560'; // palace
const SCULPTURE = 'Q860861'; // sculpture
const STATUE = 'Q179700'; // statue
const GROUP_OF_SCULPTURES = 'Q2293362'; // group of sculptures
const STELE = 'Q178743'; // stele
const BILINGUAL_INSCRIPTION = 'Q861809'; // bilingual inscription
const VENUS_FIGURINE = 'Q248726'; // Venus figurine

interface FixtureMuseum {
  label: string;
  /** Every `P31` it carries. */
  classes: string[];
  sitelinks: number;
  lat: number;
  lon: number;
  description?: string;
  imageUrl?: string;
  countryLabel?: string;
  website?: string;
  articleUrl?: string;
  /** What English Wikipedia's categories say about it, as `deps.categories` answers. */
  categories?: string[];
  /** `P361`: what it is part of. */
  parents?: string[];
}

interface FixtureFind {
  label: string;
  sitelinks: number;
  /** The narrow class a `VALUES ?cls` batch matches it under, with the label that batch returns. */
  cls: string;
  clsLabel: string;
  /** The broad root whose fame bands answer with it. Those rows bind no class. */
  broadRoot?: string;
  year?: number;
  /** Every `P31` the item carries, as the find facts answer. */
  classes?: string[];
  /** `P189`, with the name a reader sees. */
  discovery?: { qid: string; label: string };
  statements: { property: 'P195' | 'P276'; venue: string }[];
}

export interface World {
  museums: Record<string, FixtureMuseum>;
  finds: Record<string, FixtureFind>;
  /** What `?c wdt:P279* wd:<root>` answers. A root not named here answers with itself alone. */
  trees: Record<string, string[]>;
  /** Direct `P279` children, for the finds closure. */
  children: Record<string, string[]>;
}

const WORLD: World = {
  museums: {
    Q19675: {
      label: 'Louvre Museum', classes: [ART_MUSEUM, ARCHAEOLOGICAL_MUSEUM], sitelinks: 169,
      lat: 48.86111, lon: 2.33583, description: 'art and archeology museum in Paris, France',
      imageUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Louvre.jpg',
      countryLabel: 'France', website: 'https://www.louvre.fr',
      articleUrl: 'https://en.wikipedia.org/wiki/Louvre',
      categories: ['Art museums and galleries in Paris'],
    },
    // The canon the class misses: `art museum, national museum` on Wikidata,
    // and `Archaeological museums in London` on its article.
    Q6373: {
      label: 'British Museum', classes: [ART_MUSEUM, NATIONAL_MUSEUM, MUSEUM], sitelinks: 109,
      lat: 51.51944, lon: -0.12694, description: 'national museum in London, United Kingdom',
      countryLabel: 'United Kingdom',
      articleUrl: 'https://en.wikipedia.org/wiki/British_Museum',
      categories: ['Archaeological museums in London', 'Art museums and galleries in London'],
    },
    // An art museum with one ancient statue: the row ADR-0058 decision 2 exists
    // to refuse.
    Q51252: {
      label: 'Uffizi Gallery', classes: [ART_MUSEUM, PALACE], sitelinks: 73,
      lat: 43.76833, lon: 11.25528, articleUrl: 'https://en.wikipedia.org/wiki/Uffizi',
      categories: ['Art museums and galleries in Florence'],
    },
    // A department, not a nature: among the world's best antiquities, and
    // visited as an art museum. A curator answers this one.
    Q132783: {
      label: 'Hermitage Museum', classes: [ART_MUSEUM, MUSEUM], sitelinks: 86,
      lat: 59.94056, lon: 30.31361, countryLabel: 'Russia',
      articleUrl: 'https://en.wikipedia.org/wiki/Hermitage_Museum',
      categories: ['Egyptological collections in Russia'],
    },
    // 15 sitelinks, under the place line: what admits it is the Charioteer.
    Q636928: {
      label: 'Delphi Archaeological Museum', classes: [ARCHAEOLOGICAL_MUSEUM], sitelinks: 15,
      lat: 38.48029, lon: 22.49984, countryLabel: 'Greece',
      articleUrl: 'https://en.wikipedia.org/wiki/Delphi_Archaeological_Museum',
      categories: ['Archaeological museums in Greece'],
    },
    // An archaeological museum by class with no English article at all, housed
    // in the Vatican Museums 86 m away and known to a tenth as many languages:
    // the fold rule hands its Laocoön to the museum around it.
    Q1439912: {
      label: 'Pio-Clementino museum', classes: [ART_MUSEUM, ARCHAEOLOGICAL_MUSEUM], sitelinks: 10,
      lat: 41.90673, lon: 12.45351, parents: ['Q182955'],
    },
    Q182955: {
      label: 'Vatican Museums', classes: [ART_MUSEUM, NATIONAL_MUSEUM], sitelinks: 64,
      lat: 41.90639, lon: 12.45444,
      articleUrl: 'https://en.wikipedia.org/wiki/Vatican_Museums',
      categories: ['Museums of ancient Greece', 'Museums of ancient Rome'],
    },
  },
  finds: {
    Q48584: {
      label: 'Rosetta Stone', sitelinks: 101, cls: STELE, clsLabel: 'stele',
      classes: [STELE, BILINGUAL_INSCRIPTION],
      discovery: { qid: 'Q3077898', label: 'Fort Julien' },
      statements: [{ property: 'P195', venue: 'Q6373' }, { property: 'P276', venue: 'Q6373' }],
    },
    Q774967: {
      label: "Venus de' Medici", sitelinks: 25, cls: STATUE, clsLabel: 'statue', broadRoot: STATUE,
      year: -100, classes: [STATUE],
      statements: [{ property: 'P195', venue: 'Q51252' }, { property: 'P276', venue: 'Q51252' }],
    },
    Q2513086: {
      label: "Venus of Buret'", sitelinks: 25, cls: VENUS_FIGURINE, clsLabel: 'Venus figurine',
      classes: [VENUS_FIGURINE, GROUP_OF_SCULPTURES],
      discovery: { qid: 'Q6585', label: 'Irkutsk Oblast' },
      statements: [{ property: 'P195', venue: 'Q132783' }],
    },
    Q1230882: {
      label: 'Charioteer of Delphi', sitelinks: 26, cls: STATUE, clsLabel: 'statue',
      broadRoot: STATUE, year: -470, classes: [STATUE],
      discovery: { qid: 'Q75459', label: 'Delphi' },
      statements: [{ property: 'P195', venue: 'Q636928' }, { property: 'P276', venue: 'Q636928' }],
    },
    Q465762: {
      label: 'Laocoön and His Sons', sitelinks: 47, cls: SCULPTURE, clsLabel: 'sculpture',
      broadRoot: SCULPTURE, year: -40, classes: [SCULPTURE, GROUP_OF_SCULPTURES],
      discovery: { qid: 'Q220', label: 'Rome' },
      statements: [
        { property: 'P195', venue: 'Q1439912' }, { property: 'P276', venue: 'Q1439912' },
      ],
    },
  },
  trees: {
    // Wikidata files `archaeological park` under `archaeological museum`, which
    // is why the park tree is walked and subtracted (`buildArchaeologyTrees`).
    [ARCHAEOLOGICAL_MUSEUM]: [ARCHAEOLOGICAL_MUSEUM, ARCHAEOLOGICAL_PARK],
    [EGYPTOLOGICAL_MUSEUM]: [EGYPTOLOGICAL_MUSEUM],
    [ARCHAEOLOGICAL_PARK]: [ARCHAEOLOGICAL_PARK],
    [NATURAL_HISTORY_ROOT]: [NATURAL_HISTORY_ROOT],
    [ARTEFACT_ROOT]: [ARTEFACT_ROOT],
    // What a venue may be, for the shared collector's rule.
    [MUSEUM]: [MUSEUM, ART_MUSEUM, NATIONAL_MUSEUM, ARCHAEOLOGICAL_MUSEUM, EGYPTOLOGICAL_MUSEUM],
    // The lost tree (#868): nothing here is under it.
    [LOST_WORK_ROOT]: [LOST_WORK_ROOT, 'Q21745157'],
  },
  children: {},
};

export const world = (): World => structuredClone(WORLD);

const askedFor = (query: string): string[] => [...query.matchAll(/wd:(Q\d+)/g)].map((m) => m[1]);

function bandOf(query: string): { min: number; max: number | null } {
  const bounded = /FILTER\(\?sl >= (\d+) && \?sl < (\d+)\)/.exec(query);
  if (bounded) return { min: Number(bounded[1]), max: Number(bounded[2]) };
  const open = /FILTER\(\?sl >= (\d+)\)/.exec(query);
  if (!open) throw new Error(`pool query with no band: ${query}`);
  return { min: Number(open[1]), max: null };
}

const inBand = (sitelinks: number, band: { min: number; max: number | null }): boolean =>
  sitelinks >= band.min && (band.max === null || sitelinks < band.max);

function museumRow(qid: string, museum: FixtureMuseum): SparqlBinding {
  const row: SparqlBinding = {
    e: uri(qid),
    eLabel: { value: museum.label },
    sl: { value: String(museum.sitelinks) },
    coord: { value: `Point(${museum.lon} ${museum.lat})` },
  };
  if (museum.description) row.eDescription = { value: museum.description };
  if (museum.imageUrl) row.img = { value: museum.imageUrl };
  if (museum.countryLabel) row.countryLabel = { value: museum.countryLabel };
  if (museum.website) row.site = { value: museum.website };
  if (museum.articleUrl) row.article = { value: museum.articleUrl };
  return row;
}

/** A pool of museums: by id, or by a batch of the archaeology classes. */
function museumPoolRows(w: World, query: string, asked: string[]): SparqlBinding[] {
  const museums = Object.entries(w.museums);
  if (query.includes('VALUES ?e')) {
    return museums.filter(([qid]) => asked.includes(qid)).map(([qid, m]) => museumRow(qid, m));
  }
  if (!query.includes('VALUES ?cls')) throw new Error(`unexpected museum pool: ${query}`);
  return museums
    .filter(([, m]) => m.sitelinks >= POOL_MIN_SITELINKS && m.classes.some((c) => asked.includes(c)))
    .map(([qid, m]) => museumRow(qid, m));
}

function findRow(qid: string, find: FixtureFind, withClass: boolean): SparqlBinding {
  const row: SparqlBinding = {
    w: uri(qid), wLabel: { value: find.label }, sl: { value: String(find.sitelinks) },
  };
  if (withClass) {
    row.cls = uri(find.cls);
    row.clsLabel = { value: find.clsLabel };
  }
  if (find.year !== undefined) row.year = { value: String(find.year) };
  return row;
}

/** A pool of finds: a batch of narrow classes, or one fame band of one broad root. */
function findPoolRows(w: World, query: string, asked: string[]): SparqlBinding[] {
  const finds = Object.entries(w.finds);
  if (query.includes('VALUES ?cls')) {
    return finds.filter(([, f]) => asked.includes(f.cls) && f.sitelinks >= POOL_MIN_SITELINKS)
      .map(([qid, f]) => findRow(qid, f, true));
  }
  const root = /\?w wdt:P31 wd:(Q\d+)/.exec(query);
  if (!root) throw new Error(`unexpected find pool: ${query}`);
  const band = bandOf(query);
  return finds.filter(([, f]) => f.broadRoot === root[1] && inBand(f.sitelinks, band))
    .map(([qid, f]) => findRow(qid, f, false));
}

/** What each find of a batch is, and where it was dug up. */
function findFactRows(w: World, asked: string[]): SparqlBinding[] {
  const rows: SparqlBinding[] = [];
  for (const qid of asked) {
    const find = w.finds[qid];
    if (!find) continue;
    for (const cls of find.classes ?? []) rows.push({ w: uri(qid), cls: uri(cls) });
    if (find.discovery) {
      rows.push({
        w: uri(qid),
        disc: uri(find.discovery.qid),
        discLabel: { value: find.discovery.label },
      });
    }
  }
  return rows;
}

/** The venue statements of a batch: what each of its finds says about where it is. */
function statementRows(w: World, asked: string[]): SparqlBinding[] {
  const rows: SparqlBinding[] = [];
  for (const qid of asked) {
    for (const statement of w.finds[qid]?.statements ?? []) {
      rows.push({
        w: uri(qid),
        rel: { value: statement.property },
        venue: uri(statement.venue),
        rank: { value: RANK },
      });
    }
  }
  return rows;
}

const detailRows = (w: World, asked: string[]): SparqlBinding[] =>
  asked.filter((qid) => w.museums[qid]).map((qid) => museumRow(qid, w.museums[qid]));

/**
 * What an entity is and is part of. One answer serves both questions that ask
 * it — the museum import's edges and the public-art facts — since both bind the
 * same columns (`?cls`, `?parent`) to the same entity.
 */
const edgeRows = (w: World, asked: string[]): SparqlBinding[] =>
  asked.flatMap((qid) => {
    const museum = w.museums[qid];
    if (!museum) return [];
    return [
      ...museum.classes.map((c) => ({ e: uri(qid), cls: uri(c) })),
      ...(museum.parents ?? []).map((p) => ({ e: uri(qid), parent: uri(p) })),
    ];
  });

export function answer(w: World, sent: string): SparqlBinding[] {
  const query = sent.trimStart();
  const asked = askedFor(query);
  const tree = /wdt:P279\* wd:(Q\d+)/.exec(query);
  if (tree) return (w.trees[tree[1]] ?? [tree[1]]).map((c) => ({ c: uri(c) }));
  if (query.includes('?c wdt:P279 ?p')) {
    return asked.flatMap((p) => w.children[p] ?? []).map((c) => ({ c: uri(c) }));
  }
  // Before the statements question: the public-art facts question reads a
  // collection through `p:P195` too, and names `?coll` where the other does not.
  if (query.includes('?coll')) return edgeRows(w, asked);
  if (query.includes('?disc')) return findFactRows(w, asked);
  if (query.includes('p:P195')) return statementRows(w, asked);
  if (query.includes('SELECT ?e ?cls ?parent ?loc')) return edgeRows(w, asked);
  if (query.includes('?dissolved')) return detailRows(w, asked);
  if (query.includes('SELECT ?w')) return findPoolRows(w, query, asked);
  return museumPoolRows(w, query, asked);
}

/** The enwiki title of an article URL, the other side of `enwikiTitleOf`. */
const titleOf = (articleUrl: string): string =>
  decodeURIComponent(articleUrl.split('/wiki/')[1]).replace(/_/g, ' ');

/** English Wikipedia as this run is handed it: the world's categories, and what was asked. */
export function categoryDoor(w: World) {
  const byTitle = new Map<string, string[]>();
  for (const museum of Object.values(w.museums)) {
    if (museum.articleUrl) byTitle.set(titleOf(museum.articleUrl), museum.categories ?? []);
  }
  const calls: string[][] = [];
  const categories = (titles: string[]): Promise<Map<string, string[]>> => {
    calls.push(titles);
    return Promise.resolve(new Map(titles.map((t) => [t, byTitle.get(t) ?? []])));
  };
  return { categories, calls };
}
