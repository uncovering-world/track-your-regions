/**
 * What one archaeology museum's fate is: the rule over a candidate, the row it
 * becomes, and the same asked of every candidate one pass named.
 *
 * Split out of `pipeline.ts` at the seam that file named (#581's final pass).
 * The pipeline is the collection and the union — what is fetched, in what
 * order, and how the two doors' answers are joined — and this is the verdict
 * taken over what has already been fetched. Nothing here reads Wikidata, which
 * is exactly why the whole of it can be asked twice on a run where a fold is
 * dropped: a second pass is a second walk over maps the run already holds.
 *
 * Nothing here decides what an archaeology museum *is*, either: the nature, the
 * vetoes and the line are `museumTest.ts`, the lists are `classes.ts`. This
 * module composes those answers with what each museum holds.
 */

import { heldBy, toContent, type WorksCollection } from '../museum/worksCollector.js';
import type { PoolWork } from '../museum/queries.js';
import { findJudged, findsHeldBy, placementOf, type MuseumRow } from './museums.js';
import {
  isMuseumOnWikidata,
  museumNature,
  museumVerdict,
  NOT_A_MUSEUM,
  type MuseumFacts,
  type MuseumNature,
  type MuseumNatureOrVeto,
} from './museumTest.js';
import type { FindFacts } from './finds.js';
import type { ArchaeologyTrees } from './classes.js';
import { lineStanding, type LinePair, type SourceLine } from '../sourceLine.js';
import type { FilteredEntity } from '../syncOrchestrator.js';
import type { ProcessedContent } from '../types.js';

export interface CollectedArchaeologyMuseum {
  qid: string;
  label: string;
  description: string | null;
  lat: number;
  lon: number;
  imageUrl: string | null;
  sitelinks: number;
  countryLabel: string | null;
  articleUrl: string | null;
  website: string | null;
  /** This kind's other type is the site (ADR-0058 decision 1), which is another door. */
  type: 'museum';
  classes: string[];
  /** What English Wikipedia files the article under; empty where it has none. */
  categories: string[];
  nature: 'archaeological' | 'department';
  /** The signal the nature was read off, so the card can say why. */
  natureWhy: string;
  /** Present on a held row: the question the card shows a curator. */
  admissionNote: string | null;
  /** What it holds that the world knows, with where each was dug up. */
  treasures: ProcessedContent[];
  /**
   * How many of those finds are at or above the finds' **enter** line, kept
   * rather than left to be worked out again from `treasures` and a line this
   * item does not carry.
   *
   * It is what says whether the museum holds a masterpiece, and the badge is
   * the masterpiece (ADR-0045 decision 5): the run badges a museum with one and
   * leaves the Bardo, in the catalogue on its own 35 articles, in the kind
   * without a badge. Not `treasures.length`: a museum arrives with everything
   * it holds, however famous. And not the count the *verdict* was taken on,
   * which forgives a slip to the stay line so an admitted museum does not fall
   * out — the badge grants nothing for a slip, because the same enter line
   * decides each find's own flag where the treasures are written (`judgeOne`).
   */
  findsAboveLine: number;
  /** The most famous find it holds, where a find is what carried it over the line. */
  admittedFor?: { qid: string; label: string };
}

/** A nature this kind admits: one of the two answers that carry a reason. */
type AdmittedNature = Extract<MuseumNature, { why: string }>;

/**
 * Whether a nature is one this kind admits at all: not a veto, and not nothing.
 *
 * A department counts. The Hermitage and the Vatican Museums arrive **held**
 * rather than refused (ADR-0058 decision 2) — a question for a curator, not a
 * museum kept out — and a held survivor is the name on the ticket all the same.
 */
export const isThisKind = (nature: MuseumNatureOrVeto): nature is AdmittedNature =>
  !('veto' in nature) && nature.nature !== 'none';

