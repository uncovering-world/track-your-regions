/**
 * The venue test admits any entity with a museum class and its own coordinates, so a museum
 * inside a museum produces two pins: Palazzo Pitti and the Galleria Palatina, the Met and "The
 * Met Fifth Avenue", the Uffizi twice under two QIDs.
 *
 * Distance is what separates "inside" from "next door", and it is a semantic signal rather
 * than a fudge: Galleria Palatina is in Palazzo Pitti, the Czartoryski Museum is a branch of
 * the National Museum in Kraków 500 m away, and the Van Gogh Museum merely stands beside the
 * Stedelijk.
 *
 * Three rules, in the order they are applied: a container that holds works of its own is the
 * ticket; a door — the building or complex a venue is housed in — is the ticket when it is the
 * better-known name; two rows at one spot are one record twice, and a row whose twin already
 * went through a door or into its container follows it there. Then the map is made a forest.
 */
export interface FoldCandidate { qid: string; lat: number; lon: number; works: number; sitelinks: number; }
/** Which rule recorded a fold: the same-spot pass reads it to tell a venue that went somewhere
 *  (through a door, into its container) from one that merely lost to a duplicate of itself. */
export type FoldKind = 'container' | 'door' | 'same-spot';
/** `into` is the immediate fold target, not necessarily the final survivor — it can itself be a
 *  key of the map computeFolds returns. See computeFolds for why, and how a consumer resolves it. */
export interface Fold { into: string; metres: number; why: string; kind: FoldKind; }

const CONTAINER_RADIUS_M = 250;
const SAME_SPOT_M = 40;

export function metresBetween(a: FoldCandidate, b: FoldCandidate): number {
  const dx = (a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180) * 111320;
  const dy = (a.lat - b.lat) * 110540;
  return Math.hypot(dx, dy);
}

// A P361 container on the same site is the ticket — the nearest of them where a venue is part of
// more than one, since wdt:P361 comes back from the endpoint in no fixed order and the first
// qualifying parent named a different museum row on different runs over the same data.
function applyContainerFolds(
  venues: FoldCandidate[],
  parentsOf: (qid: string) => string[],
  byQid: Map<string, FoldCandidate>,
  folds: Record<string, Fold>,
): void {
  for (const v of venues) {
    const containers = parentsOf(v.qid).map((p) => byQid.get(p)).filter((c): c is FoldCandidate => !!c);
    const container = nearestOf(v, containers);
    if (!container) continue;
    const d = metresBetween(v, container);
    folds[v.qid] = { into: container.qid, metres: Math.round(d), why: 'inside its P361 container', kind: 'container' };
  }
}

/**
 * The nearest candidate within the container radius; ties go to fame, then qid, so the answer
 * is a function of the rows alone and not of the order the edges arrived in.
 */
function nearestOf(from: FoldCandidate, candidates: FoldCandidate[]): FoldCandidate | undefined {
  let best: { row: FoldCandidate; metres: number } | undefined;
  for (const row of candidates) {
    const metres = metresBetween(from, row);
    if (metres > CONTAINER_RADIUS_M) continue;
    if (!best || metres < best.metres
      || (metres === best.metres && (row.sitelinks > best.row.sitelinks
        || (row.sitelinks === best.row.sitelinks && row.qid > best.row.qid)))) {
      best = { row, metres };
    }
  }
  return best?.row;
}

/**
 * The door of a venue: the building or complex it is housed in, when that is the name on the
 * ticket.
 *
 * The container rule above needs its container to hold a work of its own, and the venues that
 * fail it are the ones nobody names as a holder: no work says it belongs to Palazzo Pitti, the
 * Neues Museum, the Petit Palais or the Forbidden City — works belong to the Galleria Palatina,
 * the Egyptian Museum, the Musée des Beaux-Arts de la ville de Paris, the Palace Museum, and
 * each of those is the collection behind the door rather than the door (#781). The candidates
 * here are what a venue is located in (`P276`) or part of (`P361`) that would itself pass the
 * venue test, and two measurements say whether such a candidate is the door:
 *
 *   - it is on the same site — the container radius again, which is what keeps a branch two
 *     streets from its institution a visit of its own (Czartoryski, 1.2 km from the National
 *     Museum in Kraków), and
 *   - it is the better-known name. Fame here is the same measure the rest of the import runs
 *     on, and it is the one signal that separates the collection inside a building from the
 *     museum that merely occupies one: the Galleria Borghese (46 sitelinks) stays under its own
 *     name though it stands in a villa Wikidata types a museum (8), and the Alte Nationalgalerie
 *     (38) is not handed to the Nationalgalerie umbrella (14) whose coordinate lies 200 m away.
 *
 * Decided before the same-spot rule: a building that also received a work of its own would
 * otherwise lose to the collection inside it on the works count. The walk goes on from a door to
 * the door's own door, one entry per relationship, in the shape every other rule here records.
 */
