/**
 * How a World Heritage component no Wikidata item records the reference of is
 * matched to a candidate item (#1272): pure rules, so they can be measured and
 * tested apart from the queries that feed them (`componentItemFinder.ts`).
 *
 * Calibrated on the 3 933 components that already resolve by their reference
 * (#1269), measured on 2026-10-09 against live Wikidata: the item's coordinate
 * lies within 25 m of the UNESCO point at the median, 290 m at the 75th
 * percentile and 1.8 km at the 90th (a park, a road or a beach is a large
 * thing with one coordinate); the best of the item's labels is trigram-similar
 * to the component's name at 0.89 at the median and 0.22 at the 10th
 * percentile. The items are of hundreds of classes — archaeological sites,
 * caves with prehistoric art, protected areas, roads, churches, walls, islands,
 * belfries, castra — so no fixed list of classes describes them.
 *
 * The rules, each a reason a curator reads on the card:
 * - **part of the site** — the item says it is part of the site's own item
 *   (P361), and only lacks the component's number. No class is asked: Wikidata
 *   has said what it is a part of. Aalto Works' Villa Mairea, the D-Day beaches.
 * - **near, of the site's kind** — an item close to the point whose class is
 *   one the site's resolved components are of (a fort beside the Limes' forts),
 *   or, for a site with none resolved, one of the classes the resolved
 *   components of several sites are of. A settlement is a candidate only where the site's own
 *   components include settlements: a fort named after a village is not the
 *   village.
 * - **numbered under another inscription** — the item carries the component's
 *   number under another variant of the inscription (#1394): `1593-006` on
 *   Wikidata, `1593bis-006` on the list. Proposed beside what the other rules
 *   find, never instead, and only where the name agrees, since an extension can
 *   renumber the parts.
 * - **named for a place in the component's name** — where the near rule finds
 *   nothing, a candidate of the site's kind whose label holds one of the
 *   places the component's name is made of (#1340): "Castrul roman de la
 *   Gresia" for "Gresia - La Biserică".
 */

export type MatchBasis = 'part_of' | 'near' | 'numbered' | 'toponym';

export interface ComponentPoint {
  locationId: number;
  name: string | null;
  lat: number;
  lon: number;
  /**
   * The World Heritage list placed it only roughly (#1853): to the whole
   * minute, or on the point the property's other components share. A
   * candidate's coordinate on that very point is a copy of it, not a
   * measurement, and is not counted (`COPIED_COORDINATE_M`).
   */
  approximate?: boolean;
}

/**
 * Within this of an approximate point, a candidate's coordinate is the list's
 * point copied: Wikidata's item for ancient Zvartnots carries Echmiatsin's
 * shared point, and was offered to the Cemetery of Congregation "1 m away".
 */
export const COPIED_COORDINATE_M = 1;

export interface CandidateItem {
  item: string;
  /** Every label the item has, in any language: a component is often named in its own. Empty until read. */
  labels: string[];
  /** The label a curator reads it by — its English one, else its multilingual (`mul`) one — or null where it has neither. Unset until read. */
  englishLabel?: string | null;
  /** Every coordinate the item states. */
  coords: Array<[lat: number, lon: number]>;
  /** Its P31 classes, for the near rule. */
  classes?: string[];
  /** The World Heritage references it carries (P757), where the part-of door read them: a part claiming another site is not this site's. */
  references?: string[];
}

export interface ComponentMatch {
  locationId: number;
  item: string;
  /**
   * The label shown on the card: the item's English label, the product's
   * language, else its multilingual (`mul`) one (#1358); the one most like the
   * component's name only where it has neither. Matching reads every label
   * either way.
   */
  label: string;
  distanceM: number;
  similarity: number;
  /** The same name, folded, within `EXACT_DISTANCE_M`: marked so a curator can accept them together. */
  exact: boolean;
  basis: MatchBasis;
  /** The item's coordinate nearest the point, for the card's map; null where it states none. */
  itemLat: number | null;
  itemLon: number | null;
  /** The item's national register code as the card shows it ("LMI CJ-I-s-A-07208"), once read (#1340). */
  registerCode?: string | null;
  /** Whether the code's group differs from the one most of the site's coded candidates carry. */
  registerDisagrees?: boolean;
}

