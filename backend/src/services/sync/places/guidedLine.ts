/**
 * A fame line with two doors on the same editions (#1860, #1867): a year's
 * readers, or fewer readers where a Wikivoyage guide names the place. A
 * disaster fills a year of readers and an expressway can be read as much as a
 * street a traveller crosses a city for; a guide naming the place is what
 * tells them apart. Each kind states its own numbers, chosen on its own
 * reading and checked against its own canon (`docs/tech/catalogue-coverage.md`);
 * this module holds how they are read, and the classifier
 * every such kind runs over its share.
 */

import type { FilteredEntity } from '../syncContract.js';
import type { WikidataLandmark } from '../types.js';
import type { KindShare } from './gather.js';
import { placeLandmark, yearlyReaders } from './candidates.js';
import { latestUsage, usedByAGuide } from '../../dumps/wikivoyage/usageTables.js';

/** One side of the line: the editions, and the readers with and without a guide. */
export interface Door {
  editions: number;
  readers: number;
  guidedReaders: number;
}

export interface GuidedLine {
  enter: Door;
  stay: Door;
}

export type Standing = 'in' | 'out' | 'fell';

const clears = (door: Door, editions: number, readers: number, guided: boolean) =>
  editions >= door.editions && readers >= (guided ? door.guidedReaders : door.readers);

/**
 * Where a candidate stands against the line. `readers` is null when no year of
 * readership can be read: nothing new enters, and a place the source holds
 * keeps its place on the stay line's editions until a year can be read again.
 */
export function guidedStanding(
  line: GuidedLine, editions: number, readers: number | null, guided: boolean, admitted: boolean,
): Standing {
  if (readers === null) {
    if (!admitted) return 'out';
    return editions >= line.stay.editions ? 'in' : 'fell';
  }
  if (clears(line.enter, editions, readers, guided)) return 'in';
  if (!admitted) return 'out';
  return clears(line.stay, editions, readers, guided) ? 'in' : 'fell';
}

/** The refusal of a place that fell below the line, with its measures and both lines named. */
export function belowGuidedLine(line: GuidedLine, editions: number, readers: number | null, guided: boolean): string {
  const read = readers === null ? 'no year of readers read' : `${readers.toLocaleString('en')} readers a year`;
  const guide = guided ? 'named by a Wikivoyage guide' : 'named by no Wikivoyage guide';
  const { enter, stay } = line;
  return `${editions} Wikipedia editions and ${read}, ${guide}: below the line (${enter.editions} editions and `
    + `${enter.readers.toLocaleString('en')} readers to enter, ${enter.guidedReaders.toLocaleString('en')} with a guide; `
    + `${stay.editions} and ${stay.readers.toLocaleString('en')}, ${stay.guidedReaders.toLocaleString('en')} with a guide, to stay)`;
}

/** The candidates a Wikivoyage edition uses; none while no usage build is in place, which shuts the guide door. */
export async function guidedOf(qids: string[], logPrefix: string): Promise<ReadonlySet<string>> {
  if (!(await latestUsage())) {
    console.log(`${logPrefix} No Wikivoyage usage is built: the guide door is shut`);
    return new Set();
  }
  return usedByAGuide(qids);
}

/** A kind's verdict on one candidate: the type it is filed under, or why it is refused. */
export type PlaceVerdict<Type extends WikidataLandmark['type']> = { pass: true; type: Type } | { pass: false; reason: string };

/** What a kind with a two-door line decides by. */
export interface GuidedKind<Trees, Type extends WikidataLandmark['type']> {
  verdict(facts: { classes: readonly string[]; onEarth: boolean; lat: number | null; lon: number | null }, trees: Trees): PlaceVerdict<Type>;
  line: GuidedLine;
  /**
   * The line a candidate of these classes is held to, where the kind holds
   * some of its candidates to a line of their own (#1947: a canal's lock or
   * lift); `line` otherwise.
   */
  lineFor?(classes: readonly string[], trees: Trees): GuidedLine;
  /** Names the kind in the run's log, `[Bridges]`. */
  logPrefix: string;
}

/**
 * Decide from a kind's share: the rule, then the line. Items come back most
 * famous first. `read` hands the readers and the guided candidates in, for a
 * measurement; a run reads them itself.
 */
export async function classifyByGuidedLine<Trees, Type extends WikidataLandmark['type']>(
  { trees, pool, facts }: KindShare<Trees>,
  admitted: ReadonlySet<string>,
  kind: GuidedKind<Trees, Type>,
  read?: { readers: Map<string, number> | null; guided: ReadonlySet<string> },
): Promise<{ items: WikidataLandmark[]; fetched: number; filtered: FilteredEntity[] }> {
  const qids = [...pool.keys()];
  const readers = read ? read.readers : await yearlyReaders(qids, kind.logPrefix);
  const guided = read ? read.guided : await guidedOf(qids, kind.logPrefix);
  if (readers === null) console.log(`${kind.logPrefix} Nothing new enters, and the admitted keep their place on editions`);
  const items: WikidataLandmark[] = [];
  const filtered: FilteredEntity[] = [];
  for (const entity of [...pool.values()].sort((a, b) => b.sitelinks - a.sitelinks)) {
    const classes = facts.get(entity.qid)?.classes ?? [];
    const verdict = kind.verdict({ classes, onEarth: entity.onEarth, lat: entity.lat, lon: entity.lon }, trees);
    if (!verdict.pass) {
      filtered.push({ externalId: entity.qid, name: entity.label, reason: verdict.reason });
      continue;
    }
    const own = readers === null ? null : readers.get(entity.qid) ?? 0;
    const isGuided = guided.has(entity.qid);
    const line = kind.lineFor?.(classes, trees) ?? kind.line;
    const stands = guidedStanding(line, entity.sitelinks, own, isGuided, admitted.has(entity.qid));
    if (stands === 'out') continue;
    if (stands === 'fell') {
      filtered.push({
        externalId: entity.qid, name: entity.label, reason: belowGuidedLine(line, entity.sitelinks, own, isGuided), type: verdict.type,
      });
      continue;
    }
    items.push(placeLandmark(entity, classes, verdict.type));
  }
  console.log(`${kind.logPrefix} Pool of ${pool.size}: ${items.length} admitted, ${filtered.length} refused`);
  return { items, fetched: pool.size, filtered };
}