function applyDoorFolds(
  venues: FoldCandidate[],
  doorsOf: (qid: string) => FoldCandidate[],
  folds: Record<string, Fold>,
  doors: Map<string, FoldCandidate>,
): void {
  for (const venue of venues) {
    let current = venue;
    const seen = new Set<string>([venue.qid]);
    while (!folds[current.qid]) {
      const door = doorOf(current, doorsOf(current.qid).filter((d) => !seen.has(d.qid)));
      if (!door) break;
      const d = metresBetween(current, door);
      folds[current.qid] = {
        into: door.qid, metres: Math.round(d), why: 'housed in it, and it is the better-known name', kind: 'door',
      };
      doors.set(door.qid, door);
      seen.add(door.qid);
      current = door;
    }
  }
}

/** The nearest candidate that is on the same site and better known; ties go to fame, then qid. */
function doorOf(venue: FoldCandidate, candidates: FoldCandidate[]): FoldCandidate | undefined {
  return nearestOf(venue, candidates.filter((door) => door.sitelinks > venue.sitelinks));
}

/**
 * Which of two records for one institution survives: the row carrying the collection, then the
 * better-known one, then the qid.
 *
 * The qid is a last resort, not a preference, and it is not decoration: two duplicate records of
 * one building are routinely equal on both counts — nought works and nought sitelinks apiece is
 * ordinary for a duplicate — and without it neither loses in either direction, so nothing merges
 * and the duplicate pin this module exists to remove survives. It also makes the answer
 * independent of the order venues arrived in.
 */
function survivesOver(x: FoldCandidate, y: FoldCandidate): boolean {
  if (x.works !== y.works) return x.works > y.works;
  if (x.sitelinks !== y.sitelinks) return x.sitelinks > y.sitelinks;
  return x.qid > y.qid;
}

// Two rows at one spot with no edge between them are one institution recorded twice; the row
// carrying the collection survives.
//
// Two passes, in this order. First the merge, over rows that no rule has folded yet, taken from
// the strongest record down so the answer does not depend on the order the rows arrive in —
// not even where the radius fails to be transitive (see mergeDuplicates). Then a row
// still standing follows a twin that went through a door or into the container that holds
// works of its own: the twin is a second record of the same place, and the place is behind
// that door. Without this the twin was compared against nothing (its sibling folded, the door
// no venue of this run) and the run wrote the door and the twin as two rows for one
// institution. The twins a row may follow are exactly the rows the door and container passes
// folded — a set the merge leaves as it is — so the second pass adds to a settled answer and
// cannot reorder it; decided pair by pair in one loop, a duplicate went through a door in one
// arrival order and merged into the gallery beside it in another. Two limits keep the follow
// from undoing the other rules: a twin that merely lost to a duplicate is not followed, so
// every loser of a three-way duplicate still names the one survivor rather than another loser;
// and a chain that passes through a door at any hop is followed only when the name at its end
// is better known than the follower too — the fame guard that let a Borghese-shaped row stand
// in its villa must not be walked round by way of a small collection housed in the same
// building, nor by way of a container that is itself housed in the refused door.
function applySameSpotFolds(
  venues: FoldCandidate[],
  folds: Record<string, Fold>,
  byQid: Map<string, FoldCandidate>,
  fameOf: (qid: string) => number | undefined,
): void {
  mergeDuplicates(venues, folds, byQid);
  followTwins(venues, folds, fameOf);
}

