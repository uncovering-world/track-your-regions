/**
 * Whether an entity is public art: something a traveller stands in front of,
 * outdoors, that is not another kind's object. The museum venue test, one
 * level over.
 *
 * Wikidata types a cathedral a monument, a shrine a war memorial, a commune a
 * memorial and a sidewalk a monument, so the class an entity arrived by is a
 * necessary condition and nothing more. The rules run in the order a person
 * would give the reason: what it *is* first (a church, a camp, a stadium),
 * then where it *stands* (inside a museum or a church) — or, when nothing
 * says where it stands, *whose* it is (a museum's collection, or a museum it
 * is part of) — then whether a building class is answered by an artwork
 * class and a museum class by an artwork or a commemorative one, then
 * whether there is anywhere to stand at all.
 *
 * Pure: every fact is handed in, so the rule can be tried on the catalogue's
 * own mistakes without a network.
 */

import {
  KILL_CLASSES,
  VETO_CLASSES,
  INDOOR_CLASSES,
  OUTDOOR_CLASSES,
  SITE_CLASSES,
  OTHER_PLACE_CLASSES,
  MEMORIAL_LIFTS,
  type PublicArtTrees,
} from './classes.js';
import type { KindRule, MonumentType, PublicArtType } from './kindRules.js';
// The works-first kinds' exception for a lost work whose remains are on show (#872).
import { REMAINS_ON_SHOW } from '../museum/worksCollector.js';

/**
 * Something the entity stands in, or is part of, with what that thing is —
 * the container itself, or one the pipeline reached by walking up from it: a
 * room, then its wing, then the museum.
 */
export interface ContainerFact {
  qid: string;
  label: string;
  classes: string[];
  /**
   * The outermost thing this container was walked up to, when the walk went
   * past it: the palace above a room's wing. What the reason names beside a
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
}

export interface PublicArtFacts {
  qid: string;
  /** Every `P31` the entity carries. */
  classes: string[];
  containers: ContainerFact[];
  /**
   * Whose collection the entity is in (`P195`), with what each owner is.
   * Ownership, not a place: read only when nothing in `containers` places
   * the work — then the museum that owns it is the one signal there is (the
   * Shigir Idol); when something does, the owner is never asked about (the
   * Sibelius Monument, in a park, owned by a museum).
   */
  collections: ContainerFact[];
  /** `P547`, whom or what the entity commemorates. */
  commemorates: string[];
  /** `P180`, what the entity depicts: a figure stands on it. */
  depicts: string[];
  /** Whether `P625` is on this planet — Fallen Astronaut's is not. */
  onEarth: boolean;
  lat: number | null;
  lon: number | null;
}

export type PublicArtResult =
  | {
    pass: true;
    type: PublicArtType | MonumentType;
    /**
     * Whether the kind's classes answered a building's veto — an artwork
     * class, and for Monuments & memorials a memorial too. Stored with the
     * row, so the catalogue check can read the rule's own answer rather than
     * approximate closures it cannot hold.
     */
    artwork: boolean;
  }
  | {
    pass: false;
    reason: string;
    /**
     * Where the rule found the entity held, when it refused it as another
     * place's: item ids, nearest first — the Cornaro chapel, then Santa Maria
     * della Vittoria. Written on the refusal (ADR-0102), where a works kind
     * that admits one of those places takes the work.
     */
    heldIn?: string[];
  };

/** A refusal that names the places the entity is held in, nearest first. */
interface HeldElsewhere {
  reason: string;
  heldIn: string[];
  /** Whether the place is a museum or a place of worship, a venue a works kind holds. */
  venue?: true;
}

function named(classes: string[], of: Record<string, string>): string[] {
  return classes.filter((c) => of[c]).map((c) => of[c]);
}

