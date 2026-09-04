/**
 * The venue side of the works-first import: what Wikidata knows about every entity a work
 * points at, what that makes of it, and which pin survives when two of them are one visit.
 *
 * Three things here exist only because of how the tested modules compose, and no module's own
 * tests can see them:
 *
 *   - `ancestors` is the *transitive* `P361` closure. `placeArtwork` walks it as one hop, so a
 *     direct-parents function would fail to see that a branch two organisations below an owner
 *     is that owner's institution — and hand the work to the building one level up.
 *   - `survivorOf` walks the fold map to a fixed point. `computeFolds` records only immediate
 *     relationships and they chain, so a single lookup can name a venue that is itself gone.
 *   - `foldVenues` offers a venue's doors to `computeFolds` only after the venue test and the
 *     editorial exclusions have had their say, and the graph has facts for a door only because
 *     the walk followed `P276` from a museum-class entity. `pipeline.test.ts` holds both cases.
 */

import { resolveVenue, type Resolution } from './resolveVenue.js';
import { computeFolds, type Fold, type FoldCandidate } from './venueFolds.js';
import { venueVerdict, type VenueFacts } from './venueTest.js';
import { EDITORIAL_OUT } from './artTest.js';
import {
  fetchEntityDetails,
  fetchEntityEdges,
  type EntityDetails,
  type EntityEdges,
} from './queries.js';
import { chunk, unique, type QueryRunner } from '../wikidataQueries.js';

const LOG_PREFIX = '[Museum Sync]';

/** How far `P361` is walked, both to find a venue and to know what an institution contains. */
export const VENUE_HOPS = 3;
const FACT_BATCH = 50;

export interface VenueGraph {
  details: Map<string, EntityDetails>;
  facts: (qid: string) => VenueFacts | undefined;
  parents: (qid: string) => string[];
  /** What an entity is located in (`P276`) — a candidate for its door, never walked for a venue. */
  locations: (qid: string) => string[];
  /** The full `P361` closure, which is what placement needs — see the file header. */
  ancestors: (qid: string) => ReadonlySet<string>;
}

/**
 * Follow `into` until it names a venue the fold map does not mention.
 *
 * `computeFolds` measures one relationship at a time and never chases it further, so its map
 * chains: a room folds into the gallery around it while that gallery folds into the palace
 * around it, and a container can independently be folded away as a same-spot duplicate of a
 * third record. A single lookup would hand the work to a venue that is itself gone.
 */
export function survivorOf(folds: Record<string, Fold>, qid: string): string {
  let current = qid;
  const seen = new Set<string>([qid]);
  while (folds[current]) {
    const next = folds[current].into;
    // Wikidata contains reciprocal P361 pairs; without this the walk never returns.
    if (seen.has(next)) break;
    seen.add(next);
    current = next;
  }
  return current;
}

/** Every `P361` ancestor, not just the parent — memoised, and safe on a cycle. */
function makeAncestors(parents: (qid: string) => string[]): (qid: string) => ReadonlySet<string> {
  const memo = new Map<string, Set<string>>();
  return (qid: string) => {
    const cached = memo.get(qid);
    if (cached) return cached;
    const found = new Set<string>();
    memo.set(qid, found);
    const queue = [...parents(qid)];
    while (queue.length) {
      const next = queue.pop() as string;
      if (found.has(next) || next === qid) continue;
      found.add(next);
      queue.push(...parents(next));
    }
    return found;
  };
}

/**
 * Facts for every entity a work names, and for every entity above those within reach of the
 * `P361` walk — a venue reached at hop 3 has to be judged by the same test as one named outright.
 *
 * A museum-class entity's location (`P276`) is followed too, one hop like a parent, so that the
 * building a collection is housed in has facts when `foldVenues` asks whether it is the door:
 * no work names Palazzo Pitti, so nothing else brings it into the graph (#781). Only from
 * museum-class entities, because only those can be venues with a door, and the location of
 * anything else is a district or a city — which the walk would otherwise fetch by the hundred.
 */