/**
 * Rows are taken from the strongest down, and each folds into the strongest row within the
 * radius — or, where that row has itself merged, into its survivor. "Same spot" is a radius, not
 * an equivalence class: three records at 30 m, 25 m and 55 m apart are one place, and decided
 * pair by pair in arrival order the weakest was merged in one order and left standing in
 * another. Ranking first makes the answer a function of the rows alone. The distance recorded
 * is to the row the fold names, which the run's report prints beside it: measured to the twin
 * that brought the row there, "folded into C, 30 m away" would be a claim about C, and false.
 */
function mergeDuplicates(
  venues: FoldCandidate[],
  folds: Record<string, Fold>,
  byQid: Map<string, FoldCandidate>,
): void {
  const ranked = [...venues].sort((x, y) => (survivesOver(x, y) ? -1 : 1));
  for (let i = 0; i < ranked.length; i++) {
    const row = ranked[i];
    if (folds[row.qid]) continue;
    const twin = ranked.slice(0, i).find((stronger) => isDuplicateOf(row, stronger, folds));
    if (!twin) continue;
    const into = folds[twin.qid] ? chainOf(folds, twin.qid).end : twin.qid;
    const named = byQid.get(into) ?? twin;
    folds[row.qid] = { into, metres: Math.round(metresBetween(row, named)), why: 'same spot, recorded twice', kind: 'same-spot' };
  }
}

/** A stronger row within the radius that no door or container rule took elsewhere. */
function isDuplicateOf(row: FoldCandidate, stronger: FoldCandidate, folds: Record<string, Fold>): boolean {
  const gone = folds[stronger.qid];
  if (gone && gone.kind !== 'same-spot') return false;
  return metresBetween(row, stronger) < SAME_SPOT_M;
}

/**
 * A chain of folds followed to its end — bounded, as every walk over this map is, since the
 * map may still hold a ring here — with which rows it passed and whether any hop was a door.
 */
function chainOf(folds: Record<string, Fold>, qid: string): { end: string; passed: Set<string>; throughDoor: boolean } {
  const passed = new Set<string>();
  let throughDoor = false;
  let current = qid;
  while (folds[current] && !passed.has(current)) {
    passed.add(current);
    throughDoor ||= folds[current].kind === 'door';
    current = folds[current].into;
  }
  passed.add(current);
  return { end: current, passed, throughDoor };
}

function followTwins(
  venues: FoldCandidate[],
  folds: Record<string, Fold>,
  fameOf: (qid: string) => number | undefined,
): void {
  // Decided against the map as it stood before this pass. A follow written earlier in the pass
  // lengthens its twin's chain, and read live that chain could reach a later row and refuse it
  // — so with two container folds crossed among four close records, which qid survived
  // depended on the order the rows arrived in. Against the snapshot both rows follow, the four
  // close into a ring, and breakFoldCycles keeps the row carrying the collection, as it does
  // for every ring here.
  const before: Record<string, Fold> = { ...folds };
  for (const b of venues) {
    if (before[b.qid]) continue;
    const twin = nearestTwin(b, venues, before, fameOf);
    if (twin) {
      const d = metresBetween(b, twin);
      folds[b.qid] = { into: twin.qid, metres: Math.round(d), why: 'same spot, recorded twice', kind: 'same-spot' };
    }
  }
}

/** The nearest twin `b` may follow; the qid breaks a tie, so the answer is independent of order. */
function nearestTwin(
  b: FoldCandidate,
  venues: FoldCandidate[],
  folds: Record<string, Fold>,
  fameOf: (qid: string) => number | undefined,
): FoldCandidate | undefined {
  let best: { twin: FoldCandidate; metres: number } | undefined;
  for (const a of venues) {
    if (a.qid === b.qid || !takesAlong(a, b, folds, fameOf)) continue;
    const d = metresBetween(a, b);
    if (d >= SAME_SPOT_M) continue;
    if (!best || d < best.metres || (d === best.metres && a.qid < best.twin.qid)) best = { twin: a, metres: d };
  }
  return best?.twin;
}

