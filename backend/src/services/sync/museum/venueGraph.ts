/**
 * The venue side of the works-first import: what Wikidata knows about every entity a work
 * points at, what that makes of it, and which pin survives when two of them are one visit.
 *
 * Two things here exist only because of how the tested modules compose, and neither module's
 * own tests can see them:
 *
 *   - `ancestors` is the *transitive* `P361` closure. `placeArtwork` walks it as one hop, so a
 *     direct-parents function would fail to see that a branch two organisations below an owner
 *     is that owner's institution — and hand the work to the building one level up.
 *   - `survivorOf` walks the fold map to a fixed point. `computeFolds` records only immediate
 *     relationships and they chain, so a single lookup can name a venue that is itself gone.
 */

import { resolveVenue, type Resolution } from './resolveVenue.js';
import { computeFolds, type Fold, type FoldCandidate } from './venueFolds.js';
import type { VenueFacts } from './venueTest.js';
import {
  fetchEntityDetails,
  fetchEntityEdges,
  chunk,
  unique,
  type EntityDetails,
  type EntityEdges,
  type QueryRunner,
} from './queries.js';

const LOG_PREFIX = '[Museum Sync]';

/** How far `P361` is walked, both to find a venue and to know what an institution contains. */
export const VENUE_HOPS = 3;
const FACT_BATCH = 50;

export interface VenueGraph {
  details: Map<string, EntityDetails>;
  facts: (qid: string) => VenueFacts | undefined;
  parents: (qid: string) => string[];
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
 */
export async function loadVenueGraph(run: QueryRunner, seeds: string[]): Promise<VenueGraph> {
  const details = new Map<string, EntityDetails>();
  const edges = new Map<string, EntityEdges>();

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
    frontier = todo.flatMap((qid) => edges.get(qid)?.parents ?? []);
  }

  const parents = (qid: string) => edges.get(qid)?.parents ?? [];
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
  return { details, facts, parents, ancestors: makeAncestors(parents) };
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
 * Only venues that actually received a work are candidates: a container holding nothing of its
 * own is not in this run's catalogue, and folding into it would invent a museum rather than
 * merge two — which is how a city quarter once swallowed the museum inside it.
 */
export function foldVenues(
  placements: Record<string, string[]>,
  graph: VenueGraph,
): Record<string, Fold> {
  const works = new Map<string, number>();
  for (const venues of Object.values(placements)) {
    for (const venue of venues) works.set(venue, (works.get(venue) ?? 0) + 1);
  }
  const candidates: FoldCandidate[] = [];
  for (const [qid, count] of works) {
    const row = graph.details.get(qid);
    // Unreachable by construction — a venue only reaches a placement by passing the venue test,
    // which requires its own coordinates — but the fold rule is metres, so it says so.
    if (!row || row.lat === null || row.lon === null) continue;
    candidates.push({ qid, lat: row.lat, lon: row.lon, works: count, sitelinks: row.sitelinks });
  }
  return computeFolds(candidates, graph.parents);
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
