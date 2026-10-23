/**
 * The one resolver of where a work lies (#1819): what holds a candidate,
 * then what holds that, read once through the run's door (the subset or the
 * live service).
 *
 * - `loadContainment` reads the containment chain: `P276` and `P361` up to
 *   `CONTAINMENT_HOPS`, and `P195` one hop and not walked, since ownership is
 *   not a place. A link a candidate's own statement names that got no answer
 *   is `unknown`: the subset keeps every place, part and collection a seed
 *   names (ADR-0105), so it lacks one only where Postgres refused it
 *   (`wikidata_subset_builds.counts.refused`), and a link nobody could read is
 *   not the end of the chain. A link further up that got no answer is no
 *   place: the subset keeps a container's own container only when the chain
 *   reaches a coordinate, and the Venus of Tan-Tan is part of the Acheulean,
 *   which is part of the Paleolithic.
 * - `chainOf` is what a work stands in or is part of, nearest first, the way
 *   Public art and Monuments & memorials read it (`publicArtTest.ts`).
 * - `nearest` (`places/nearest.ts`) is the walk to the nearest place a
 *   kind's test passes: the museum import's `resolveVenue` reads it over its
 *   venue graph. The two walks share the hop limit and not code: `chainOf`
 *   lists every link with how it was reached, which a nearest answer drops.
 */

import { chunk, unique, type QueryRunner } from '../wikidataQueries.js';
import { fetchContainerFacts, type ContainerFacts, type EntityFacts } from '../publicArt/queries.js';
import { INDOOR_CLASSES } from '../publicArt/classes.js';

const FACT_BATCH = 50;

/**
 * How far up from a candidate its containers are followed: a room, its wing,
 * the museum. The Venus de Milo is located in Room 345 of the Sully Wing of
 * the Louvre, and only the third of those carries a museum class. The museum
 * import walks `P361` the same distance (`VENUE_HOPS`).
 */
export const CONTAINMENT_HOPS = 3;

/** What the containment chains of a set of candidates read. */
export interface Containment {
  nodes: Map<string, ContainerFacts>;
  /** A candidate's own links that got no answer: a link nobody could read. */
  unknown: Set<string>;
}

export const emptyContainment = (): Containment => ({ nodes: new Map(), unknown: new Set() });

/**
 * Something the entity stands in, or is part of, with what that thing is —
 * the container itself, or one the walk reached by going up from it: a room,
 * then its wing, then the museum.
 */
export interface ContainerFact {
  qid: string;
  label: string;
  classes: string[];
  /**
   * The outermost thing this container was walked up to, when the walk went
   * past it: the palace above a room's wing. What a reason names beside a
   * room, so that "inside Room 325 (Louvre Palace)" says where the room is.
   */
  building?: string;
  /**
   * How the entity reaches it: by its own `located in` (P276), `part of`
   * (P361) or `in the collection of` (P195) statement, or `above` — walked up
   * to from other containers. `via` names every container the walk reached
   * it from, a container the entity's own statement names included. Read for
   * one thing (#803): a museum the entity itself is *part of* is an
   * institution it belongs to, not a place it stands in — the Pakistan
   * Monument is part of the Pakistan Monument Museum, which stands in its
   * base — where a room that is part of a museum is inside it.
   */
  relation: 'located in' | 'part of' | 'in the collection of' | 'above';
  via?: string[];
  /** A link nobody could read: listed so the chain does not end at it, with no classes to say anything. */
  unknown?: true;
}

/** Ask about `ids` in batches, into `containment`. */
async function ask(run: QueryRunner, ids: string[], containment: Containment, phase: (batch: number, of: number) => string) {
  const batches = chunk(ids, FACT_BATCH);
  for (let i = 0; i < batches.length; i++) {
    run.phase(phase(i + 1, batches.length));
    await run.step();
    const answered = await fetchContainerFacts(run.sparql, batches[i]);
    for (const [qid, entry] of answered) containment.nodes.set(qid, entry);
  }
}

/**
 * What holds the candidates, then what holds that, up to `CONTAINMENT_HOPS` —
 * each hop asks only about containers no earlier hop answered for — and what
 * owns them, one hop and no walk: ownership is not a place, so a rule reads an
 * owner only for a candidate nothing places, and asks only whether it is a
 * museum or a church (#804).
 */