/**
 * The place that makes a work somebody else's, or nothing.
 *
 * Nearest first, over the places `placesAndOwners` kept. A place the entity
 * stands in — or is part of, a museum institution excepted, which is whose
 * it is rather than where it stands (#803) — that is a museum or a place of
 * worship makes the work that building's — the Pietà is St Peter's before
 * it is Rome's; a room or a wing makes it indoors whatever the building is
 * called — the Dendera zodiac is in Room 325 of a palace; and a site
 * (`SITE_CLASSES`) owns its parts — the Ishtar Gate is part of Babylon. A
 * square, a park, a district, a forest or a palace as container says
 * nothing: the Trevi Fountain stands on Piazza di Trevi, the Charging Bull in
 * the Financial District. Whose a work is — its collection, the museum it is
 * part of — is not asked here at all: HAM Helsinki Art Museum owns the
 * Sibelius Monument, which stands in a park — see `ownedElsewhere` for the
 * one case it is read.
 */
function heldElsewhere(places: ContainerFact[], trees: PublicArtTrees, noun: string, venues = true): HeldElsewhere | null {
  // The places from the one the reason names outward, nearest first: what a
  // works kind reads to find the venue it admits among them (ADR-0102).
  const from = (index: number): string[] => places.slice(index).map((c) => c.qid);
  // The building before the room: "inside Louvre Museum" is the reason a
  // curator can read, and the room is only reached for when no place in the
  // chain is a museum or a place of worship. Nearest first across both
  // kinds: a chapel inside a museum complex names the chapel. A work stranded
  // outdoors on a venue no kind offers skips this loop (`strandedOutdoors`)
  // and is still asked about a room and a site.
  for (const [index, container] of venues ? places.entries() : []) {
    if (container.classes.some((c) => trees.museum.has(c))) {
      return { reason: `inside ${container.label}: a work of a museum, not ${noun}`, heldIn: from(index), venue: true };
    }
    if (container.classes.some((c) => trees.worship.has(c))) {
      return { reason: `inside ${container.label}: a work of a place of worship, not ${noun}`, heldIn: from(index), venue: true };
    }
  }
  for (const [index, container] of places.entries()) {
    if (container.classes.some((c) => INDOOR_CLASSES[c])) {
      const where = container.building ? `${container.label} (${container.building})` : container.label;
      return { reason: `inside ${where}: a work indoors, not ${noun}`, heldIn: from(index) };
    }
    const site = named(container.classes, SITE_CLASSES);
    if (site.length) {
      // A site owns its parts; no works kind holds a site, so nothing is handed over.
      return { reason: `part of ${container.label}: ${site[0]}, not ${noun}`, heldIn: [] };
    }
  }
  return null;
}

/**
 * What places the entity, and what merely owns it, out of everything it
 * stands in or is part of.
 *
 * A museum the entity itself is *part of* is an institution it belongs to,
 * not a place it stands in: Wikidata types a museum an institution, and the
 * Pakistan Monument is part of the Pakistan Monument Museum, which stands in
 * the monument's base, while the monument stands in Shakarparian park (#803).
 * A place is what a chain of places reaches: what the entity is located in,
 * what it is part of that is not such an institution, and whatever the walk
 * reached from one of those — in whichever order the source listed the
 * routes, and the institution itself included when a place leads to it: a
 * work part of a museum *and* located in its courtyard stands in the
 * museum. What only an institution reaches goes with it — an institution's
 * own building is not where the entity stands. Only at the entity's own
 * hop: a room that is part of a museum is inside it, and the Louvre reached
 * through Room 325 still names the museum. The worship tree is not read
 * this way — a church is a building, and a statue that is part of one is
 * part of its fabric. Measured on the pool of 2026-09-13: no sculpture above
 * the line reaches a museum by `part of` alone; the works inside museums
 * say `located in`.
 */
function placesAndOwners(
  containers: ContainerFact[], trees: PublicArtTrees,
): { places: ContainerFact[]; owners: ContainerFact[] } {
  // A building of worship Wikidata also types a museum — deconsecrated, or
  // run as one — is still the building: part of it is part of its fabric.
  const institution = (c: ContainerFact): boolean => c.relation === 'part of'
    && c.classes.some((cls) => trees.museum.has(cls))
    && !c.classes.some((cls) => trees.worship.has(cls));
  // To a fixed point: a container is listed once however many routes reach
  // it, and a route from a later hop may be listed after it.
  const placed = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const c of containers) {
      if (placed.has(c.qid)) continue;
      const own = c.relation === 'located in' || (c.relation === 'part of' && !institution(c));
      if (own || (c.via ?? []).some((from) => placed.has(from))) {
        placed.add(c.qid);
        grew = true;
      }
    }
  }
  return {
    places: containers.filter((c) => placed.has(c.qid)),
    owners: containers.filter((c) => institution(c) && !placed.has(c.qid)),
  };
}

