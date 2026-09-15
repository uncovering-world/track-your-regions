/**
 * The museum door's second half: the verdict and the fold decision asked of
 * each other until neither moves, and the venue-side read asked of what the
 * verdict admits until nothing is new (#890).
 *
 * Split out of `pipeline.ts` at the seam the review of #890 named: the
 * pipeline is the collection and the union — what is fetched, in what order,
 * and how the two doors' answers are joined — and this is the loop over what
 * has already been fetched, plus the one read that loop adds. Nothing here
 * reads Wikidata except through `readVenueSide` and the row questions a museum
 * that arrived from it needs (`learnArrivedRows`).
 */

import { applyFolds, survivorOf } from '../museum/venueGraph.js';
import type { Fold } from '../museum/venueFolds.js';
import type { WorksCollection, WorksCollectorOptions } from '../museum/worksCollector.js';
import { readVenueSide, type RefusedHolding, type VenueSideRead } from '../museum/venueSide.js';
import type { PoolEntity } from '../publicArt/queries.js';
import type { QueryRunner } from '../wikidataQueries.js';
import {
  candidatesOf,
  readCategories,
  readClasses,
  rowsOf,
  type MuseumRow,
} from './museums.js';
import { judgeAllMuseums, type MuseumJudging } from './museumVerdict.js';

const LOG_PREFIX = '[Archaeology Sync]';

/** What one settled pass holds: the collection as its folds left it, and the verdict over it. */
export interface Settled {
  works: WorksCollection;
  verdict: ReturnType<typeof judgeAllMuseums>;
}

/**
 * The narrowing of the folds against the museums the run really writes —
 * **a fold stands only onto a survivor this run admits or holds; otherwise the
 * finds stay with the museum that held them.**
 *
 * Asked *after* the verdict, which is the whole reason it is a second step and
 * not a stricter `admits` in the pipeline's `foldsOntoAdmitted`. Worship can
 * test its admitted set before its folds because a place there is admitted for
 * its own fame or for a work of its own; this kind's admission depends on the
 * placements the fold produces — a find above the finds' line carries a museum
 * below the place line — so the set does not exist until the rule has run. The
 * nature test is what can be asked first, and it is weaker than it looks: a
 * survivor can be archaeological by class or category and still be a museum no
 * verdict is ever taken on, because nothing put it in a pool, no category named
 * it, and after the fold it holds only finds below the finds' line. The finds
 * moved onto it were then written nowhere and the museum they came from
 * arrived with an empty case.
 *
 * `null` where every fold's survivor is written, which is what ends the caller's
 * loop and what a run with nothing to drop answers on its first round.
 *
 * **Asked in a loop, because one more pass does not settle it.** Dropping a fold
 * does not merely give finds back: it un-folds one survivor into the several
 * museums that claimed those finds, and the holder cap is counted on the length
 * of that list (`selectTier1`). A find claimed by two museums inside one
 * container and by a third elsewhere is held by two venues while the container
 * stands and by three once it does not — over the cap, crediting nobody — so a
 * museum admitted for that find alone stops being admitted, and a fold whose
 * survivor it was must be dropped in its turn. The round has to be asked of the
 * answer the last one gave.
 *
 * What makes that reachable is the clause it is easy to miss: **the finds' line
 * is hysteretic too, so "below the line" is two lines and not one.** `judgeOne`
 * measures a find at the finds' *stay* line for a museum the source already
 * admits and at the *enter* line for one it does not, while the cap is applied
 * to every pool find before any line is read (`placedFinds`). A find **in the
 * band** — between the two — therefore carries a museum already in the catalogue
 * and leaves an unadmitted survivor uncarried: the unadmitted one goes unwritten
 * and its folds drop, the un-folding pushes that same find over the cap, and the
 * admitted one falls with it. Without the band the two would stand or fall
 * together and one pass would do.
 *
 * Two things do bound it, and they are why the loop is short. The fold map is a
 * forest (`breakFoldCycles`), so a chain-terminal survivor never itself gains a
 * fold; and every fold of one tree shares that terminal survivor, so a tree is
 * kept or dropped whole. Termination is simpler still: a round never puts a fold
 * back, so the kept set strictly shrinks.
 */
