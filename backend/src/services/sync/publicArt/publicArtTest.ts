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
  BURIAL_CLASSES,
  COMMEMORATIVE_FLOOR,
  COMMEMORATIVE_FORMS,
  KILL_CLASSES,
  MEMORIAL_LIFTED_KILLS,
  VETO_CLASSES,
  INDOOR_CLASSES,
  OUTDOOR_CLASSES,
  PUBLIC_CLOCK_CLASSES,
  SITE_CLASSES,
  OTHER_PLACE_CLASSES,
  MEMORIAL_LIFTS,
  type PublicArtTrees,
} from './classes.js';
import { formsOf, type KindRule, type MonumentType, type PublicArtType } from './kindRules.js';
// The works-first kinds' exception for a lost work whose remains are on show (#872).
import { REMAINS_ON_SHOW } from '../museum/worksCollector.js';
import type { ContainerFact } from '../places/containment.js';
import type { SubjectFacts } from './subjects.js';

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
  /** `P136`, the genre the entity is filed under. */
  genres: string[];
  /** What each item it depicts is, for the ones that were read. */
  subjects: SubjectFacts[];
  /**
   * The casts of a group of casts, each with what it stands in (#2036): where
   * given, the group is judged at its casts rather than at its own containers
   * and owners. Absent for everything else, a group with no cast item included.
   * A cast's own classes, where read, decide its venue exception; the group's
   * classes stand in otherwise.
   */
  casts?: { containers: ContainerFact[]; classes?: string[] }[];
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
    /**
     * For a group of casts judged at its casts, the positions of the casts a
     * traveller can walk up to (#2036): the kind shows only those. A cast in a
     * museum is the museum's to show, not a public-art point.
     */
    openCasts?: number[];
    /**
     * For such a group, where its held casts stand, nearest first, then the
     * places the group's own statements name (#2036): recorded as a hand-over
     * (ADR-0102), so the museum that holds a cast takes the work although
     * another cast makes it public art.
     */
    handOver?: { reason: string; heldIn: string[] };
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
 * `P547` statement is a memorial too — the USS Arizona Memorial, typed a
 * museum, commemorates the ship (#1832) — and a memorial lifts a cemetery's veto and a bare
 * building's (`MEMORIAL_LIFTS`): Arlington is a cemetery a traveller visits
 * as a memorial, and Montjuïc Castle, typed a memorial, is still a castle.
 */
function vetoes(e: PublicArtFacts, trees: PublicArtTrees, memorialLifts: boolean): string[] {
  const memorial = e.classes.some((c) => trees.commemorative.has(c))
    || (memorialLifts && e.commemorates.length > 0);
  const lifted = (c: string) => memorialLifts && memorial && Boolean(MEMORIAL_LIFTS[c]);
  return [
    ...(!memorial && e.classes.some((c) => trees.museum.has(c)) ? ['a museum'] : []),
    ...named(e.classes.filter((c) => !lifted(c)), VETO_CLASSES),
  ];
}

/**
 * The kill classes the entity carries, named. Where `memorialLifts`, a
 * commemorative form lifts the burial ones: the Monumento a la Revolución is
 * a triumphal arch with a mausoleum in it (#1832). And a commemorative class
 * lifts the organisation, attraction and burial kills
 * (`MEMORIAL_LIFTED_KILLS`, #1989): Yad Vashem is an archive and a research
 * institute, Anıtkabir a mausoleum, and each is the memorial a traveller goes
 * to. The class is read off the pinned floor (`COMMEMORATIVE_FLOOR`), not the
 * walked tree, so the catalogue check reads the same list.
 */
function kills(e: PublicArtFacts, memorialLifts: boolean): string[] {
  const form = memorialLifts && formsOf(e).some((c) => COMMEMORATIVE_FORMS[c]);
  const memorial = memorialLifts && e.classes.some((c) => COMMEMORATIVE_FLOOR[c]);
  return named(
    e.classes.filter((c) => !(form && BURIAL_CLASSES[c]) && !(memorial && MEMORIAL_LIFTED_KILLS[c])),
    KILL_CLASSES,
  );
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
 * A link of the chain nobody could read (`containment.ts`), when nothing read
 * decided: the place it names may be the museum or the church the work is in,
 * so the work is not taken for one standing outdoors (#1819).
 */
function unreadLink(links: ContainerFact[], what: 'where it stands' | 'whose it is', noun: string): HeldElsewhere | null {
  const unread = links.find((c) => c.unknown);
  return unread ? { reason: `${what} could not be read (${unread.qid}): not taken for ${noun}`, heldIn: [] } : null;
}

/**
 * The place that makes a work standing in `places` somebody else's, or
 * nothing: a venue, a room or a site, or a link nobody could read.
 */
function placedElsewhere(
  places: ContainerFact[], classes: string[], trees: PublicArtTrees, noun: string, offered?: ReadonlySet<string>,
): HeldElsewhere | null {
  const venue = heldElsewhere(places, trees, noun);
  // The room and the site are still asked of a work stranded outdoors: a
  // colossal statue in a museum's hall is the hall's.
  if (venue && offered && strandedOutdoors(venue, classes, offered)) return heldElsewhere(places, trees, noun, false);
  return venue ?? unreadLink(places, 'where it stands', noun);
}

/** What holds each cast of a group of casts, by where it stands; null for a cast a traveller can walk up to. */
function castHolders(
  casts: { containers: ContainerFact[]; classes?: string[] }[], classes: string[], trees: PublicArtTrees, noun: string, offered?: ReadonlySet<string>,
): (HeldElsewhere | null)[] {
  // Each cast by its own classes: the group's carry every cast's, and one cast
  // being a colossal statue must not keep another off a museum's grounds.
  return casts.map((cast) => placedElsewhere(placesAndOwners(cast.containers, trees).places, cast.classes ?? classes, trees, noun, offered));
}

/**
 * The place or owner that makes a work in one place somebody else's, or
 * nothing: where it stands decides, and whose it is only when nothing says
 * where it stands.
 */
function heldAsOne(
  e: PublicArtFacts, trees: PublicArtTrees, noun: string, offered?: ReadonlySet<string>,
): HeldElsewhere | null {
  const { places, owners } = placesAndOwners(e.containers, trees);
  if (places.length) return placedElsewhere(places, e.classes, trees, noun, offered);
  const allOwners = [...owners, ...e.collections];
  return ownedElsewhere(allOwners, trees, noun) ?? unreadLink(allOwners, 'whose it is', noun);
}

/**
 * How a group of casts stands at its casts (#2036): each cast is the whole work
 * (ADR-0145 decision 5), so the group's own containers say nothing — Wikidata
 * places *The Thinker* in Musée Rodin, Strasbourg's museum and Buenos Aires at
 * once. A cast is judged by where it stands, as a work in one place is; whose
 * collection a cast is in is not read. The casts a passer-by can walk up to are
 * the kind's (`open`, by position); the held ones are handed to their holders
 * (`held`), and then to the places the group's own statements name, so the
 * museum Wikidata places the group in takes it as its work (ADR-0102) whether
 * or not another cast makes it public art.
 */
function castsStanding(
  e: PublicArtFacts & { casts: NonNullable<PublicArtFacts['casts']> },
  trees: PublicArtTrees, noun: string, offered?: ReadonlySet<string>,
): { open: number[]; held: HeldElsewhere | null } {
  const holders = castHolders(e.casts, e.classes, trees, noun, offered);
  const open = holders.flatMap((at, i) => (at ? [] : [i]));
  const held = holders.filter((at): at is HeldElsewhere => at !== null);
  if (!held.length) return { open, held: null };
  const own = heldAsOne(e, trees, noun, offered);
  return {
    open,
    held: {
      reason: held.length === 1 ? held[0].reason : held.map((h) => h.reason).join('; '),
      heldIn: [...new Set([...held.flatMap((h) => h.heldIn), ...(own?.heldIn ?? [])])],
    },
  };
}

/**
 * The place or owner that makes the entity somebody else's work, or nothing.
 * A group of casts is somebody else's only when every cast is held, and the
 * refusal names every holder: Musée Rodin, where Wikidata places *The Thinker*,
 * takes it as its work even while the one cast item Wikidata keeps stands at the
 * Kyoto National Museum.
 */
function anothersWork(
  e: PublicArtFacts, trees: PublicArtTrees, noun: string, offered?: ReadonlySet<string>,
): HeldElsewhere | null {
  if (!e.casts?.length) return heldAsOne(e, trees, noun, offered);
  const { open, held } = castsStanding({ ...e, casts: e.casts }, trees, noun, offered);
  if (open.length || !held) return null;
  return e.casts.length === 1 ? held : { ...held, reason: `every cast is held — ${held.reason}` };
}

/**
 * A work that stands outdoors on the grounds of a venue no other kind offers a
 * reader stays public art (#1444): refused as the venue's, it would be on no
 * card at all. The Mother Ukraine Monument stands on the hill of a war museum
 * the catalogue holds in no kind. Where any place of the chain is offered, the
 * refusal stands and the kind that offers it takes the work (ADR-0102). What
 * stands outdoors by what it is is a colossal statue or an obelisk
 * (`OUTDOOR_CLASSES`), and a public clock is shown to the street: a sculpture
 * may be in a hall, and the Veiled Christ is; a memorial may be a plaque in a
 * nave.
 */
function strandedOutdoors(held: HeldElsewhere, classes: string[], offered: ReadonlySet<string>): boolean {
  if (!held.venue || held.heldIn.some((qid) => offered.has(qid))) return false;
  return classes.some((c) => OUTDOOR_CLASSES[c] || PUBLIC_CLOCK_CLASSES[c]);
}

/** What an admitted group of casts shows and hands over (#2036): nothing for any other work. */
function castsShown(
  e: PublicArtFacts, trees: PublicArtTrees, noun: string, offered?: ReadonlySet<string>,
): { openCasts?: number[]; handOver?: { reason: string; heldIn: string[] } } {
  if (!e.casts?.length) return {};
  const { open, held } = castsStanding({ ...e, casts: e.casts }, trees, noun, offered);
  // The held casts' own reason: whether the kind then admits the work is the
  // fame line's to say, and the decision words the hand-over by it.
  const handOver = held && { reason: held.reason, heldIn: held.heldIn };
  return { openCasts: open, ...(handOver ? { handOver } : {}) };
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
  const killed = kills(e, rule.memorialLifts);
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
    const vetoed = vetoes(e, trees, rule.memorialLifts);
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

  return { pass: true, type: rule.type(e, trees), artwork, ...castsShown(e, trees, rule.noun, offered) };
}