/**
 * The owner that makes a work somebody else's when nothing says where it
 * stands, or nothing.
 *
 * Read only when the entity has no place at all — no location, no part-of
 * that is not a museum, or none that still holds: the Horses of Saint Mark
 * carry nine ended locations. Then the owners are the one signal there is —
 * whose collection it is in (`P195`), and the museum it is part of, see
 * `placesAndOwners` — and a museum's or a place of worship's makes the work
 * theirs: the Shigir Idol is the Sverdlovsk museum's. Only those two kinds of
 * owner: a city or a campus that owns an outdoor sculpture says nothing
 * (Akademgorodok owns the Monument to the laboratory mouse), and an owner is
 * never walked up or read as a room — ownership is not a place. Measured on
 * the 171 rows the world tier admitted on 2026-09-05: 72 carry no container,
 * three of those an owner, and the fallback refuses exactly the two whose
 * owner is a museum or a basilica (#804).
 */
function ownedElsewhere(owners: ContainerFact[], trees: PublicArtTrees, noun: string): HeldElsewhere | null {
  for (const owner of owners) {
    const how = owner.relation === 'part of' ? 'part of' : 'in the collection of';
    if (owner.classes.some((c) => trees.museum.has(c))) {
      return { reason: `${how} ${owner.label}: a work of a museum, not ${noun}`, heldIn: [owner.qid] };
    }
    if (owner.classes.some((c) => trees.worship.has(c))) {
      return { reason: `${how} ${owner.label}: a work of a place of worship, not ${noun}`, heldIn: [owner.qid] };
    }
  }
  return null;
}

/**
 * The classes that refuse an entity unless an artwork class answers them: the
 * building and cemetery list, and the museum tree read from Wikidata. The
 * museum's veto is lifted by a commemorative class as well: a memorial typed
 * a museum is a memorial complex with a museum in it — Tsitsernakaberd, the
 * 9/11 Memorial (#803). Where `memorialLifts`, Monuments & memorials', a
 * memorial lifts a cemetery's veto and a bare building's too
 * (`MEMORIAL_LIFTS`): Arlington is a cemetery a traveller visits as a
 * memorial, and Montjuïc Castle, typed a memorial, is still a castle.
 */
function vetoes(classes: string[], trees: PublicArtTrees, memorialLifts: boolean): string[] {
  const commemorative = classes.some((c) => trees.commemorative.has(c));
  const lifted = (c: string) => memorialLifts && commemorative && Boolean(MEMORIAL_LIFTS[c]);
  return [
    ...(!commemorative && classes.some((c) => trees.museum.has(c)) ? ['a museum'] : []),
    ...named(classes.filter((c) => !lifted(c)), VETO_CLASSES),
  ];
}

/**
 * The place an entity is before it is a monument, or nothing
 * (`OTHER_PLACE_CLASSES`): a lake, a road, a square, a house. Answered by a
 * sculptural class, a commemorative form or a depiction — something on the
 * square is a work — and by nothing a monument class says.
 */
function otherPlace(e: PublicArtFacts, trees: PublicArtTrees): string | null {
  const place = named(e.classes, OTHER_PLACE_CLASSES)[0];
  if (!place) return null;
  const answered = e.depicts.length > 0
    || e.classes.some((c) => trees.artwork.has(c) && !trees.fountain.has(c));
  return answered ? null : place;
}

/**
 * The place or owner that makes the entity somebody else's work, or nothing:
 * where it stands decides, and whose it is only when nothing says where it
 * stands.
 */