/** A find as this kind stores it: the museum import's treasure, saying where it was dug up. */
const treasureOf = (find: PoolWork, facts: Map<string, FindFacts>): ProcessedContent => ({
  ...toContent(find),
  foundAt: facts.get(find.qid)?.discoveryPlace ?? null,
});

/**
 * What the run read once, before any pass: everything a verdict needs that does
 * not change when a fold is dropped.
 *
 * Built by the pipeline, which is where all of it was fetched, and handed back
 * unchanged for the second pass.
 */
export interface MuseumJudging {
  trees: ArchaeologyTrees;
  facts: (qid: string) => MuseumFacts;
  /** What is known about each candidate, by id: the pipeline's `rowsOf`. */
  rows: Map<string, MuseumRow>;
  /**
   * Every candidate the pool and the category walk named, before the holders of
   * a find join them — the part of the judged set that does not depend on which
   * folds a pass is judging.
   */
  named: Iterable<string>;
  /**
   * Whether English Wikipedia's categories named this museum, and so whether
   * Wikidata has to call it a museum too (`isMuseumOnWikidata`). Asked of every
   * member and not only of those nothing else knows: the venue graph holds
   * every entity a work points at, refused venues included, so a dig one find
   * names in situ is in it exactly as a museum is. What another road really did
   * vouch for passes the gate by construction (`CategoryMembers`).
   */
  namedByCategory: (qid: string) => boolean;
  /** What a museum may be, as the museum import's own closure answers. */
  museumClasses: ReadonlySet<string>;
  findFacts: Map<string, FindFacts>;
  admitted: ReadonlySet<string>;
  line: SourceLine;
  findLine: LinePair;
}

/**
 * That, plus the two maps one pass builds off the placements it is judging.
 *
 * **Two maps and not one**, as the art import keeps two (`buildItems` lists
 * `heldBy` while `tier.museums` admits): `held` is everything a find's
 * statements place at a museum, whatever the holder cap says, and is the card —
 * a hoard split between Athens and London is a real thing to go and see in
 * both, and dropping it from both cards would tell a traveller less than the
 * source knows. `credited` is the same map with the cap applied, and the three
 * counts a verdict is taken on are read off it: what the cap settles is only
 * whether a museum may be admitted or badged *for* a find.
 */
interface Judging extends MuseumJudging {
  held: Map<string, PoolWork[]>;
  credited: Map<string, PoolWork[]>;
}

function itemOf(input: {
  qid: string;
  row: MuseumRow;
  at: { lat: number; lon: number };
  facts: MuseumFacts;
  nature: AdmittedNature;
  note: string | null;
  finds: PoolWork[];
  findsAboveLine: number;
  admittedFor: PoolWork | undefined;
  findFacts: Map<string, FindFacts>;
}): CollectedArchaeologyMuseum {
  const { qid, row, at, facts, nature, note, finds, findsAboveLine, admittedFor, findFacts } = input;
  return {
    qid,
    label: row.label,
    description: row.description,
    lat: at.lat,
    lon: at.lon,
    imageUrl: row.imageUrl,
    sitelinks: row.sitelinks,
    countryLabel: row.countryLabel,
    articleUrl: row.articleUrl,
    website: row.website,
    type: 'museum',
    classes: facts.classes,
    categories: facts.categories,
    nature: nature.nature,
    natureWhy: nature.why,
    admissionNote: note,
    treasures: finds.map((find) => treasureOf(find, findFacts)),
    findsAboveLine,
    admittedFor: admittedFor ? { qid: admittedFor.qid, label: admittedFor.label } : undefined,
  };
}

/**
 * One museum's fate: admitted, refused by name, or nothing at all — the last
 * being `museumVerdict`'s `out`, a museum nobody has heard of that the source
 * never admitted, on which no rule ran. Naming those would bury the refusals a
 * curator has to read under the long tail.
 */
