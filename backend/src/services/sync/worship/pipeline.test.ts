/**
 * The places-of-worship collection as one run against a fake door: the class
 * trees, then the two doors — a place admitted for its own fame, a place
 * admitted for a work it holds — and what the catalogue makes of the two
 * together.
 *
 * The door answers on the *shape* of the question rather than on the order the
 * calls arrive in, as the museum fixture does and for the same reason: this
 * pipeline sends both the public-art pool questions and the museum works
 * questions, interleaved, and a positional stub cannot survive that.
 *
 * The QIDs are real and were verified against Wikidata on 2026-09-08 — the
 * class ids, the entities, and the `P31`/`P195`/`P276` statements each work
 * carries (the Pietà is owned by and located in St Peter's; the Ecstasy is
 * owned by Santa Maria della Vittoria and located in the Cornaro Chapel; the
 * Creation of Adam is the Vatican Museums' and is located in the Sistine
 * Chapel; the Statue of Zeus is a `lost sculpture` at the Temple of Zeus; the
 * Shroud is a `relic associated with Jesus` at Turin Cathedral). What is the
 * fixture's own: the sitelink counts and coordinates, rounded to what the rule
 * needs, and the `P279` edges of the works closure — the live tree reaches
 * `fresco` from `painting` in three hops through `wall painting`, which this
 * flattens to two.
 */

import { describe, it, expect } from 'vitest';
import { collectPlacesOfWorship, type CollectedWorship } from './pipeline.js';
import { LOST_WORK_ROOT } from '../museum/worksCollector.js';
import { POOL_MIN_SITELINKS } from '../publicArt/queries.js';
import type { SourceLine } from '../sourceLine.js';
import type { SparqlBinding } from '../wikidataUtils.js';

const ENTITY = 'http://www.wikidata.org/entity/';
const RANK = 'http://wikiba.se/ontology#NormalRank';
const uri = (qid: string) => ({ value: `${ENTITY}${qid}` });

// Classes: real, labels verified with wbgetentities on 2026-09-08.
const CHURCH = 'Q16970'; // church building
const MINOR_BASILICA = 'Q120560'; // minor basilica
const CHAPEL = 'Q108325'; // chapel
const CATHEDRAL = 'Q2977'; // cathedral
const CATHOLIC_CATHEDRAL = 'Q56242215'; // Catholic cathedral
const MOSQUE = 'Q32815'; // mosque
const TEMPLE = 'Q44539'; // temple
const GREEK_TEMPLE = 'Q267596'; // ancient Greek temple
const ARCHAEOLOGICAL_SITE = 'Q839954'; // archaeological site
const HILL = 'Q54050'; // hill
const CHURCH_TOWER = 'Q72926449'; // church tower
const ART_MUSEUM = 'Q207694'; // art museum
const PAINTING = 'Q3305213'; // painting
const WALL_PAINTING = 'Q99516640'; // wall painting
const FRESCO = 'Q22669139'; // fresco (the artwork, not the technique)
const SCULPTURE = 'Q860861'; // sculpture
const LOST_SCULPTURE = 'Q26883973'; // lost sculpture
const RELIC = 'Q187616'; // relic
const CHRISTIAN_RELIC = 'Q4501454'; // Christian relic
const RELIC_OF_JESUS = 'Q1087471'; // relic associated with Jesus
const TOMB = 'Q381885'; // tomb
const SHRINE = 'Q697295'; // shrine
const PAPAL_PALACE = 'Q83400038'; // palace of the Popes

interface FixturePlace {
  label: string;
  classes: string[];
  sitelinks: number;
  lat: number;
  lon: number;
  description?: string;
  imageUrl?: string;
  countryLabel?: string;
  /** `P361`: what it is part of. */
  parents?: string[];
  /** `P276`: what it is located in. */
  locations?: string[];
}

interface FixtureWork {
  label: string;
  sitelinks: number;
  /** The narrow class a `VALUES ?cls` batch matches it under, with the label that batch returns. */
  cls: string;
  clsLabel: string;
  /** The broad root whose fame bands answer with it. Those rows bind no class. */
  broadRoot?: string;
  artists?: string[];
  statements: { property: 'P195' | 'P276'; venue: string }[];
}