/**
 * Whether `a`, already folded, is a twin `b` follows: it went through a door or into its
 * container rather than merely losing to a duplicate; its chain does not already pass `b`; and
 * where the chain goes through a door at any hop — straight into one, or into a container that
 * is itself housed in one — the name at its end is better known than `b`. The guard reads the
 * end of the chain rather than the first hop, or a container hop would carry a row round to a
 * door the door rule had refused it.
 */
function takesAlong(
  a: FoldCandidate,
  b: FoldCandidate,
  folds: Record<string, Fold>,
  fameOf: (qid: string) => number | undefined,
): boolean {
  const gone = folds[a.qid];
  if (!gone || gone.kind === 'same-spot') return false;
  const chain = chainOf(folds, a.qid);
  if (chain.passed.has(b.qid)) return false;
  return !chain.throughDoor || (fameOf(chain.end) ?? 0) > b.sitelinks;
}

/**
 * A fold map must be a forest, and `P361` does not guarantee one.
 *
 * Wikidata contains reciprocal `P361` pairs — `venueGraph.survivorOf` says so in its own comment,
 * where the cycle is caught as a *termination* problem. It is a correctness problem here first.
 * Two venues 11 m apart that each name the other as their container produce `{A: {into: B},
 * B: {into: A}}`, and every consumer then reads that as: neither merges, so the duplicate pin the
 * fold rule exists to remove survives; each one's works are written to the other, so both museum
 * cards list the wrong holdings; and both are named as folded, which the pipeline reports as
 * filtered and the run then refuses — visible to nobody until the next successful run puts them
 * back.
 *
 * Broken by keeping the strongest member of each cycle: delete its outgoing fold and the rest of
 * the cycle chains into it. The strength order is the one `applySameSpotFolds` already uses —
 * the row carrying the collection survives — with the qid as a last resort so the answer does not
 * depend on the order venues arrived in.
 */
function breakFoldCycles(folds: Record<string, Fold>, byQid: Map<string, FoldCandidate>): void {
  // The same order the same-spot rule uses, so the two cannot drift apart.
  const survivesByQid = (a: string, b: string): boolean => {
    const x = byQid.get(a);
    const y = byQid.get(b);
    return x && y ? survivesOver(x, y) : a > b;
  };

  for (const start of Object.keys(folds)) {
    const walked: string[] = [];
    const onPath = new Set<string>();
    let current = start;
    while (folds[current] && !onPath.has(current)) {
      walked.push(current);
      onPath.add(current);
      current = folds[current].into;
    }
    if (!onPath.has(current)) continue;

    // `current` is the first node met twice, so the cycle is the walk from it onwards.
    const cycle = walked.slice(walked.indexOf(current));
    let keeper = cycle[0];
    for (const q of cycle) if (survivesByQid(q, keeper)) keeper = q;
    delete folds[keeper];
  }
}

/**
 * Each entry records only the *immediate* relationship a row was measured against, one hop at a
 * time — it is never chased further. `into` can therefore itself be a key of the map this
 * function returns: a room folds into the gallery around it and, separately, that gallery folds
 * into the palace around it, giving `{room: {into: 'gallery'}, gallery: {into: 'palace'}}` rather
 * than pointing the room straight at the palace. The same shape appears with no nesting at all
 * when a container is itself a same-spot duplicate of a third record. A consumer that wants the
 * eventual survivor must follow `into` until it names a qid absent from the map; that walk is the
 * caller's job (composing this with placement's output), not this function's.
 */
export function computeFolds(
  venues: FoldCandidate[],
  parentsOf: (qid: string) => string[],
  doorsOf: (qid: string) => FoldCandidate[] = () => [],
): Record<string, Fold> {
  const byQid = new Map(venues.map((v) => [v.qid, v]));
  const doors = new Map<string, FoldCandidate>();
  const folds: Record<string, Fold> = {};
  applyContainerFolds(venues, parentsOf, byQid, folds);
  applyDoorFolds(venues, doorsOf, folds, doors);
  applySameSpotFolds(venues, folds, byQid, (qid) => (byQid.get(qid) ?? doors.get(qid))?.sitelinks);
  // A door can sit on a ring — housed in a door that is housed in a venue that is part of the
  // first — and is ranked there on what it is (no works, its own sitelinks), not on its qid.
  breakFoldCycles(folds, new Map([...byQid, ...doors]));
  return folds;
}
