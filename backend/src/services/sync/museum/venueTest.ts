/**
 * A venue is a place you buy a ticket to. Wikidata will call a curatorial department, a dead
 * collector's collection and a stretch of the Berlin Wall a museum, so the class test is a
 * necessary condition with a veto list on top.
 *
 * The veto entries are *classes*, not named entities: a rule about kinds of thing, which a
 * curator verdict can extend without a deploy. Entity-level exclusions belong in the curation
 * gate, not here — measured: the works-first rule already excludes MuseumsQuartier (Q699943)
 * and the National Library of Australia (Q623578) without naming them.
 */
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
  // Number.isFinite, not truthiness: a museum on the equator has a coordinate of 0.
  if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon)) {
    return { pass: false, reason: 'no coordinates of its own (P625)' };
  }
  return { pass: true };
}
