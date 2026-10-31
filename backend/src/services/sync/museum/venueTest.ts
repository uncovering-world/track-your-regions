/**
 * A venue is a place you buy a ticket to. Wikidata will call a curatorial department, a dead
 * collector's collection and a stretch of the Berlin Wall a museum, so the class test is a
 * necessary condition with a veto list on top.
 *
 * The veto entries are *classes*, not named entities: a rule about kinds of thing, which a
 * curator verdict can extend without a deploy. Entity-level exclusions live in `EDITORIAL_OUT`
 * (`artTest.ts`), not here, and they are load-bearing: the works-first rule once kept the
 * MuseumsQuartier (Q699943) out on its own, because only a venue holding a work could be folded
 * into — but the door rule (#781) offers a venue's location as a fold target whether or not a
 * work names it, and the quarter is typed an art museum, better known than the Leopold Museum
 * and 78 m from it. It is kept from being a door only because it is named.
 */

import { ART_CLASSES } from './artTest.js';

export interface VenueFacts {
  qid: string;
  classes: string[];
  lat: number | null;
  lon: number | null;
  dissolved: string | null;
  /**
   * Whether the entity is an organisation of several houses (#798,
   * `VenueGraph.isOrganisation`): a museum it counts among its parts stands
   * farther from it than the container radius. Read for a holding that is also
   * typed a museum (#1617): the Frick Collection is one house and a visit, the
   * Bavarian State Painting Collections are twenty and an umbrella.
   */
  housesApart?: boolean;
}

/**
 * The holdings: a collection is what someone owns, not a place to buy a
 * ticket to — the Crozat and Demidov collections, the Cook collection that
 * once held the Salvator Mundi. Wikidata also types some real museums a
 * collection, the Frick Collection and the Carnegie Museum of Art among them
 * (#1617), so a holding that carries a museum class, has coordinates of its
 * own and is one house rather than an umbrella of several is the museum its
 * other class says, and the veto below does not fire on it.
 */
export const HOLDING_CLASSES: Record<string, string> = {
  Q7328910: 'art collection — a holding, not a place',
  Q768717: 'private collection — a holding, not a place',
};

/**
 * The umbrellas: a museum network is never a visit — Tate, National Galleries
 * Scotland, Museum Wales, the Museo Soumaya are each several houses — and the
 * veto always fires. Where a work names one, the walk stands it for the house
 * at its own coordinate (`resolveVenue`, `VenueGraph.houseOf`, #1617): the
 * Soumaya's item sits on Plaza Carso.
 */
export const UMBRELLA_CLASSES: Record<string, string> = {
  Q88667167: 'museum network — an umbrella, not a visit',
};

export const KILL_CLASSES: Record<string, string> = {
  ...HOLDING_CLASSES,
  Q11681271: 'curatorial department of the Louvre',
  ...UMBRELLA_CLASSES,
  Q811683: 'proposed building or structure — the Führermuseum was never built',
  Q13406463: 'Wikimedia list article',
};

/** Whether the entity is a museum network (`UMBRELLA_CLASSES`). */
export const isUmbrella = (classes: readonly string[]): boolean => classes.some((c) => UMBRELLA_CLASSES[c]);

/**
 * Classes that describe a place rather than an institution: a church building, minor basilica or
 * cathedral (Antwerp Cathedral, the Church of Our Lady in Bruges, Santa Maria Novella, which
 * Places of worship shows with Masaccio's *Trinity*), an archaeological park, Roman
 * archaeological site or Roman ruins (the Roman Forum and the Palatine), a villa. Wikidata also
 * types every one of them `museum` directly, so they clear the class check below and need a veto
 * of their own — one that must not fire on an entity that also carries an `ART_CLASSES` member,
 * since a great many real art museums are also palaces, villas or former churches (the Uffizi,
 * typed `palace, art museum`, is exactly this shape).
 */
export const SITE_CLASSES: Record<string, string> = {
  Q16970: 'church building',
  Q120560: 'minor basilica',
  Q56242215: 'Catholic cathedral',
  Q3363945: 'archaeological park',
  Q21752084: 'Roman archaeological site',
  Q133444874: 'roman ruins',
  Q3950: 'villa',
};

/**
 * The place classes that are buildings, as against the grounds of a dig or a park: a building
 * Wikidata also types a museum of its own building (`HOUSE_MUSEUM_CLASSES`) is that museum.
 */
