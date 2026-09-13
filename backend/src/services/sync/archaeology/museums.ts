/**
 * Which museums this run may have to judge, and everything it knows about each
 * one before the rule is asked.
 *
 * Two questions meet here. A museum reaches this kind's verdict either because
 * the class question named it — the pool — or because it holds a find the world
 * knows (ADR-0058 decision 2), and the two arrive by different roads: a pool row
 * carries its own label, coordinate and article, while a holder is an entity of
 * the venue graph the finds pointed at. What the rule reads of both is the same
 * three facts: the classes, the categories, and where the museum stands.
 *
 * The stage `worship/places.ts` is to that kind's first door, without its fame
 * line: the line is the verdict's (`museumTest.ts`), because a find above the
 * finds' own line can carry a museum below the place line, and that is one
 * decision rather than two.
 */

import { placedUnderCap, selectTier1 } from '../museum/tier1.js';
import { heldBy, type WorksCollection } from '../museum/worksCollector.js';
import type { PoolWork } from '../museum/queries.js';
import { survivorOf, type VenueGraph } from '../museum/venueGraph.js';
import { fetchEntityFacts, type PoolEntity } from '../publicArt/queries.js';
import { enwikiTitleOf } from '../wikipediaCategories.js';
import { chunk, type QueryRunner } from '../wikidataQueries.js';
import type { MuseumFacts } from './museumTest.js';
import type { LinePair } from '../sourceLine.js';

const FACT_BATCH = 50;

/** Everything a pin needs about a museum, from whichever pool named it. */
export interface MuseumRow {
  label: string;
  description: string | null;
  lat: number | null;
  lon: number | null;
  onEarth: boolean;
  imageUrl: string | null;
  sitelinks: number;
  countryLabel: string | null;
  articleUrl: string | null;
  website: string | null;
}

/**
 * Which venues each find is placed at, once the cap on how many may claim one
 * work has been applied (`placedUnderCap`).
 *
 * No `multipleMedium` is offered: the cap exists for the editions a print or a
 * cast comes in, and nothing that was dug up exists in an edition.
 */
function placedFinds(
  works: WorksCollection,
  placements: Record<string, string[]>,
): Record<string, string[]> {
  const placed: Record<string, string[]> = {};
  for (const find of works.pool.values()) {
    const venues = placements[find.qid] ?? [];
    if (placedUnderCap({ qid: find.qid, sitelinks: find.sitelinks, venues })) {
      placed[find.qid] = venues;
    }
  }
  return placed;
}

/**
 * What each museum is **credited** with, most famous first — the finds the cap
 * places, and no others.
 *
 * The cap binds the credit and never the card. What a museum *lists* is the
 * shared `heldBy` over the raw placements, as the art import lists it
 * (`museum/pipeline.ts`): a group of sculptures split between Athens and London
 * is worth seeing in both rooms, and a hoard dropped from every card because
 * three museums hold pieces of it tells a traveller less than the source knows.
 *
 * What the cap settles is whether a museum may be admitted or badged *for* a
 * find. The verdict reads this map three times over — the door's count of
 * famous finds, the badge's count at the enter line, and the find a museum
 * below the place line is admitted for — because `findHolders` asks
 * `selectTier1`, which admits nobody for a unique work more venues than the cap
 * claim. Read off the listing instead, a museum that reached the verdict by its
 * class or its category would be admitted and badged for the very find the same
 * run says admits nobody: one find with two answers, decided by the road the
 * museum arrived on.
 */
export function findsHeldBy(
  works: WorksCollection,
  placements: Record<string, string[]>,
): Map<string, PoolWork[]> {
  return heldBy(works.pool, placedFinds(works, placements));
}

/**
 * The venues a find above the finds' line admits, as the museum tier selects
 * them, restricted to rows the venue graph knows with coordinates of their own.
 */
export function findHolders(
  works: WorksCollection,
  placements: Record<string, string[]>,
  threshold: number,
): Set<string> {
  const tier = selectTier1([...works.pool.values()].map((find) => ({
    qid: find.qid,
    sitelinks: find.sitelinks,
    venues: placements[find.qid] ?? [],
  })), { threshold });

  const holders = new Set<string>();
  for (const qid of tier.museums.keys()) {
    const row = works.graph.details.get(qid);
    if (row && row.lat !== null && row.lon !== null) holders.add(qid);
  }
  return holders;
}

/**
 * Who the finds carry to the verdict: the holders at the enter line, and — for a
 * museum the source already admits — the holders at the finds' *stay* line.
 *
 * The find door is hysteretic like every other line this catalogue draws
 * (ADR-0023, `sourceLine.ts`): Delphi is in the world tier for the Charioteer,
 * and the first time the Charioteer slips from 18 articles to 17 the museum must
 * not fall out of the catalogue. A museum the source has never admitted is
 * judged at the enter line alone, so the band between the two lines widens
 * nothing.
 */
export function findJudged(
  works: WorksCollection,
  placements: Record<string, string[]>,
  findLine: LinePair,
  admitted: ReadonlySet<string>,
): Set<string> {
  const holders = findHolders(works, placements, findLine.enterSitelinks);
  for (const qid of findHolders(works, placements, findLine.staySitelinks)) {
    if (admitted.has(qid)) holders.add(qid);
  }
  return holders;
}