function judgeOne(
  qid: string,
  row: MuseumRow,
  ctx: Judging,
): { item: CollectedArchaeologyMuseum } | { refusal: FilteredEntity } | null {
  const facts = ctx.facts(qid);
  const refusal = (reason: string) => ({ refusal: { externalId: qid, name: row.label, reason } });

  // What walked in through the editorial shelf is asked whether Wikidata calls
  // it a museum at all: Wikipedia files Pompeii, Sforza Castle and Chichén
  // Itzá under `Archaeological museums in …`, and nothing else in the rule
  // refuses them.
  //
  // Named only where the world has heard of it, which is `lineStanding`'s
  // answer and no second rule: the 27 sites at or above the place line are a
  // worklist the site door will want (ADR-0058 decision 4), while a country's
  // whole archaeology named one row at a time is the long tail that buries the
  // refusals a curator reads — a report nobody finishes is the same silence in
  // a louder voice. An admitted row reaches this gate like any other: the pool
  // carries what the source already admits and the category names it again, so
  // a classless row that has slipped is held to the stay line exactly as the
  // verdict below holds every other, and `fell` names it with its number — a
  // row that leaves the catalogue leaves it with a reason.
  if (ctx.namedByCategory(qid) && !isMuseumOnWikidata(facts, ctx.museumClasses)) {
    const standing = lineStanding(row.sitelinks, ctx.admitted.has(qid), ctx.line);
    return standing === 'out' ? null : refusal(NOT_A_MUSEUM);
  }

  const nature = museumNature(facts, ctx.trees);
  // **The cap binds what a museum is credited with, never what its card lists.**
  // Everything the finds place here is listed and written as this museum's
  // treasures, as the art import lists `heldBy` whatever `selectTier1` did with
  // it: a group of sculptures split between Athens and London is worth seeing in
  // both rooms. The three counts come off `credited` instead — the door's
  // `famous`, the badge's `aboveEnter`, and the `admittedFor` a museum below the
  // place line is carried in by — because a find claimed by more venues than the
  // cap allows admits none of them through `findJudged`, and a museum that
  // arrived by its class or its category must not be admitted and badged for the
  // very find the same run says admits nobody.
  const finds = ctx.held.get(qid) ?? [];
  const credited = ctx.credited.get(qid) ?? [];
  // The find door is hysteretic too: a museum the source already admits keeps
  // its find while the find is above the finds' *stay* line, so Delphi does not
  // fall out the first time the Charioteer slips from 18 articles to 17.
  const above = ctx.admitted.has(qid) ? ctx.findLine.staySitelinks : ctx.findLine.enterSitelinks;
  const famous = credited.filter((find) => find.sitelinks >= above);
  // And the badge counts at the *enter* line, hysteresis or none. Two
  // questions, two numbers: whether the museum stays is the door's, and it
  // forgives a slip; whether it wears the must-see badge is the masterpiece's,
  // and the same enter line decides the find's own flag in the treasure writer.
  // Counted hysteretically, an admitted museum would be badged for a find at 16
  // that the writer leaves unbadged — a museum marked must-see for a work shown
  // without the mark, which ADR-0045 decision 5 and ADR-0023 decision 2 forbid
  // between them.
  //
  // The band the other way is accepted as under-badging: a find that slips from
  // 18 to 16 keeps its own flag (the writer's stay line holds it) while the
  // museum stops counting it, so the museum can stand unbadged beside a badged
  // find. That way round misses a badge; the other claims one the catalogue
  // cannot show.
  const aboveEnter = credited.filter(
    (find) => find.sitelinks >= ctx.findLine.enterSitelinks,
  ).length;

  const verdict = museumVerdict({
    facts,
    sitelinks: row.sitelinks,
    findsForTheDoor: famous.length,
    nature,
    admitted: ctx.admitted,
    line: ctx.line,
  });
  if (!verdict.pass) return 'out' in verdict ? null : refusal(verdict.reason);
  const at = placementOf(row);
  if ('reason' in at) return refusal(at.reason);
  // Unreachable: `museumVerdict` refuses a veto and a `none` above. The check is
  // how the compiler learns what the verdict already decided.
  if (!isThisKind(nature)) return null;

  return {
    item: itemOf({
      qid,
      row,
      at,
      facts,
      nature,
      note: verdict.held ? verdict.note : null,
      finds,
      // The badge's count, not the door's: the verdict above was taken on the
      // hysteretic one, and this is the one the treasure writer will read of
      // each find (ADR-0045 decision 5). Carried rather than worked out again
      // from the treasures, which arrive without a line to measure against.
      findsAboveLine: aboveEnter,
      // A find is what got it in only where the museum's own fame did not
      // (ADR-0058 decision 2), and then the card names the most famous of them.
      //
      // Asked of the enter line alone, and not of the row's standing: the place
      // line is hysteretic, so an admitted museum at 21 *stands* in — and it
      // could not have entered on 21, since the line to enter is 22. What
      // carried Heraklion in was the Phaistos disc, and on the next run the disc
      // is still what a museum below the enter line is in the catalogue for.
      // Read off the standing, the run named the disc once and cleared it on
      // every run after (#896): the museum's own count forgiving a slip was
      // read as its reason, and the upsert writes what the run brings.
      //
      // Deterministic rather than remembered: the same facts name the same find
      // whether this is the museum's first run or its tenth, so a name the bug
      // already cleared comes back by a run and not by hand. And a museum in
      // the band whose find has fallen below the finds' stay line names nothing
      // — `famous` is empty — and stays on its own count, which is then truly
      // what keeps it.
      admittedFor: row.sitelinks >= ctx.line.enterSitelinks ? undefined : famous[0],
      findFacts: ctx.findFacts,
    }),
  };
}