export async function loadContainment(run: QueryRunner, facts: EntityFacts[]): Promise<Containment> {
  const containment = emptyContainment();
  const asked = new Set<string>();
  let frontier = unique(facts.flatMap((f) => [...f.locations, ...f.parents]));
  for (let hop = 1; hop <= CONTAINMENT_HOPS && frontier.length; hop++) {
    frontier.forEach((qid) => asked.add(qid));
    await ask(run, frontier, containment,
      (batch, of) => `Asking what holds them (hop ${hop}/${CONTAINMENT_HOPS}, batch ${batch}/${of})...`);
    frontier = unique(frontier.flatMap((qid) => containment.nodes.get(qid)?.parents ?? [])).filter((qid) => !asked.has(qid));
  }
  const owners = unique(facts.flatMap((f) => f.collections)).filter((qid) => !asked.has(qid));
  await ask(run, owners, containment, (batch, of) => `Asking what owns them (batch ${batch}/${of})...`);
  // Unknown is a link some candidate names itself and nothing answered for,
  // whichever hop happened to ask about it first.
  for (const f of facts) {
    for (const qid of [...f.locations, ...f.parents, ...f.collections]) {
      if (!containment.nodes.has(qid)) containment.unknown.add(qid);
    }
  }
  return containment;
}

/**
 * The building above a container along its own chain: the first thing up the
 * first-parent line that is not itself a room or a wing — the palace above a
 * room's wing, or directly above a room, and never the city above the palace
 * that a deeper read happened to reach. Follows the chain as far as it was
 * read; where every ancestor read is a room or a wing, the outermost of them;
 * nothing when the container is the top of what is known.
 */
function buildingAbove(qid: string, containment: Containment): string | undefined {
  let top: string | undefined;
  let current = qid;
  for (let hop = 1; hop < CONTAINMENT_HOPS; hop++) {
    const parent = containment.nodes.get(current)?.parents[0];
    if (parent === undefined) break;
    const known = containment.nodes.get(parent);
    if (!known) break;
    top = known.label;
    if (!known.classes.some((c) => INDOOR_CLASSES[c])) break;
    current = parent;
  }
  return top;
}

/** A container still to be described: how the entity reaches it, and from where when walked. */
type Reach = Pick<ContainerFact, 'qid' | 'relation' | 'via'>;

/**
 * One container as the chain lists it: what it is; that nobody could read it,
 * when the candidate names it itself; or, for a link up the chain that got no
 * answer, an id with no classes that says nothing. `unknown` is shared by the
 * candidates of a gather, so a link one candidate names itself may be only
 * above another's container, where it is no place.
 */
function described(reach: Reach, containment: Containment): ContainerFact {
  const known = containment.nodes.get(reach.qid);
  if (!known) {
    return reach.relation !== 'above' && containment.unknown.has(reach.qid)
      ? { ...reach, label: reach.qid, classes: [], unknown: true }
      : { ...reach, label: reach.qid, classes: [] };
  }
  return { ...reach, label: known.label, classes: known.classes, building: buildingAbove(reach.qid, containment) };
}

/**
 * Everything a candidate stands in or is part of, the containers' own
 * containers included, nearest first — so a reason names the room's museum
 * rather than the room — each saying how it was reached: by the candidate's
 * own `located in` or `part of`, or walked up to from the containers `via`
 * names — every one of them, so that a rule reading a museum the candidate is
 * part of as its owner rather than its place, and dropping what stands only
 * above that museum (#803), sees a second route to the same thing whichever
 * order the source listed the statements in. As many levels as were read and
 * no further. A candidate's own link nobody could read is listed as
 * `unknown`, and the walk goes on along every other route.
 */
export function chainOf(facts: EntityFacts, containment: Containment): ContainerFact[] {
  const out: ContainerFact[] = [];
  const seen = new Map<string, ContainerFact>();
  let frontier: Reach[] = [
    ...facts.locations.map((qid): Reach => ({ qid, relation: 'located in' })),
    ...facts.parents.map((qid): Reach => ({ qid, relation: 'part of' })),
  ];
  for (let hop = 0; hop < CONTAINMENT_HOPS && frontier.length; hop++) {
    const next: Reach[] = [];
    for (const reach of frontier) {
      const already = seen.get(reach.qid);
      if (already) {
        // Listed once, reached again: another walk arrives at it, which is
        // recorded — on a container the candidate's own statement names too,
        // so that a museum the candidate is part of and stands in the
        // courtyard of is read as where it stands.
        if (reach.via) already.via = [...(already.via ?? []), ...reach.via];
        continue;
      }
      const fact = described(reach, containment);
      seen.set(reach.qid, fact);
      out.push(fact);
      const parents = containment.nodes.get(reach.qid)?.parents ?? [];
      next.push(...parents.map((qid): Reach => ({ qid, relation: 'above', via: [reach.qid] })));
    }
    frontier = next;
  }
  return out;
}

/**
 * What owns a candidate, one level and no further: an owner is not a place,
 * so it has no chain and no building above it. Handed in whatever the
 * candidate's containers say; a rule decides when to read it.
 */
export function ownersOf(facts: EntityFacts, containment: Containment): ContainerFact[] {
  return facts.collections.map((qid) => {
    const owner = described({ qid, relation: 'in the collection of' }, containment);
    delete owner.building;
    return owner;
  });
}