interface World {
  places: Record<string, FixturePlace>;
  works: Record<string, FixtureWork>;
  /** What `?c wdt:P279* wd:<root>` answers. A root not named here answers with itself alone. */
  trees: Record<string, string[]>;
  /** Direct `P279` children, for the works closure. */
  children: Record<string, string[]>;
}

const WORLD: World = {
  places: {
    Q12512: {
      label: "St. Peter's Basilica", classes: [MINOR_BASILICA], sitelinks: 129,
      lat: 41.9022, lon: 12.4539, description: 'basilica in Vatican City',
      imageUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/StPeters.jpg',
      countryLabel: 'Vatican City',
    },
    Q863593: {
      label: 'Santa Maria della Vittoria', classes: [CHURCH], sitelinks: 36,
      lat: 41.9047, lon: 12.4946,
    },
    // 30 m from the church it is part of, and known to almost nobody: the fold
    // rule hands its work to the church around it.
    Q588885: {
      label: 'Cornaro Chapel', classes: [CHAPEL], sitelinks: 4,
      lat: 41.90497, lon: 12.4946, parents: ['Q863593'],
    },
    Q2943: { label: 'Sistine Chapel', classes: [CHAPEL], sitelinks: 90, lat: 41.9029, lon: 12.4545 },
    Q182955: { label: 'Vatican Museums', classes: [ART_MUSEUM], sitelinks: 80, lat: 41.9065, lon: 12.4536 },
    Q197019: {
      label: 'Temple of Zeus in Olympia', classes: [GREEK_TEMPLE], sitelinks: 32,
      lat: 37.638, lon: 21.63,
    },
    Q172077: { label: 'Dome of the Rock', classes: [MOSQUE], sitelinks: 87, lat: 31.7780, lon: 35.2354 },
    // A ruin is still a place to stand in front of: `archaeological site` is
    // deliberately not a kill class.
    Q10288: {
      label: 'Parthenon', classes: [GREEK_TEMPLE, ARCHAEOLOGICAL_SITE], sitelinks: 136,
      lat: 37.9715, lon: 23.7267,
    },
    Q193163: { label: 'Temple Mount', classes: [MOSQUE, HILL], sitelinks: 75, lat: 31.7784, lon: 35.2360 },
    // A place at door one and nowhere else: 117 sitelinks, refused as a tower,
    // and offered to the cathedral it is `part of` no more than to anybody else.
    Q39054: {
      label: 'Leaning Tower of Pisa', classes: [CHURCH_TOWER], sitelinks: 117,
      lat: 43.7230, lon: 10.3966, parents: ['Q1754247'],
    },
    Q1754247: { label: 'Pisa Cathedral', classes: [CATHOLIC_CATHEDRAL], sitelinks: 60, lat: 43.7232, lon: 10.3964 },
    // A chapel inside a building the kind refuses, 147 m from it: the real rows
    // of log 102, where the chapel folded into the palace and its frescoes went
    // with it. `palace of the Popes` is filed under `religious building`, so the
    // palace is in the pool and refused there by name.
    Q1034868: {
      label: 'Cappella Paolina', classes: [CHAPEL], sitelinks: 17,
      lat: 41.90276, lon: 12.45478, parents: ['Q145093'],
    },
    Q145093: {
      label: 'Apostolic Palace', classes: [PAPAL_PALACE], sitelinks: 59,
      lat: 41.90390, lon: 12.45570,
    },
    // 20 sitelinks here; the real row has 35. The case needs a church the fame
    // line leaves out, so that what admits it is the Caravaggio it holds.
    Q869513: {
      label: 'Santa Maria del Popolo', classes: [CHURCH], sitelinks: 20,
      lat: 41.9110, lon: 12.4763,
    },
    // A place a traveller visits that the tomb tree also collects as a work:
    // `mosque, synagogue, tomb, archaeological site, mausoleum` on the real row.
    Q204200: {
      label: 'Cavern of the Patriarchs', classes: [MOSQUE, TOMB], sitelinks: 53,
      lat: 31.5246, lon: 35.1106,
    },
    Q958699: {
      label: 'Turin Cathedral', classes: [CATHOLIC_CATHEDRAL], sitelinks: 20,
      lat: 45.0731, lon: 7.6856, description: 'church building in Turin, Italy',
      imageUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Duomo.jpg',
      countryLabel: 'Italy',
    },
  },
  works: {
    Q235242: {
      label: 'Pietà', sitelinks: 56, cls: SCULPTURE, clsLabel: 'sculpture', broadRoot: SCULPTURE,
      artists: ['Michelangelo'],
      statements: [{ property: 'P195', venue: 'Q12512' }, { property: 'P276', venue: 'Q12512' }],
    },
    Q1333433: {
      label: 'Ecstasy of Saint Teresa', sitelinks: 41, cls: SCULPTURE, clsLabel: 'sculpture',
      broadRoot: SCULPTURE, artists: ['Gian Lorenzo Bernini'],
      statements: [{ property: 'P195', venue: 'Q863593' }, { property: 'P276', venue: 'Q588885' }],
    },
    Q500242: {
      label: 'The Creation of Adam', sitelinks: 61, cls: FRESCO, clsLabel: 'fresco',
      statements: [{ property: 'P195', venue: 'Q182955' }, { property: 'P276', venue: 'Q2943' }],
    },
    Q46239: {
      label: 'Statue of Zeus at Olympia', sitelinks: 93, cls: LOST_SCULPTURE, clsLabel: 'lost sculpture',
      statements: [{ property: 'P276', venue: 'Q197019' }],
    },
    Q178331: {
      label: 'Shroud of Turin', sitelinks: 67, cls: RELIC_OF_JESUS, clsLabel: 'relic associated with Jesus',
      statements: [{ property: 'P276', venue: 'Q958699' }],
    },
    // Both hang in the Cerasi Chapel of Santa Maria della Popolo and are owned
    // by the church, which is the statement kept here (the chapel's own row is
    // left out; the Cornaro Chapel already carries the fold). The Conversion
    // has 21 sitelinks on the real row and 23 here, so that both clear a line
    // of 22 and the more famous of the two has to be picked.
    Q685916: {
      label: 'Crucifixion of Saint Peter', sitelinks: 24, cls: PAINTING, clsLabel: 'painting',
      broadRoot: PAINTING, artists: ['Caravaggio'],
      statements: [{ property: 'P195', venue: 'Q869513' }],
    },
    Q2273517: {
      label: 'Conversion on the Way to Damascus', sitelinks: 23, cls: PAINTING, clsLabel: 'painting',
      broadRoot: PAINTING, artists: ['Caravaggio'],
      statements: [{ property: 'P195', venue: 'Q869513' }],
    },
    // Michelangelo's last fresco, in the Cappella Paolina. 22 sitelinks here
    // against 16 on the real row, so that the chapel is admitted for it and the
    // case is about the fold and not about the line.
    Q1886263: {
      label: 'The Crucifixion of Saint Peter', sitelinks: 22, cls: FRESCO, clsLabel: 'fresco',
      artists: ['Michelangelo'],
      statements: [{ property: 'P276', venue: 'Q1034868' }],
    },
    // The same entity as the place above. Wikidata places it by `P131` Hebron
    // and nothing else, so the location below is this case's own hypothesis —
    // what the run must do when a row that is a place carries a venue, which
    // the 19 worship classes under the tomb tree (imamzadeh, chapel tomb,
    // temple-tomb, …) make an everyday shape.
    Q204200: {
      label: 'Cavern of the Patriarchs', sitelinks: 53, cls: TOMB, clsLabel: 'tomb',
      statements: [{ property: 'P276', venue: 'Q172077' }],
    },
  },
  trees: {
    // The lost tree the shared collector reads (#868): the Statue of Zeus is under it.
    [LOST_WORK_ROOT]: [LOST_WORK_ROOT, 'Q21745157', LOST_SCULPTURE, 'Q104438958'],
    Q1370598: [
      'Q1370598', CHURCH, MINOR_BASILICA, CHAPEL, CATHEDRAL, CATHOLIC_CATHEDRAL,
      MOSQUE, TEMPLE, GREEK_TEMPLE, CHURCH_TOWER, PAPAL_PALACE,
    ],
    [CATHEDRAL]: [CATHEDRAL, CATHOLIC_CATHEDRAL],
    [CHURCH]: [CHURCH, MINOR_BASILICA, CHAPEL],
    // The two generic roots answer the way the live graph does — everything
    // Christian is under both — so a run that walked them would type St
    // Peter's a shrine and the Sistine Chapel a temple. Nothing asks for them.
    [TEMPLE]: [TEMPLE, GREEK_TEMPLE, CHURCH, MINOR_BASILICA, CHAPEL, CATHEDRAL, CATHOLIC_CATHEDRAL],
    [SHRINE]: [
      SHRINE, TEMPLE, GREEK_TEMPLE, CHURCH, MINOR_BASILICA, CHAPEL, CATHEDRAL, CATHOLIC_CATHEDRAL,
    ],
    [GREEK_TEMPLE]: [GREEK_TEMPLE],
    // The Shroud is an instance of none of these but the third: a treasure
    // class is reached through its tree, not by its root alone.
    [RELIC]: [RELIC, CHRISTIAN_RELIC, RELIC_OF_JESUS],
    Q33506: ['Q33506', ART_MUSEUM],
  },
  children: {
    [PAINTING]: [WALL_PAINTING],
    [WALL_PAINTING]: [FRESCO],
    [SCULPTURE]: [LOST_SCULPTURE],
  },
};