/**
 * The whole verdict over one set of placements: who is judged, what each museum
 * holds and is credited with, and what the rule made of each.
 *
 * Asked twice on a run where a fold is dropped, which is why it takes the
 * placements as an argument and everything else as the context the pipeline
 * read once. The order is by fame, because that is the order a curator reads
 * the refusals in.
 */
export function judgeAllMuseums(
  works: WorksCollection,
  context: MuseumJudging,
): { items: CollectedArchaeologyMuseum[]; refused: FilteredEntity[] } {
  // The listing and the credit, off the same placements (`Judging`).
  const ctx: Judging = {
    ...context,
    held: heldBy(works.pool, works.afterFolds),
    credited: findsHeldBy(works, works.afterFolds),
  };
  const judged = [
    ...new Set([
      ...context.named,
      ...findJudged(works, works.afterFolds, context.findLine, context.admitted),
    ]),
  ].sort((a, b) => (ctx.rows.get(b)?.sitelinks ?? 0) - (ctx.rows.get(a)?.sitelinks ?? 0));

  const items: CollectedArchaeologyMuseum[] = [];
  const refused: FilteredEntity[] = [];
  for (const qid of judged) {
    const row = ctx.rows.get(qid);
    if (!row) {
      // Unreachable, and `candidatesOf` is what makes it so — provably, now.
      // Everything this loop judges comes from the pool, the category walk, or
      // a find's holders under whichever fold set the round is judging. A
      // holder's qid is a value of `applyFolds(works.placed, folds)`, and
      // `applyFolds` maps each venue to itself or to its fold's survivor, so
      // every holder under *any* fold set is a value of `works.placed` or a
      // survivor of a fold — and the candidate set is exactly those two plus
      // the pool, the members and the fold sources.
      //
      // Not the holders at the two extreme fold sets, which is not the same
      // set: the holder cap counts a find's venue list and a kept fold merges
      // two venues into one, so a partial set can name a venue neither
      // extreme does (#888).
      //
      // Said out loud rather than dropped — a museum that vanished between two
      // stages of one run is a defect, not a verdict.
      refused.push({ externalId: qid, name: qid, reason: `no row to judge: ${qid}` });
      continue;
    }
    const judgement = judgeOne(qid, row, ctx);
    if (judgement && 'item' in judgement) items.push(judgement.item);
    if (judgement && 'refusal' in judgement) refused.push(judgement.refusal);
  }
  return { items, refused };
}
