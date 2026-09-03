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
}

export const KILL_CLASSES: Record<string, string> = {
  Q7328910: 'art collection — a holding, not a place',
  Q768717: 'private collection — a holding, not a place',
  Q11681271: 'curatorial department of the Louvre',
  Q88667167: 'museum network — an umbrella, not a visit',
  Q811683: 'proposed building or structure — the Führermuseum was never built',
  Q13406463: 'Wikimedia list article',
};

/**
 * Classes that describe a place rather than an institution, read off the real entities the
 * first run wrongly admitted: a church building or cathedral (Antwerp Cathedral, the Church of
 * Our Lady in Bruges), an archaeological park, Roman archaeological site or Roman ruins (the
 * Roman Forum and the Palatine), a villa (the Villa Farnesina). Wikidata also types every one of
 * them `museum` directly, so they clear the class check below and need a veto of their own — one
 * that must not fire on an entity that also carries an `ART_CLASSES` member, since a great many
 * real art museums are also palaces, villas or former churches (the Uffizi, typed `palace, art
 * museum`, is exactly this shape).
 */
export const SITE_CLASSES: Record<string, string> = {
  Q16970: 'church building',
  Q56242215: 'Catholic cathedral',
  Q3363945: 'archaeological park',
  Q21752084: 'Roman archaeological site',
  Q133444874: 'roman ruins',
  Q3950: 'villa',
};

export type VenueResult = { pass: true } | { pass: false; reason: string };

export function venueVerdict(e: VenueFacts, museumClasses: ReadonlySet<string>): VenueResult {
  const killed = e.classes.filter((c) => KILL_CLASSES[c]);
  if (killed.length) {
    return { pass: false, reason: `kill-list: ${killed.map((c) => KILL_CLASSES[c]).join('; ')}` };
  }
  if (e.dissolved) {
    return { pass: false, reason: `dissolved ${e.dissolved.slice(0, 10)} (P576)` };
  }
  if (!e.classes.some((c) => museumClasses.has(c))) {
    return { pass: false, reason: 'not a museum class' };
  }
  const site = e.classes.filter((c) => SITE_CLASSES[c]);
  if (site.length && !e.classes.some((c) => ART_CLASSES[c])) {
    return { pass: false, reason: `site, not a venue: ${site.map((c) => SITE_CLASSES[c]).join('; ')}` };
  }
  // Number.isFinite, not truthiness: a museum on the equator has a coordinate of 0.
  if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon)) {
    return { pass: false, reason: 'no coordinates of its own (P625)' };
  }
  return { pass: true };
}