/**
 * Whose classes and categories this run has to read: the pool, the holders of a
 * find above the line, and every survivor a fold names.
 *
 * The holders are asked of the placements on both sides of the folds, because
 * the fold filter can hand a museum its finds back — a museum whose fold is
 * dropped holds again what it held before the folds ran.
 *
 * The survivors are here because the fold filter asks what each of them *is*
 * before any of this is settled, and a survivor with no facts read would answer
 * `none` for want of an answer rather than because of one: a door is a museum no
 * work ever names (Palazzo Pitti, the Vatican Museums), so nothing else brings
 * it into this set at all.
 */
export function candidatesOf(
  pool: Map<string, PoolEntity>,
  works: WorksCollection,
  findLine: LinePair,
  admitted: ReadonlySet<string>,
): Set<string> {
  return new Set([
    ...pool.keys(),
    ...findJudged(works, works.placed, findLine, admitted),
    ...findJudged(works, works.afterFolds, findLine, admitted),
    ...Object.keys(works.folds).map((qid) => survivorOf(works.folds, qid)),
  ]);
}

/**
 * What a pin needs about each candidate, from the pool row that named it or
 * from the venue graph a find pointed at.
 *
 * `onEarth` is true for a graph row for the reason worship's `admitVenues`
 * gives: the graph does not record which globe a coordinate is on, and reaching
 * it at all required one.
 */
export function rowsOf(
  qids: Iterable<string>,
  pool: Map<string, PoolEntity>,
  graph: VenueGraph,
): Map<string, MuseumRow> {
  const rows = new Map<string, MuseumRow>();
  for (const qid of qids) {
    const entity = pool.get(qid);
    if (entity) {
      rows.set(qid, entity);
      continue;
    }
    const row = graph.details.get(qid);
    if (row) rows.set(qid, { ...row, onEarth: true });
  }
  return rows;
}

/**
 * Every `P31` of each candidate: off the venue graph where it knows the entity,
 * and asked of Wikidata for the rest, in batches of fifty.
 *
 * The graph carries the classes of every entity a find pointed at — it is what
 * `venueVerdict` judged them by, and worship's `graphVerdict` reads them the same
 * way — so a holder costs no query here. A pool row does: it arrives as a label
 * and a coordinate with no classes at all, and the class is half of what this
 * kind reads a museum's nature off. The containers and makers the question also
 * answers with are not read — a museum's nature is what it is, not what it is
 * inside.
 */
export async function readClasses(
  run: QueryRunner,
  qids: string[],
  graph: VenueGraph,
): Promise<Map<string, string[]>> {
  const classes = new Map<string, string[]>();
  const ask: string[] = [];
  for (const qid of qids) {
    const known = graph.facts(qid);
    if (known) classes.set(qid, known.classes);
    else ask.push(qid);
  }
  const batches = chunk(ask, FACT_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(`Asking what each museum is (batch ${i + 1}/${batches.length})...`);
    await run.step();
    for (const [qid, row] of await fetchEntityFacts(run.sparql, batches[i])) {
      classes.set(qid, row.classes);
    }
  }
  return classes;
}

/**
 * What English Wikipedia files each candidate's article under, in one ask.
 *
 * One call for every museum at once, because the door batches inside itself: a
 * museum read in the wrong batch is a museum with no categories, which is a
 * museum this kind refuses. One with no English article keeps an empty list and
 * is judged by its class alone (ADR-0058's consequences name that price).
 */
export async function readCategories(
  run: QueryRunner,
  ask: (titles: string[]) => Promise<Map<string, string[]>>,
  rows: Map<string, MuseumRow>,
): Promise<Map<string, string[]>> {
  const titles = new Map<string, string>();
  for (const [qid, row] of rows) {
    const title = enwikiTitleOf(row.articleUrl);
    if (title) titles.set(qid, title);
  }
  run.phase('Reading what English Wikipedia says these museums are about...');
  await run.step();
  const answered = await ask([...new Set(titles.values())]);

  const categories = new Map<string, string[]>();
  for (const qid of rows.keys()) {
    const title = titles.get(qid);
    categories.set(qid, (title ? answered.get(title) : undefined) ?? []);
  }
  return categories;
}

/** The facts the rule reads about one museum, from the three questions that answered. */
export function factsOf(
  qid: string,
  rows: Map<string, MuseumRow>,
  classes: Map<string, string[]>,
  categories: Map<string, string[]>,
): MuseumFacts {
  const row = rows.get(qid);
  return {
    qid,
    classes: classes.get(qid) ?? [],
    categories: categories.get(qid) ?? [],
    lat: row?.lat ?? null,
    lon: row?.lon ?? null,
  };
}

/**
 * Where a museum the rule admitted stands, or why it cannot be a pin at all.
 *
 * The venue graph refuses a holder with no coordinates of its own before it ever
 * reaches the run (`venueVerdict`), but a pool row never passes through it — and
 * an admitted row asked for by id is asked precisely because Wikidata may have
 * stopped placing it (`collectMuseumPool`). Refused in the words every other
 * kind refuses a placeless row with, and refused rather than dropped: a row the
 * source holds deserves a reason of its own.
 */
export function placementOf(row: MuseumRow): { lat: number; lon: number } | { reason: string } {
  if (!row.onEarth) {
    return { reason: 'not on Earth: its coordinate (P625) is on another globe' };
  }
  if (row.lat === null || row.lon === null) {
    return { reason: 'no coordinates of its own (P625)' };
  }
  return { lat: row.lat, lon: row.lon };
}