export async function loadVenueGraph(
  run: QueryRunner,
  seeds: string[],
  museumClasses: ReadonlySet<string>,
): Promise<VenueGraph> {
  const details = new Map<string, EntityDetails>();
  const edges = new Map<string, EntityEdges>();
  const nextOf = (qid: string): string[] => {
    const found = edges.get(qid);
    if (!found) return [];
    const museum = found.classes.some((c) => museumClasses.has(c));
    return museum ? [...found.parents, ...found.locations] : found.parents;
  };

  let frontier = unique(seeds);
  for (let hop = 0; hop <= VENUE_HOPS && frontier.length; hop++) {
    const todo = frontier.filter((qid) => !edges.has(qid));
    const batches = chunk(todo, FACT_BATCH);
    for (let i = 0; i < batches.length; i++) {
      run.phase(`Fetching venue facts, hop ${hop}, ${i + 1}/${batches.length}...`);
      await run.step();
      for (const [qid, row] of await fetchEntityDetails(run.sparql, batches[i])) {
        details.set(qid, row);
      }
      await run.step();
      for (const [qid, row] of await fetchEntityEdges(run.sparql, batches[i])) {
        edges.set(qid, row);
      }
    }
    frontier = todo.flatMap(nextOf);
  }

  const parents = (qid: string) => edges.get(qid)?.parents ?? [];
  const locations = (qid: string) => edges.get(qid)?.locations ?? [];
  const facts = (qid: string): VenueFacts | undefined => {
    const row = details.get(qid);
    if (!row) return undefined;
    return {
      qid,
      classes: edges.get(qid)?.classes ?? [],
      lat: row.lat,
      lon: row.lon,
      dissolved: row.dissolved,
    };
  };
  console.log(`${LOG_PREFIX} Venue candidates: ${details.size} entities`);
  return { details, facts, parents, locations, ancestors: makeAncestors(parents) };
}

/** The verdict on a QID a work named, memoised — and the venue it stands for, if any. */
export function makeResolver(graph: VenueGraph, museumClasses: ReadonlySet<string>) {
  const memo = new Map<string, Resolution>();
  const resolution = (qid: string): Resolution => {
    let found = memo.get(qid);
    if (!found) {
      found = resolveVenue(qid, graph.facts, graph.parents, museumClasses, VENUE_HOPS);
      memo.set(qid, found);
    }
    return found;
  };
  const resolve = (qid: string): string | null => {
    const found = resolution(qid);
    return 'venue' in found ? found.venue : null;
  };
  return { resolve, resolution };
}

/**
 * Which pins are one visit.
 *
 * The venues are those that actually received a work. A container holding nothing of its own
 * is not in this run's catalogue, and folding into it on the strength of `P361` alone would
 * invent a museum rather than merge two — which is how a city quarter once swallowed the museum
 * inside it. What such a container can be is a *door* (#781): the building or complex a
 * collection is housed in, offered to the door rule only when it would pass the venue test on
 * its own and is not an entity the editors excluded — the quarter that did the swallowing is
 * `EDITORIAL_OUT` for exactly that, and an entity kept out of the catalogue cannot be the door
 * to anything in it. Whether it *is* the door — on the same site, and the better-known name —
 * is `computeFolds`'s measurement, not this function's.
 */
export function foldVenues(
  placements: Record<string, string[]>,
  graph: VenueGraph,
  museumClasses: ReadonlySet<string>,
): Record<string, Fold> {
  const works = new Map<string, number>();
  for (const venues of Object.values(placements)) {
    for (const venue of venues) works.set(venue, (works.get(venue) ?? 0) + 1);
  }
  const candidateOf = (qid: string): FoldCandidate | undefined => {
    const row = graph.details.get(qid);
    // Unreachable for a venue — it only reaches a placement by passing the venue test, which
    // requires its own coordinates — but the fold rule is metres, so it says so.
    if (!row || row.lat === null || row.lon === null) return undefined;
    return { qid, lat: row.lat, lon: row.lon, works: works.get(qid) ?? 0, sitelinks: row.sitelinks };
  };
  const candidates: FoldCandidate[] = [];
  for (const qid of works.keys()) {
    const candidate = candidateOf(qid);
    if (candidate) candidates.push(candidate);
  }
  const wouldBeVenue = (qid: string): boolean => {
    const facts = graph.facts(qid);
    return !!facts && venueVerdict(facts, museumClasses).pass;
  };
  const doorsOf = (qid: string): FoldCandidate[] =>
    unique([...graph.parents(qid), ...graph.locations(qid)])
      .filter((door) => !EDITORIAL_OUT[door] && wouldBeVenue(door))
      .map(candidateOf)
      .filter((door): door is FoldCandidate => !!door);
  return computeFolds(candidates, graph.parents, doorsOf);
}

/** Move every placement onto the venue that survives the folds. */
export function applyFolds(
  placements: Record<string, string[]>,
  folds: Record<string, Fold>,
): Record<string, string[]> {
  const folded: Record<string, string[]> = {};
  for (const [work, venues] of Object.entries(placements)) {
    folded[work] = unique(venues.map((venue) => survivorOf(folds, venue)));
  }
  return folded;
}