/** Within this, a component and an item of the same name are one place by every measure the catalogue has. */
export const EXACT_DISTANCE_M = 50;
/** How far a near candidate may lie: the 75th percentile of resolved components is 290 m. */
export const NEAR_RADIUS_M = 500;
/** How far one of the site's own parts may lie with a similar name: the 90th percentile is 1.8 km. */
export const PART_RADIUS_M = 2000;
/** How far one of the site's own parts of the very same name may lie: a beach, a park, a road. */
export const SAME_NAME_RADIUS_M = 5000;
/**
 * How far a near candidate of the very same name may lie. Its labels are read
 * only within this distance (`componentItemQueries.ts`), so nothing farther can
 * be known to share the name. A kilometre, where the near rule's true matches
 * lay within 413 m at the 90th percentile on 2026-10-09: reading names out to
 * 2 km meant 42,653 candidates' labels, four times the area for the few beaches
 * and roads beyond a kilometre.
 */
export const NEAR_SAME_NAME_RADIUS_M = 1000;
/** The name similarity below which a near item is not proposed: the 10th percentile of true pairs is 0.22. */
export const MIN_SIMILARITY = 0.3;
/**
 * How close one of the site's parts must stand to be taken whatever its name:
 * Voislova's component is named after its railway halt and its item is the fort
 * of Pons Augusti, at 0 m. Farther than this, a part with an unlike name was a
 * building inside a wider component (the 1901 exhibition grounds of
 * Mathildenhöhe offered its Wedding Tower, at 78 m).
 */
export const PART_SAME_SPOT_M = 25;
/**
 * A component named like its site is the whole site, whose item is the site's
 * own (ADR-0088): the same name, folded, and no looser. "Historic Centre of
 * Siena (Cathedral)" is similar to its site at 0.71 and is a part of it.
 */


/**
 * A name as the comparison reads it: accents, case and punctuation dropped, so
 * "Château de Chambord" and "chateau de chambord" are one name. Looser than
 * `foldLabel`, which keeps accents because it decides what a stored label is.
 */
const matchKey = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const trigrams = (text: string): Set<string> => {
  const padded = `  ${matchKey(text)} `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i += 1) grams.add(padded.slice(i, i + 3));
  return grams;
};