const world = (): World => structuredClone(WORLD);

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

function placeRow(qid: string, place: FixturePlace): SparqlBinding {
  const row: SparqlBinding = {
    e: uri(qid),
    eLabel: { value: place.label },
    sl: { value: String(place.sitelinks) },
    coord: { value: `Point(${place.lon} ${place.lat})` },
  };
  if (place.description) row.eDescription = { value: place.description };
  if (place.imageUrl) row.img = { value: place.imageUrl };
  if (place.countryLabel) row.countryLabel = { value: place.countryLabel };
  return row;
}

/** A pool of places: by id, by narrow class, or one fame band of one broad root. */
function placePoolRows(w: World, query: string, asked: string[]): SparqlBinding[] {
  const places = Object.entries(w.places);
  if (query.includes('VALUES ?e')) {
    return places.filter(([qid]) => asked.includes(qid)).map(([qid, p]) => placeRow(qid, p));
  }
  if (query.includes('VALUES ?cls')) {
    return places
      .filter(([, p]) => p.sitelinks >= POOL_MIN_SITELINKS && p.classes.some((c) => asked.includes(c)))
      .map(([qid, p]) => placeRow(qid, p));
  }
  const root = /\?e wdt:P31 wd:(Q\d+)/.exec(query);
  if (!root) throw new Error(`unexpected place pool: ${query}`);
  const band = bandOf(query);
  return places
    .filter(([, p]) => p.classes.includes(root[1]) && inBand(p.sitelinks, band))
    .map(([qid, p]) => placeRow(qid, p));
}