const BUILDING_SITE_CLASSES: ReadonlySet<string> = new Set(['Q16970', 'Q120560', 'Q56242215', 'Q3950']);

/**
 * Museum classes that say the building itself is the museum: a palazzo museum, a historic house
 * museum (Wikidata holds two items of that name, both under `museum`). The Villa Farnesina is
 * typed `villa; palazzo museum`, and a visitor buys a ticket to it for Raphael's frescoes on its
 * walls; Antwerp Cathedral and the Church of Our Lady in Bruges are typed `museum` alone, and stay
 * churches, which the places-of-worship kind lists.
 */
export const HOUSE_MUSEUM_CLASSES: Record<string, string> = {
  Q112132542: 'palazzo museum',
  Q2087181: 'historic house museum',
  Q5755620: 'historic house museum',
};

export type VenueResult = { pass: true } | { pass: false; reason: string };

/**
 * What a kind counts as a venue: the classes an entity must carry one of, and
 * whether a place class (`SITE_CLASSES`) vetoes it. The museum rule vetoes —
 * a church is not a museum though Wikidata types it one — and a kind whose
 * venues *are* those places switches the veto off (#753).
 */
export interface VenueRule {
  classes: ReadonlySet<string>;
  siteVeto: boolean;
  /** The word in the reason: `not a museum class`. */
  noun: string;
  /**
   * The library and archives trees: a work whose location is a reading room, or a department of
   * one, stays there. It is not placed at what the room is `part of`, nor at an owner its other
   * statements name, since it is read there by appointment, not shown. Places of worship sets
   * it: the Laurentian Library is part of San Lorenzo's complex, and a visitor to the basilica
   * sees none of its codices (#2150).
   */
  readingRooms?: ReadonlySet<string>;
}

export function museumRule(classes: ReadonlySet<string>): VenueRule {
  return { classes, siteVeto: true, noun: 'museum' };
}

/**
 * What a dissolution of unknown date is read as: Wikidata says the venue
 * closed and nobody can say when, which refuses it as surely as a date does.
 */
export const DISSOLVED_UNKNOWN = 'unknown';

/**
 * Whether a holding class is forgiven (#1617): the entity also carries a class
 * of the rule, stands somewhere of its own and is one house, not an umbrella of
 * several. The Frick Collection and the Carnegie Museum of Art are museums
 * Wikidata also calls collections; the Bavarian State Painting Collections are
 * twenty houses, and stay a holding.
 */
function museumDespiteHolding(e: VenueFacts, rule: VenueRule): boolean {
  return e.classes.some((c) => rule.classes.has(c))
    && Number.isFinite(e.lat) && Number.isFinite(e.lon)
    && e.housesApart !== true;
}

export function venueVerdict(e: VenueFacts, rule: VenueRule): VenueResult {
  const forgiven = museumDespiteHolding(e, rule);
  const killed = e.classes.filter((c) => KILL_CLASSES[c] && !(forgiven && HOLDING_CLASSES[c]));
  if (killed.length) {
    return { pass: false, reason: `kill-list: ${killed.map((c) => KILL_CLASSES[c]).join('; ')}` };
  }
  if (e.dissolved) {
    const when = e.dissolved === DISSOLVED_UNKNOWN ? ', date unknown' : ` ${e.dissolved.slice(0, 10)}`;
    return { pass: false, reason: `dissolved${when} (P576)` };
  }
  if (!e.classes.some((c) => rule.classes.has(c))) {
    return { pass: false, reason: `not a ${rule.noun} class` };
  }
  const houseMuseum = e.classes.some((c) => HOUSE_MUSEUM_CLASSES[c]);
  const site = e.classes.filter((c) => SITE_CLASSES[c] && !(houseMuseum && BUILDING_SITE_CLASSES.has(c)));
  if (rule.siteVeto && site.length && !e.classes.some((c) => ART_CLASSES[c])) {
    return { pass: false, reason: `site, not a venue: ${site.map((c) => SITE_CLASSES[c]).join('; ')}` };
  }
  // Number.isFinite, not truthiness: a museum on the equator has a coordinate of 0.
  if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon)) {
    return { pass: false, reason: 'no coordinates of its own (P625)' };
  }
  return { pass: true };
}