function anothersWork(
  e: PublicArtFacts, trees: PublicArtTrees, noun: string, offered?: ReadonlySet<string>,
): HeldElsewhere | null {
  const { places, owners } = placesAndOwners(e.containers, trees);
  const venue = heldElsewhere(places, trees, noun);
  // The room and the site are still asked of a work stranded outdoors: a
  // colossal statue in a museum's hall is the hall's.
  if (venue && offered && strandedOutdoors(venue, e.classes, offered)) return heldElsewhere(places, trees, noun, false);
  return venue ?? (places.length ? null : ownedElsewhere([...owners, ...e.collections], trees, noun));
}

/**
 * A work that stands outdoors on the grounds of a venue no other kind offers a
 * reader stays public art (#1444): refused as the venue's, it would be on no
 * card at all. The Mother Ukraine Monument stands on the hill of a war museum
 * the catalogue holds in no kind. Where any place of the chain is offered, the
 * refusal stands and the kind that offers it takes the work (ADR-0102). What
 * stands outdoors by what it is is a colossal statue or an obelisk
 * (`OUTDOOR_CLASSES`): a sculpture may be in a hall, and the Veiled Christ is;
 * a memorial may be a plaque in a nave.
 */
function strandedOutdoors(held: HeldElsewhere, classes: string[], offered: ReadonlySet<string>): boolean {
  if (!held.venue || held.heldIn.some((qid) => offered.has(qid))) return false;
  return classes.some((c) => OUTDOOR_CLASSES[c]);
}

/**
 * Whether an entity is of the kind `rule` names, and why not.
 *
 * `offered` is the item ids of the places another kind offers a reader. Given, a
 * work stranded outdoors on a venue none of them is stays this kind's
 * (`strandedOutdoors`); omitted, every venue refusal stands.
 */
export function publicArtVerdict(
  e: PublicArtFacts, trees: PublicArtTrees, rule: KindRule, offered?: ReadonlySet<string>,
): PublicArtResult {
  const not = `not ${rule.noun}`;
  // What it is, before whether it is ours: a kill class names the thing
  // better than "no public-art class" would, so it is asked first.
  if (e.classes.some((c) => trees.worship.has(c))) {
    return { pass: false, reason: `a place of worship, ${not}` };
  }
  // Not the museum rule's `kill-list:` prefix: the review page translates
  // that one and explains it as curatorial departments and museum networks,
  // which is nobody's reason for turning down a mausoleum. This form reaches
  // the card as it is.
  const killed = named(e.classes, KILL_CLASSES);
  if (killed.length) {
    return { pass: false, reason: `${not}: ${killed.join('; ')}` };
  }
  // The works-first kinds' one exception by name holds here too: a destroyed
  // work whose remains are what a traveller stands in front of.
  if (!REMAINS_ON_SHOW[e.qid] && e.classes.some((c) => trees.lost.has(c))) {
    return { pass: false, reason: `${not}: lost or destroyed, nothing to stand in front of` };
  }

  if (!rule.admits(e, trees)) {
    return { pass: false, reason: rule.noClass };
  }

  if (!e.onEarth) {
    return { pass: false, reason: 'not on Earth: its coordinate (P625) is on another globe' };
  }

  const place = otherPlace(e, trees);
  if (place) {
    return { pass: false, reason: `a ${place}, which no kind holds yet: ${not}` };
  }

  const another = anothersWork(e, trees, rule.noun, offered);
  if (another) {
    return another.heldIn.length
      ? { pass: false, reason: another.reason, heldIn: another.heldIn }
      : { pass: false, reason: another.reason };
  }

  const answered = rule.answersVeto(e, trees);
  if (!answered) {
    const vetoed = vetoes(e.classes, trees, rule.memorialLifts);
    if (vetoed.length) {
      return { pass: false, reason: `${rule.unanswered}, and typed: ${vetoed.join('; ')}` };
    }
  }
  // Answered by the kind: an artwork class, or a memorial that lifted every
  // veto the place carries.
  const artwork = answered || (rule.memorialLifts && named(e.classes, VETO_CLASSES).length > 0);

  // Number.isFinite, not truthiness: a monument on the equator has a coordinate of 0.
  if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon)) {
    return { pass: false, reason: 'no coordinates of its own (P625)' };
  }

  return { pass: true, type: rule.type(e, trees), artwork };
}