function workRows(qid: string, work: FixtureWork, withClass: boolean): SparqlBinding[] {
  const base: SparqlBinding = {
    w: uri(qid), wLabel: { value: work.label }, sl: { value: String(work.sitelinks) },
  };
  if (withClass) {
    base.cls = uri(work.cls);
    base.clsLabel = { value: work.clsLabel };
  }
  const artists = work.artists ?? [];
  if (!artists.length) return [base];
  // One row per maker, the shape the endpoint answers a work with two in.
  return artists.map((artist) => ({ ...base, creator: uri('Q0'), creatorLabel: { value: artist } }));
}

/** A pool of works: a batch of narrow classes, or one fame band of one broad root. */
function workPoolRows(w: World, query: string, asked: string[]): SparqlBinding[] {
  const works = Object.entries(w.works);
  if (query.includes('VALUES ?cls')) {
    return works.filter(([, work]) => asked.includes(work.cls))
      .flatMap(([qid, work]) => workRows(qid, work, true));
  }
  const root = /\?w wdt:P31 wd:(Q\d+)/.exec(query);
  if (!root) throw new Error(`unexpected work pool: ${query}`);
  const band = bandOf(query);
  return works.filter(([, work]) => work.broadRoot === root[1] && inBand(work.sitelinks, band))
    .flatMap(([qid, work]) => workRows(qid, work, false));
}