function keepFoldsOntoJudged(
  works: WorksCollection,
  written: ReadonlySet<string>,
): WorksCollection | null {
  const folds: Record<string, Fold> = {};
  let dropped = 0;
  for (const [qid, fold] of Object.entries(works.folds)) {
    if (written.has(survivorOf(works.folds, qid))) folds[qid] = fold;
    else dropped += 1;
  }
  if (dropped === 0) return null;
  console.log(
    `${LOG_PREFIX} kept ${dropped} museum(s) out of a fold onto a survivor this run does not write`,
  );
  return { ...works, folds, afterFolds: applyFolds(works.placed, folds) };
}

/**
 * The verdict and the fold decision asked of each other until neither moves.
 *
 * **To a fixed point, not once.** Dropping a fold un-folds a survivor back
 * into the several museums that claimed its finds, and the holder cap is
 * counted on that list (`selectTier1`, `MAX_HOLDERS`): a find claimed by two
 * museums inside one container and by a third elsewhere is under the cap while
 * the two are folded and over it once they are not, so it stops crediting
 * anybody — and the third museum, admitted for that find alone, silently
 * leaves. If it was itself the survivor of another kept fold, that fold's
 * museum would be reported as folded into a row the catalogue does not hold.
 * So each round is asked of the answer the last one gave.
 *
 * It terminates: a round either keeps every fold, or drops at least one and
 * never puts one back, so the kept set strictly shrinks and the empty set is
 * the floor. Nothing in a round reads Wikidata — the rows, the classes, the
 * categories and the finds were all read above — so the cost is a walk over
 * maps this run already holds, once per fold at worst.
 *
 * Asked more than once on a run (#890): over the pool's placements, and again
 * after each round of the venue-side read has merged what the admitted museums
 * hold.
 */
export function judgeToAFixedPoint(works: WorksCollection, judging: MuseumJudging): Settled {
  let verdict = judgeAllMuseums(works, judging);
  for (;;) {
    const kept = keepFoldsOntoJudged(works, new Set(verdict.items.map((item) => item.qid)));
    if (!kept) break;
    works = kept;
    verdict = judgeAllMuseums(works, judging);
  }
  return { works, verdict };
}

/**
 * The venue-side rounds as one read, for the report: every object kept and
 * refused across them, each once, holding everything every round learned
 * about it. A museum read in a later round can hold an object an earlier
 * round already met — refused at A in round one, met again at B in round two
 * — and the report has to name both holders, which is the half of it #891
 * reads; a refusal named twice would count twice. The collection is the last
 * round's, which holds them all.
 */
function mergeRounds(
  rounds: VenueSideRead[],
  collection: WorksCollection,
  reportFloor: number,
): VenueSideRead {
  const merged = <V>(maps: Map<string, V>[]): Map<string, V> => new Map(maps.flatMap((m) => [...m]));
  const unionOf = <V extends { qid: string }>(maps: Map<string, V[]>[]): Map<string, V[]> => {
    const out = new Map<string, V[]>();
    for (const map of maps) {
      for (const [qid, entries] of map) {
        const known = out.get(qid) ?? [];
        out.set(qid, [...known, ...entries.filter((e) => !known.some((k) => k.qid === e.qid))]);
      }
    }
    return out;
  };
  const heldBy = new Map<string, string[]>();
  for (const round of rounds) {
    for (const [qid, venues] of round.heldBy) {
      heldBy.set(qid, [...new Set([...(heldBy.get(qid) ?? []), ...venues])]);
    }
  }
  const classes = unionOf(rounds.map((r) => r.classes));
  // Each refusal once, carrying every holder and every class the rounds saw.
  const byQid = (lists: RefusedHolding[][]): RefusedHolding[] => {
    const out = new Map<string, RefusedHolding>();
    for (const entry of lists.flat()) {
      if (!out.has(entry.qid)) {
        out.set(entry.qid, {
          ...entry,
          heldBy: heldBy.get(entry.qid) ?? entry.heldBy,
          classes: classes.get(entry.qid) ?? entry.classes,
        });
      }
    }
    return [...out.values()];
  };
  return {
    collection,
    kept: merged(rounds.map((r) => r.kept)),
    refused: byQid(rounds.map((r) => r.refused)),
    reported: byQid(rounds.map((r) => r.reported)),
    facts: merged(rounds.map((r) => r.facts)),
    heldBy,
    classes,
    reportFloor,
    counts: {
      venues: rounds.reduce((n, r) => n + r.counts.venues, 0),
      held: rounds.reduce((n, r) => n + r.counts.held, 0),
      alreadyInPool: rounds.reduce((n, r) => n + r.counts.alreadyInPool, 0),
    },
  };
}