/** Trigram similarity of two names, case, accents and punctuation folded: the Jaccard index of their trigram sets, 0 to 1. */
export function nameSimilarity(a: string, b: string): number {
  const ga = trigrams(a);
  const gb = trigrams(b);
  let shared = 0;
  for (const gram of ga) if (gb.has(gram)) shared += 1;
  const union = ga.size + gb.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Metres between two points, equirectangular: exact enough at the radii these rules ask about. */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const x = (lon2 - lon1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
  const y = (lat2 - lat1) * rad;
  return Math.sqrt(x * x + y * y) * 6371008.8;
}

const sameName = (a: string, b: string) => matchKey(a) === matchKey(b);

/** The shortest place name a component's name is read for: a shorter piece is a word, not a place. */
const TOPONYM_MIN_LETTERS = 4;

/**
 * The place names a component's name is made of, folded: the World Heritage
 * list writes a component as places joined by a dash with a space before it or
 * by a slash — "Turda - Potaissa / Dealul Cetății", "Iaz – Tibiscum / Traianu"
 * — while a hyphen inside a town's name joins one place ("Drobeta-Turnu
 * Severin").
 */
export function toponymsOf(name: string): string[] {
  const pieces = name.split('/').flatMap(piece => piece.split(/\s[-–]/));
  // A name of one piece is one place, and every building in it holds that
  // name: "Žatec" would take any house "(Žatec)". The list's "place - what it
  // is" shape is what makes a piece a place of the component's own.
  if (pieces.length < 2) return [];
  return pieces.map(matchKey).filter(piece => piece.replace(/[^\p{L}]/gu, '').length >= TOPONYM_MIN_LETTERS);
}

/**
 * Whether a label holds one of the component's place names as whole words:
 * "Castrul roman Potaissa" holds "Potaissa", which the trigram similarity
 * scores 0.20 against "Turda - Potaissa / Dealul Cetății", the generic
 * "Castrul roman" diluting the one word the two share (#1340).
 */
export function holdsToponym(name: string, label: string): boolean {
  const words = ` ${matchKey(label)} `;
  return toponymsOf(name).some(place => words.includes(` ${place} `));
}

/**
 * The place names of a component past the town it leads with: "Enns – St.
 * Laurenz" is the basilica's own name beside its town's, which every listed
 * building in Enns holds too.
 */
export function ownToponymsOf(name: string): string[] {
  const town = matchKey(name.split('/')[0].split(/\s[-–]/)[0]);
  return toponymsOf(name).filter(place => place !== town);
}

/**
 * A label without its trailing qualifier: "Dům čp. 7 (Žatec)" names a house,
 * and read with its town it looked like the component named "Žatec".
 */
function withoutQualifier(label: string): string {
  const trimmed = label.trimEnd();
  const open = trimmed.lastIndexOf('(');
  if (!trimmed.endsWith(')') || open <= 0) return label;
  return trimmed.slice(0, open).trimEnd() || label;
}

/** A name with its markup taken out: UNESCO writes `<em>Regina Viarum</em>` into a few. */
function withoutTags(name: string): string {
  let out = '';
  let inTag = false;
  for (const ch of name) {
    if (ch === '<') inTag = true;
    else if (ch === '>') inTag = false;
    else if (!inTag) out += ch;
  }
  return out;
}

/**
 * Whether a component stands for its whole site: the only standing point of a
 * site of one, or a point named like the site ("Historic Centre of Siena"). Its
 * item is the site's own, which carries the site's World Heritage reference and
 * is never a candidate; anything near it is a building inside, not the place.
 */
export function standsForWholeSite(pointName: string | null, siteName: string, standingPoints: number): boolean {
  if (standingPoints <= 1) return true;
  return pointName !== null && sameName(pointName, withoutTags(siteName));
}

/** The candidate's coordinate nearest the point, with the distance; null where it states none. */
function nearest(point: ComponentPoint, candidate: CandidateItem): { at: [lat: number, lon: number]; metres: number } | null {
  let found: { at: [number, number]; metres: number } | null = null;
  for (const [lat, lon] of candidate.coords) {
    const metres = distanceM(point.lat, point.lon, lat, lon);
    if (point.approximate && metres < COPIED_COORDINATE_M) continue;
    if (!found || metres < found.metres) found = { at: [lat, lon], metres };
  }
  return found;
}

/** Metres from the point to the nearest coordinate the candidate states; Infinity where it states none. */
export function nearestM(point: ComponentPoint, candidate: CandidateItem): number {
  return nearest(point, candidate)?.metres ?? Infinity;
}

/**
 * The readings of a component's name its similarity is taken over: the whole
 * name, and the name before its first comma. The list appends a description of
 * the kind of place there ("Rusovce – Gerulata, rímsky vojenský tábor
 * (kastel)", a Roman military camp), and in a trigram measure the description
 * outweighs the name: Castra Gerulata, 63 m away, scores 0.18 against the
 * whole and 0.44 against "Rusovce – Gerulata" (#1672).
 */
export function nameReadings(name: string): string[] {
  const head = name.split(',')[0].trim();
  return head && head !== name.trim() ? [name, head] : [name];
}

/** How one candidate stands against one point: its nearest coordinate and its most similar label. */
function measure(point: ComponentPoint, candidate: CandidateItem) {
  const closest = nearest(point, candidate);
  const distance = closest?.metres ?? Infinity;
  let label = candidate.labels[0] ?? candidate.item;
  let similarity = 0;
  let exactName = false;
  let toponym = false;
  const readings = point.name ? nameReadings(point.name) : [];
  for (const each of candidate.labels) {
    const bare = withoutQualifier(each);
    const s = Math.max(0, ...readings.map(reading => nameSimilarity(reading, bare)));
    if (s > similarity) { similarity = s; label = each; }
    if (point.name && sameName(point.name, each)) { exactName = true; label = each; similarity = 1; }
    // Without its trailing qualifier, as the name rule reads it: "(Žatec)" names the town a house is in.
    if (point.name && holdsToponym(point.name, withoutQualifier(each))) toponym = true;
  }
  return { distance, at: closest?.at ?? null, label, similarity, exactName, toponym };
}

/** Whether a candidate passes the rule its basis names. */
function passes(basis: MatchBasis, m: ReturnType<typeof measure>): boolean {
  if (m.exactName && m.distance <= (basis === 'near' ? NEAR_SAME_NAME_RADIUS_M : SAME_NAME_RADIUS_M)) return true;
  if (basis === 'part_of') return m.distance <= PART_RADIUS_M && (m.similarity >= MIN_SIMILARITY || m.distance <= PART_SAME_SPOT_M);
  // The number names the component, and an extension may have renumbered the
  // parts, so the name decides; the distance only bounds it to the component's ground.
  if (basis === 'numbered') return m.distance <= SAME_NAME_RADIUS_M && m.similarity >= MIN_SIMILARITY;
  // Out to the same-name radius: the Dacian points are written to an
  // arc-minute, about a kilometre, and the castra the names find stand
  // 485–997 m from them (Apulum, Potaissa, Angustia).
  if (basis === 'toponym') return m.distance <= NEAR_SAME_NAME_RADIUS_M && m.toponym;
  return m.distance <= NEAR_RADIUS_M && m.similarity >= MIN_SIMILARITY;
}

/** One candidate as a match for one point under one rule, or null where the rule does not admit it. */
function matchOf(point: ComponentPoint, candidate: CandidateItem, basis: MatchBasis): ComponentMatch | null {
  const m = measure(point, candidate);
  if (!passes(basis, m)) return null;
  return {
    locationId: point.locationId,
    item: candidate.item,
    label: candidate.englishLabel ?? m.label,
    distanceM: Math.round(Number.isFinite(m.distance) ? m.distance : -1),
    similarity: Math.round(m.similarity * 100) / 100,
    exact: m.exactName && m.distance <= EXACT_DISTANCE_M,
    basis,
    itemLat: m.at?.[0] ?? null,
    itemLon: m.at?.[1] ?? null,
  };
}

/**
 * Every candidate carrying the point's number under another inscription that
 * the rule admits (#1394), each a question of its own: two villages carry
 * Frederiksoord-Wilhelminaoord's number, and choosing one would be guessing.
 */
export function numberedMatches(
  point: ComponentPoint, candidates: readonly CandidateItem[], refused: ReadonlySet<string> = new Set(),
): ComponentMatch[] {
  return candidates.filter(c => !refused.has(c.item))
    .map(c => matchOf(point, c, 'numbered'))
    .filter((match): match is ComponentMatch => match !== null);
}

/**
 * The best candidate for one point under one rule, or null: the most similar
 * name, then the nearest, among the candidates the rule admits. A candidate
 * the curator already refused for this point is never offered.
 */
export function bestMatch(
  point: ComponentPoint,
  candidates: readonly CandidateItem[],
  basis: MatchBasis,
  refused: ReadonlySet<string> = new Set(),
): ComponentMatch | null {
  let best: ComponentMatch | null = null;
  for (const candidate of candidates) {
    if (refused.has(candidate.item)) continue;
    const match = matchOf(point, candidate, basis);
    if (!match) continue;
    if (!best || match.similarity > best.similarity
      || (match.similarity === best.similarity && match.distanceM < best.distanceM)) best = match;
  }
  return best;
}

/**
 * The classes a near candidate may be of, for one site: the classes of its
 * resolved components, or, where it has none, the catalogue-wide ones less the
 * settlement kinds among them and less the kinds of thing no component is
 * taken for on the catalogue's word (`NEVER_BY_THE_CATALOGUE`). Both are the
 * class tree's answer, passed in: a list could not see that Passau's
 * *Altstadt* is a settlement, or a *Bahnhof* class a railway station.
 */
export function admittedClasses(
  siteClasses: ReadonlySet<string>,
  catalogueClasses: ReadonlySet<string>,
  settlementKinds: ReadonlySet<string>,
  neverByTheCatalogue: ReadonlySet<string> = new Set(),
): ReadonlySet<string> {
  return siteClasses.size > 0
    ? siteClasses
    : new Set([...catalogueClasses].filter(c => !settlementKinds.has(c) && !neverByTheCatalogue.has(c)));
}

/**
 * The kinds of thing a component is taken for only on a site that is about
 * them, never through the catalogue-wide fallback (#1671), with every class
 * under them in the class tree. A few sites' components are a hotel or a
 * station — the Ombilin coal line's stations, Hôtel Tassel typed a hotel — and
 * that carries the class over the catalogue's floor, so a Roman fort with no
 * resolved sibling was offered the hotel and the station named after its town:
 * the Mercure Wien Zentrum for Vindobona's legionary fortress, Tulln's station
 * for its tower. A site whose own resolved components are of the class still
 * admits it through its own classes.
 */
export const NEVER_BY_THE_CATALOGUE: Readonly<Record<string, string>> = {
  Q27686: 'hotel',
  Q55488: 'railway station',
};

/**
 * The kinds of thing the place-name rule never takes on the catalogue-wide
 * fallback, with every class under them. A museum named after its town is the
 * town's museum: the Weltmuseum and the Albertina for Vindobona's fortress, the
 * Tulln City Museum for the fort under it. A museum that is a component is
 * named as one, and the name rule finds it — the State Museum of History of
 * Uzbekistan, Schloss Traismauer — so only the weaker door is closed to them.
 */
export const NOT_BY_PLACE_NAME_ALONE: Readonly<Record<string, string>> = {
  Q33506: 'museum',
};

/**
 * The shortest word of a component's own name that tells a candidate's label
 * apart from its town's buildings: "Hufeisenturm" does, while "West", "Ost"
 * and "und" are in many a label.
 */
const OWN_WORD_MIN_LETTERS = 5;

/**
 * Whether a candidate's label shares a word with the component's own place
 * names past the town it leads with (`ownToponymsOf`), read without its
 * trailing qualifier as the place-name rule reads it: "Spätantiker
 * Hufeisenturm im Kommunalzentrum Pöchlarn" shares "Hufeisenturm" with
 * "Pöchlarn – Kastell Hufeisenturm West".
 */
export function namesMoreThanTheTown(point: ComponentPoint, candidate: CandidateItem): boolean {
  if (point.name === null) return false;
  const own = new Set(ownToponymsOf(point.name).flatMap(place => place.split(' '))
    .filter(word => word.replace(/[^\p{L}]/gu, '').length >= OWN_WORD_MIN_LETTERS));
  return candidate.labels.some(label => matchKey(withoutQualifier(label)).split(' ').some(word => own.has(word)));
}

/**
 * The kinds of thing the place-name rule takes on the catalogue-wide fallback
 * by the component's town alone, with every class under them (#1689). Every
 * other candidate there must share a word with the component's own place
 * names (`namesMoreThanTheTown`). A town with many listed buildings names each of
 * them, and a class some component somewhere holds is not enough to tell its
 * parish church, a house on Wiener Straße or the Freud monument from the
 * Roman fort under them; the castra of the Dacian frontier are named after
 * their village alone and are archaeological sites.
 */
export const BY_THE_TOWN_ALONE: Readonly<Record<string, string>> = {
  Q839954: 'archaeological site',
};

/**
 * Classes whose items record a find or a dig rather than a place to go: bulk
 * imports that name each item after its town and type it an archaeological
 * site too, so the class tree admits it and the name matches the town's
 * component ("Pompeii (Samian Ware Discovery Site)" 265 m from Pompeii). The
 * tree cannot tell them apart, since each is a direct subclass of
 * archaeological site (Q839954), as every kind of site is; so they are named.
 * An item of one of them, or of a class under one, is never a near candidate,
 * whatever else it is typed;
 * the near query refuses it (`itemsInBoxes`), since a candidate carries only
 * the classes it was asked for.
 */
export const FIND_RECORD_CLASSES: Readonly<Record<string, string>> = {
  Q102202066: 'Samian Ware Discovery Site',
  Q101008619: 'rescue excavation',
};

/**
 * How alike the name of a place a candidate stands in must be to the
 * component's for the candidate to be a thing at the component: Herrnhut's
 * museum stands in Herrnhut (1.0), the gunpowder house on Mjölnarholmen in
 * Mjölnareholmen (0.71), while Straubing's castrum stands in Straubing, short
 * of "Straubing – Ostkastell" at 0.48, and is the component itself.
 */
export const AT_THE_COMPONENT_SIMILARITY = 0.7;

/**
 * Whether a near candidate is a thing at the component rather than the
 * component: it stands in (P131, P276) or is part of (P361) a place named like
 * the component — Christiansfeld's pharmacy in Christiansfeld, Moroni's Old
 * Friday Mosque in Moroni — and is not itself named like it, as Pompeii's item
 * is beside the comune of Pompei. Asked only for a site none of whose
 * components resolve: there the catalogue-wide classes admit a house and a
 * museum, while a site's own classes say what its components are, and the
 * wooden church that is the component "Hervartov" stands in Hervartov.
 */
export function standsAtTheComponent(
  point: ComponentPoint, candidate: CandidateItem, placeNames: readonly string[],
): boolean {
  if (point.name === null || candidate.labels.some(label => sameName(withoutQualifier(label), point.name!))) return false;
  return placeNames.some(place => nameSimilarity(point.name!, place) >= AT_THE_COMPONENT_SIMILARITY);
}

/**
 * The place a thing at the component stands in, offered in its stead: the
 * component is the place the museum, the pharmacy or the gunpowder house is
 * in — Mjölnareholmen, the islet the gunpowder house stands on — when the place
 * is named like the component
 * as `standsAtTheComponent` reads it. Never a place with a World Heritage
 * reference of its own, which the reference reader finds or a curator
 * matches, as the near rule never offers one. Whether it lies close enough is
 * the near rule's own question (`bestMatch`), asked of it like any candidate.
 */
export function placeAsCandidate(
  point: ComponentPoint, place: { item: string; names: string[]; coords: Array<[lat: number, lon: number]>; referenced: boolean },
): CandidateItem | null {
  if (point.name === null || place.referenced) return null;
  if (!place.names.some(name => nameSimilarity(point.name!, name) >= AT_THE_COMPONENT_SIMILARITY)) return null;
  return { item: place.item, labels: place.names, coords: place.coords };
}

/**
 * Whether a near candidate is of a class the site admits, and not a settlement
 * where the site's parts are not settlements: a fort named after a village is
 * not the village. `isSettlement` is the class tree's word on the item.
 */
export function ofTheSitesKind(
  candidate: CandidateItem, admitted: ReadonlySet<string>, isSettlement: boolean, siteAdmitsSettlements: boolean,
): boolean {
  const classes = candidate.classes ?? [];
  return classes.some(c => admitted.has(c)) && (!isSettlement || siteAdmitsSettlements);
}