/** The venue statements of a batch: what each of its works says about where it is. */
function statementRows(w: World, asked: string[]): SparqlBinding[] {
  const rows: SparqlBinding[] = [];
  for (const qid of asked) {
    for (const statement of w.works[qid]?.statements ?? []) {
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
  asked.filter((qid) => w.places[qid]).map((qid) => placeRow(qid, w.places[qid]));

/**
 * What an entity is, is part of and stands in. One answer serves both questions
 * that ask it — the museum import's edges and the public-art facts — since both
 * bind the same three columns (`?cls`, `?parent`, `?loc`) to the same entity.
 */
const edgeRows = (w: World, asked: string[]): SparqlBinding[] =>
  asked.flatMap((qid) => {
    const place = w.places[qid];
    if (!place) return [];
    return [
      ...place.classes.map((c) => ({ e: uri(qid), cls: uri(c) })),
      ...(place.parents ?? []).map((p) => ({ e: uri(qid), parent: uri(p) })),
      ...(place.locations ?? []).map((l) => ({ e: uri(qid), loc: uri(l) })),
    ];
  });

function answer(w: World, sent: string): SparqlBinding[] {
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
  if (query.includes('p:P195')) return statementRows(w, asked);
  if (query.includes('SELECT ?e ?cls ?parent ?loc')) return edgeRows(w, asked);
  if (query.includes('?dissolved')) return detailRows(w, asked);
  if (query.includes('SELECT ?w')) return workPoolRows(w, query, asked);
  return placePoolRows(w, query, asked);
}

const LINE: SourceLine = { enterSitelinks: 22, staySitelinks: 18 };

function collect(w: World, opts: {
  line?: SourceLine; admitted?: string[]; previousPlacements?: Record<string, string[]>;
} = {}): Promise<CollectedWorship> {
  return collectPlacesOfWorship({
    sparql: (query: string) => Promise.resolve(answer(w, query)),
    previousPlacements: opts.previousPlacements ?? {},
    admitted: new Set(opts.admitted ?? []),
    line: opts.line ?? LINE,
  });
}

const item = (out: CollectedWorship, qid: string) => out.items.find((i) => i.qid === qid);
const reason = (out: CollectedWorship, qid: string) =>
  out.filtered.find((f) => f.externalId === qid)?.reason;
const worksOf = (out: CollectedWorship, qid: string) =>
  (item(out, qid)?.artworks ?? []).map((a) => a.externalId);

describe('collectPlacesOfWorship', () => {
  it("admits St Peter's by both doors, with the Pietà as its treasure and its admitting work", async () => {
    const out = await collect(world());

    expect(item(out, 'Q12512')).toMatchObject({
      door: 'both',
      type: 'church',
      label: "St. Peter's Basilica",
      description: 'basilica in Vatican City',
      countryLabel: 'Vatican City',
      sitelinks: 129,
      admittedFor: { qid: 'Q235242', label: 'Pietà' },
    });
    expect(worksOf(out, 'Q12512')).toEqual(['Q235242']);
    expect(item(out, 'Q12512')?.artworks[0]).toMatchObject({
      name: 'Pietà', treasureType: 'sculpture', artists: ['Michelangelo'],
    });
    // A minor basilica is a kind of church building, and St Peter's is not a
    // cathedral: Rome's is the Archbasilica of St John Lateran.
    expect(item(out, 'Q12512')?.classes).toEqual([MINOR_BASILICA]);
  });

  it('folds the Cornaro Chapel into Santa Maria della Vittoria and hangs the Ecstasy there', async () => {
    const out = await collect(world());

    expect(worksOf(out, 'Q863593')).toEqual(['Q1333433']);
    expect(item(out, 'Q588885')).toBeUndefined();
    expect(reason(out, 'Q588885')).toContain('folded into Santa Maria della Vittoria');
    expect(reason(out, 'Q588885')).toContain('30 m away');
  });

  it('keeps the Cappella Paolina, whose Apostolic Palace the kind refuses', async () => {
    const out = await collect(world());

    // The fold rule is the museum import's and knows nothing about worship: it
    // put the chapel into the palace it is housed in — the better-known name,
    // 147 m away — and the kind's verdict was asked of the palace only
    // afterwards, which refuses it as a `palace of the Popes`. The chapel and
    // Michelangelo's fresco went out of the catalogue with it. A fold may only
    // land on a place this kind could admit, so this one is dropped and the
    // chapel stands, admitted for the work it holds.
    expect(item(out, 'Q1034868')).toMatchObject({
      door: 'work',
      type: 'chapel',
      sitelinks: 17,
      admittedFor: { qid: 'Q1886263', label: 'The Crucifixion of Saint Peter' },
    });
    expect(worksOf(out, 'Q1034868')).toEqual(['Q1886263']);
    // The palace is still refused, and not as a fold loss: nothing folded into
    // it, so nothing was lost there.
    expect(item(out, 'Q145093')).toBeUndefined();
    expect(reason(out, 'Q145093')).toBe('not a place to visit: palace of the Popes');
    expect(reason(out, 'Q1034868')).toBeUndefined();
  });

  it('keeps a fold onto a place the rule admits and only the line leaves out', async () => {
    // The Temple of Amun at Karnak's shape on log 102: it folded into the
    // Precinct of Amun-Re, which the run never admits — not because the rule
    // refuses it (it is a `temple complex`) but because it has 18 sitelinks
    // against a line of 22. The test is the rule's, not the line's, so the fold
    // stands: a survivor the rule admits is admitted for any iconic work it
    // receives, and a work below the line was going to be written nowhere
    // either way.
    const w = world();
    w.places.Q863593.sitelinks = 19;
    w.works.Q1333433.sitelinks = 20;
    const out = await collect(w);

    expect(reason(out, 'Q588885')).toContain('folded into Santa Maria della Vittoria');
    expect(item(out, 'Q588885')).toBeUndefined();
    expect(item(out, 'Q863593')).toBeUndefined();
  });

  it('leaves the Creation of Adam to the Vatican Museums; the Sistine Chapel enters on its own fame', async () => {
    const out = await collect(world());

    expect(item(out, 'Q2943')).toMatchObject({ door: 'place', type: 'chapel' });
    expect(worksOf(out, 'Q2943')).toEqual([]);
    // A museum is not a place of worship, and it is not filed as a loss either.
    expect(item(out, 'Q182955')).toBeUndefined();
  });

  it('opens nothing for a lost work: the Temple of Zeus enters on its own fame only', async () => {
    const out = await collect(world());

    expect(item(out, 'Q197019')).toMatchObject({ door: 'place', type: 'temple' });
    expect(worksOf(out, 'Q197019')).toEqual([]);
  });

  it('admits Turin Cathedral, below the line at 20 sitelinks, through the relic it holds', async () => {
    const out = await collect(world());

    expect(item(out, 'Q958699')).toMatchObject({
      door: 'work',
      type: 'cathedral',
      sitelinks: 20,
      description: 'church building in Turin, Italy',
      countryLabel: 'Italy',
      admittedFor: { qid: 'Q178331', label: 'Shroud of Turin' },
    });
    expect(worksOf(out, 'Q958699')).toEqual(['Q178331']);
    expect(item(out, 'Q958699')?.artworks[0]?.treasureType).toBe('relic associated with Jesus');
  });

  it("refuses the Temple Mount and the Leaning Tower with the rule's own reasons", async () => {
    const out = await collect(world());

    expect(item(out, 'Q193163')).toBeUndefined();
    expect(reason(out, 'Q193163')).toContain('hill');
    // A tower is refused and offered to nobody: it is not Pisa Cathedral's
    // second visit and it is not one of the cathedral's treasures either, so
    // the cathedral enters on its own fame with nothing of ours in it.
    expect(item(out, 'Q39054')).toBeUndefined();
    expect(reason(out, 'Q39054')).toBe('a tower, not a place of worship: church tower');
    expect(item(out, 'Q1754247')).toMatchObject({ door: 'place', type: 'cathedral' });
    expect(worksOf(out, 'Q1754247')).toEqual([]);
  });

  it('admits a church below the line for the work it holds, and names the more famous of two', async () => {
    const out = await collect(world());

    // 20 sitelinks is under the line of 22, so nothing but the Caravaggios
    // admits it; both clear the line the source row states, and the card names
    // the better known one.
    expect(item(out, 'Q869513')).toMatchObject({
      door: 'work',
      type: 'church',
      sitelinks: 20,
      admittedFor: { qid: 'Q685916', label: 'Crucifixion of Saint Peter' },
    });
    expect(worksOf(out, 'Q869513')).toEqual(['Q685916', 'Q2273517']);
  });

  it('does not write a work that is itself a place as another place\'s treasure', async () => {
    const out = await collect(world());

    // The Cavern of the Patriarchs is a mosque and a synagogue that the tomb
    // tree also collects. It is a place a traveller goes to, so it enters at
    // door one — and it is nobody's treasure, however famous.
    expect(item(out, 'Q204200')).toMatchObject({ door: 'place', type: 'mosque' });
    expect(item(out, 'Q172077')).toMatchObject({ door: 'place' });
    expect(worksOf(out, 'Q172077')).toEqual([]);
    // And a row both pools named is one entity fetched: 14 places at the pool's
    // floor and 9 works, of which only the Cavern is in both.
    expect(out.fetched).toBe(22);
  });

  it('admits the Parthenon, which Wikidata also calls an archaeological site', async () => {
    const out = await collect(world());

    expect(item(out, 'Q10288')).toMatchObject({ door: 'place', type: 'temple' });
  });

  it('does not admit a place its own rule refuses, however famous the work it holds', async () => {
    // Wikidata does not type Turin Cathedral a hill. The case asks what the
    // rule does when a place that holds a treasure carries a kill class, which
    // the Temple Mount (mosque, hill) shows is a real shape — the kill list is
    // door one's, and the venue test that admits a holder does not carry it.
    const w = world();
    w.places.Q958699.classes = [CATHOLIC_CATHEDRAL, HILL];
    const out = await collect(w);

    expect(item(out, 'Q958699')).toBeUndefined();
    expect(reason(out, 'Q958699')).toContain('hill');
  });

  it('reads the line from the row: at 30 to enter, a place at 26 is out and the relic still admits its church', async () => {
    const w = world();
    w.places.Q197019.sitelinks = 26;
    const out = await collect(w, { line: { enterSitelinks: 30, staySitelinks: 25 } });

    expect(item(out, 'Q863593')).toMatchObject({ door: 'both' });
    expect(item(out, 'Q197019')).toBeUndefined();
    expect(item(out, 'Q958699')).toMatchObject({ door: 'work' });
    // The same line moves the works door: at 30 neither Caravaggio is iconic,
    // and their church — 20 sitelinks — is in by neither door.
    expect(item(out, 'Q869513')).toBeUndefined();
  });

  it('keeps an admitted row that slipped to the stay band and refuses one below it by name', async () => {
    const w = world();
    w.places.Q172077.sitelinks = 17;
    w.places.Q197019.sitelinks = 19;
    const out = await collect(w, { admitted: ['Q172077', 'Q197019'] });

    expect(item(out, 'Q197019')).toMatchObject({ door: 'place' });
    expect(item(out, 'Q172077')).toBeUndefined();
    expect(reason(out, 'Q172077'))
      .toBe("17 sitelinks: below the world tier's line (22 to enter, 18 to stay)");
  });

  it('says where the works it writes have moved since the last run', async () => {
    const out = await collect(world(), { previousPlacements: { Q235242: ['Q999'] } });

    expect(out.diff.moved).toEqual([{ work: 'Q235242', from: ['Q999'], to: ['Q12512'] }]);
  });
});
