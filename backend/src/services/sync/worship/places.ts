/**
 * Door one: a place of worship the world already knows by name.
 *
 * A classifier over the kind's share of the place gather (`places/gather.ts`,
 * #1820): the rule over each candidate, and then the fame line — with one
 * difference from public art's: the line is not a constant here but a number
 * the source row states (`sourceLine.ts`), so a kind can be widened from the
 * admin panel rather than by a deploy.
 *
 * Nothing here decides what a place of worship is: that is `worshipTest.ts`,
 * over the sets `classes.ts` composes. This file is the wiring.
 */

import type { PoolEntity } from '../publicArt/queries.js';
import type { KindShare, PlaceKind } from '../places/gather.js';
import { worshipVerdict } from './worshipTest.js';
import { fetchWorshipTrees } from './queries.js';
import { BROAD_WORSHIP_ROOTS, type WorshipTrees, type WorshipType } from './classes.js';
import { belowLineReason, lineStanding, type SourceLine } from '../sourceLine.js';
import type { FilteredEntity } from '../syncContract.js';

/** A place the rule admitted and the line let in, with what the run learned about it. */
export interface PlaceCandidate {
  entity: PoolEntity;
  /** Every `P31` it carries, as the catalogue stores them. */
  classes: string[];
  type: WorshipType | null;
  /** Set when a year of readers admitted it under the editions line (`WORSHIP_READERS_LINE`). */
  readersNote?: string;
}

export interface PlacesByFame {
  places: Map<string, PlaceCandidate>;
  /** Refusals, most famous first: what the rule turned away, and by what name. */
  filtered: FilteredEntity[];
  /**
   * Every `P31` of every entity the pool named — the admitted, the refused and
   * the merely unfamous alike, keyed by QID.
   *
   * The pipeline reads it for a question door one does not ask: whether a
   * *work* the other door collected is itself a place of worship. The works
   * pool knows only the one class a work was collected under, and the Cavern of
   * the Patriarchs (`mosque, synagogue, tomb, mausoleum, …`) arrives there as a
   * tomb — this map is where its mosque class is (#753).
   */
  classesOf: Map<string, string[]>;
}

/**
 * Places of worship as the place gather reads them (`places/gather.ts`): the
 * worship tree and its type trees, and the classes whose instances are its
 * candidates — the nine broad roots in fame bands, every other class of the
 * tree whole. **The part classes are asked too**, though the rule refuses
 * every one of them: a bell tower Wikidata types nothing else is a row a
 * person looking at the run should see refused by name — the Leaning Tower,
 * the Giralda, St Mark's Campanile — rather than one that silently never
 * arrived. It is 22 rows at the pool's floor, measured on 2026-09-04.
 *
 * The rule reads a row's own classes — a tower is a tower whether a cathedral
 * stands beside it or not (`WORSHIP_PART_CLASSES`) — and, for a holy place
 * that is no building, where its location (`P276`) says it is kept, so the
 * containers are asked about.
 */
export const WORSHIP_KIND: PlaceKind<WorshipTrees> = {
  name: 'places of worship',
  trees: fetchWorshipTrees,
  poolClasses: (trees) => ({ broad: BROAD_WORSHIP_ROOTS, narrow: [...trees.worship, ...trees.parts] }),
  // A holy object is the place it is kept in (`worshipVerdict`).
  readsContainers: true,
};

/**
 * ADR-0161 decision 2: a year of readers admits a place under the editions
 * line, measured in #1997. At 25,000 it brings all seven tops of the kind's list under the line (Mont-Saint-Michel
 * Abbey, the Sanctuary of Fátima, the Virupaksha Temple) with 484 places; the
 * Wikivoyage guide would miss Fátima and Virupaksha, whose own items no guide
 * uses. A place it admitted stays while it reads at `stay`, as a tower does on
 * Towers' line. The source gates every arrival, so each reaches a curator.
 * The counts are to follow the year's readership (#2145).
 */
export const WORSHIP_READERS_LINE = { enter: 25_000, stay: 18_000 } as const;

/** The curator's note on a place only its readers admitted. */
export function readersNote(editions: number, readers: number): string {
  return `${editions} Wikipedia editions, under the line, and ${readers.toLocaleString('en')} readers a year: `
    + `in by its readers (${WORSHIP_READERS_LINE.enter.toLocaleString('en')} to enter)`;
}

/**
 * Where a candidate the rule passed stands: in by its editions, in by its
 * readers with the note a curator reads, fallen with the reason named, or
 * simply out. A row the source admits that has slipped is refused by name,
 * with its numbers; one that was never in and is below both lines is out,
 * since no rule ran on it. The editions rule and sentence are `sourceLine.ts`'s.
 */
function standingOf(
  entity: PoolEntity, held: boolean, line: SourceLine, readers: ReadonlyMap<string, number> | null,
): 'out' | { fell: string } | { readersNote?: string } {
  const byEditions = lineStanding(entity.sitelinks, held, line);
  if (byEditions === 'in') return {};
  const read = readers?.get(entity.qid) ?? 0;
  if (readers !== null && read >= (held ? WORSHIP_READERS_LINE.stay : WORSHIP_READERS_LINE.enter)) {
    return { readersNote: readersNote(entity.sitelinks, read) };
  }
  if (byEditions === 'out') return 'out';
  return {
    fell: readers === null ? belowLineReason(entity.sitelinks, line)
      : `${belowLineReason(entity.sitelinks, line)}, and ${read.toLocaleString('en')} readers a year `
        + `(${WORSHIP_READERS_LINE.stay.toLocaleString('en')} to stay)`,
  };
}

/**
 * The places this run would admit for their own fame, and every candidate the
 * rule refused with the reason it gave.
 *
 * `admitted` is what the source holds as admitted before the run, so the stay
 * line has something to hold. `readers` is a year of readers of each
 * candidate, or null when no year can be read: then the editions line alone
 * decides. Candidates are judged most famous first, which is the order the
 * refusals are reported in.
 */
export function classifyPlacesByFame(
  { trees, pool, facts, containers }: KindShare<WorshipTrees>,
  admitted: ReadonlySet<string>,
  line: SourceLine,
  readers: ReadonlyMap<string, number> | null = null,
): PlacesByFame {
  const classesOf = new Map([...facts].map(([qid, row]) => [qid, row.classes]));

  const places = new Map<string, PlaceCandidate>();
  const filtered: FilteredEntity[] = [];
  const candidates = [...pool.values()].sort((a, b) => b.sitelinks - a.sitelinks);
  for (const entity of candidates) {
    const classes = classesOf.get(entity.qid) ?? [];
    const row = facts.get(entity.qid);
    const verdict = worshipVerdict({
      qid: entity.qid,
      classes,
      onEarth: entity.onEarth,
      lat: entity.lat,
      lon: entity.lon,
      religions: row?.religions,
      locatedIn: (row?.locations ?? []).flatMap((qid) => {
        const place = containers?.nodes.get(qid);
        return place ? [{ label: place.label, classes: place.classes }] : [];
      }),
    }, trees);
    if (!verdict.pass) {
      filtered.push({ externalId: entity.qid, name: entity.label, reason: verdict.reason });
      continue;
    }
    const stands = standingOf(entity, admitted.has(entity.qid), line, readers);
    if (stands === 'out') continue;
    if ('fell' in stands) {
      filtered.push({ externalId: entity.qid, name: entity.label, reason: stands.fell });
      continue;
    }
    places.set(entity.qid, { entity, classes, type: verdict.type, ...stands });
  }
  return { places, filtered, classesOf };
}