/** What the venue-side rounds read beside the pool: the candidate maps the verdict reads, extended as museums arrive. */
export interface HoldingsContext {
  pool: Map<string, PoolEntity>;
  members: ReadonlySet<string>;
  rows: Map<string, MuseumRow>;
  classes: Map<string, string[]>;
  categories: Map<string, string[]>;
  /** English Wikipedia's categories for a batch of titles: the pipeline's own door, handed in. */
  categoriesDoor: (titles: string[]) => Promise<Map<string, string[]>>;
  reportFloor: number;
}

/**
 * The venue-side read, asked until every museum the verdict admits has been
 * read (#890). An object read at one museum can carry another over the line
 * — its statements name a second holder, which the next verdict admits for it
 * — and that museum's own holdings are then unread. So each round reads what
 * the last verdict admitted that no round has read, gives the museums that
 * arrived a row from the extended graph (their classes off it, their
 * categories from Wikipedia, for the few there are), judges again, and stops
 * when nothing is new. It terminates: the set of museums read only grows, and
 * every one of them is a candidate of a finite pass. What an earlier round
 * refused is handed to the next as its skip set, so an object two museums hold
 * is fetched and judged once and its second holder still recorded.
 */
export async function readAdmittedHoldings(
  run: QueryRunner,
  settled: Settled,
  options: WorksCollectorOptions,
  judging: MuseumJudging,
  ctx: HoldingsContext,
): Promise<Settled & { side: VenueSideRead }> {
  const read = new Set<string>();
  const refused = new Set<string>();
  const rounds: VenueSideRead[] = [];
  let { works, verdict } = settled;
  for (;;) {
    const unread = verdict.items
      .map((item) => item.qid)
      .filter((qid) => !works.folds[qid] && !read.has(qid));
    if (!unread.length) break;
    for (const qid of unread) read.add(qid);
    const round = await readVenueSide(run, works, options, {
      admitted: unread, reportFloor: ctx.reportFloor, skip: refused,
    });
    rounds.push(round);
    for (const refusal of round.refused) refused.add(refusal.qid);
    await learnArrivedRows(run, round.collection, ctx);
    ({ works, verdict } = judgeToAFixedPoint(round.collection, judging));
  }
  return { works, verdict, side: mergeRounds(rounds, works, ctx.reportFloor) };
}

/** A row, its classes and its categories for every candidate a round brought in that had none. */
async function learnArrivedRows(
  run: QueryRunner,
  collection: WorksCollection,
  ctx: HoldingsContext,
): Promise<void> {
  const arrived = [...candidatesOf(ctx.pool, collection, ctx.members)].filter((qid) => !ctx.rows.has(qid));
  for (const [qid, row] of rowsOf(arrived, ctx.pool, collection.graph)) ctx.rows.set(qid, row);
  const arrivedRows = new Map([...ctx.rows].filter(([qid]) => arrived.includes(qid)));
  if (!arrivedRows.size) return;
  for (const [qid, cls] of await readClasses(run, [...arrivedRows.keys()], collection.graph)) {
    ctx.classes.set(qid, cls);
  }
  for (const [qid, cats] of await readCategories(run, ctx.categoriesDoor, arrivedRows)) {
    ctx.categories.set(qid, cats);
  }
}
