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
 * Two rules, each a reason a curator reads on the card:
 * - **part of the site** — the item says it is part of the site's own item
 *   (P361), and only lacks the component's number. No class is asked: Wikidata
 *   has said what it is a part of. Aalto Works' Villa Mairea, the D-Day beaches.
 * - **near, of the site's kind** — an item close to the point whose class is
 *   one the site's resolved components are of (a fort beside the Limes' forts),
 *   or, for a site with none resolved, one of the classes the resolved
 *   components of several sites are of. A settlement is a candidate only where the site's own
 *   components include settlements: a fort named after a village is not the
 *   village.
 */

export type MatchBasis = 'part_of' | 'near';

export interface ComponentPoint {
  locationId: number;
  name: string | null;
  lat: number;
  lon: number;
}

export interface CandidateItem {
  item: string;
  /** Every label the item has, in any language: a component is often named in its own. Empty until read. */
  labels: string[];
  /** Every coordinate the item states. */
  coords: Array<[lat: number, lon: number]>;
  /** Its P31 classes, for the near rule. */
  classes?: string[];
}

export interface ComponentMatch {
  locationId: number;
  item: string;
  /** The label shown on the card: the one most like the component's name. */
  label: string;
  distanceM: number;
  similarity: number;
  /** The same name, folded, within `EXACT_DISTANCE_M`: marked so a curator can accept them together. */
  exact: boolean;
  basis: MatchBasis;
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
 * be known to share the name.
 */
export const NEAR_SAME_NAME_RADIUS_M = PART_RADIUS_M;
/** The name similarity below which a near item is not proposed: the 10th percentile of true pairs is 0.22. */
export const MIN_SIMILARITY = 0.3;

/** Classes of human settlements, which a component of a site whose parts are not settlements is never. */
export const SETTLEMENT_CLASSES: ReadonlySet<string> = new Set([
  'Q486972', // human settlement
  'Q515', // city
  'Q532', // village
  'Q3957', // town
  'Q15284', // municipality
  'Q1549591', // big city
  'Q5084', // hamlet
  'Q2039348', // municipality of the Netherlands
  'Q262166', // municipality of Germany
  'Q484170', // commune of France
  'Q640364', // commune of Romania
]);

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

/** Metres from the point to the nearest coordinate the candidate states; Infinity where it states none. */
export function nearestM(point: ComponentPoint, candidate: CandidateItem): number {
  return candidate.coords.length === 0
    ? Infinity
    : Math.min(...candidate.coords.map(([lat, lon]) => distanceM(point.lat, point.lon, lat, lon)));
}

/** How one candidate stands against one point: its nearest coordinate and its most similar label. */
function measure(point: ComponentPoint, candidate: CandidateItem) {
  const distance = nearestM(point, candidate);
  let label = candidate.labels[0] ?? candidate.item;
  let similarity = 0;
  let exactName = false;
  for (const each of candidate.labels) {
    const s = point.name ? nameSimilarity(point.name, each) : 0;
    if (s > similarity) { similarity = s; label = each; }
    if (point.name && sameName(point.name, each)) { exactName = true; label = each; similarity = 1; }
  }
  return { distance, label, similarity, exactName };
}

/** Whether a candidate passes the rule its basis names. */
function passes(basis: MatchBasis, m: ReturnType<typeof measure>): boolean {
  if (m.exactName && m.distance <= (basis === 'part_of' ? SAME_NAME_RADIUS_M : NEAR_SAME_NAME_RADIUS_M)) return true;
  if (basis === 'part_of') return m.distance <= PART_RADIUS_M && (m.similarity >= MIN_SIMILARITY || m.distance <= 150);
  return m.distance <= NEAR_RADIUS_M && m.similarity >= MIN_SIMILARITY;
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
    const m = measure(point, candidate);
    if (!passes(basis, m)) continue;
    const match: ComponentMatch = {
      locationId: point.locationId,
      item: candidate.item,
      label: m.label,
      distanceM: Math.round(Number.isFinite(m.distance) ? m.distance : -1),
      similarity: Math.round(m.similarity * 100) / 100,
      exact: m.exactName && m.distance <= EXACT_DISTANCE_M,
      basis,
    };
    if (!best || match.similarity > best.similarity
      || (match.similarity === best.similarity && match.distanceM < best.distanceM)) best = match;
  }
  return best;
}

/**
 * The classes a near candidate may be of, for one site: the classes of its
 * resolved components, or, where it has none, the catalogue-wide ones. A
 * settlement class only where the site's own components are settlements.
 */
export function admittedClasses(
  siteClasses: ReadonlySet<string>,
  catalogueClasses: ReadonlySet<string>,
): ReadonlySet<string> {
  return siteClasses.size > 0 ? siteClasses : new Set([...catalogueClasses].filter(c => !SETTLEMENT_CLASSES.has(c)));
}

/** Whether a near candidate is of a class the site admits, and not a settlement the site's parts never are. */
export function ofTheSitesKind(candidate: CandidateItem, admitted: ReadonlySet<string>): boolean {
  const classes = candidate.classes ?? [];
  return classes.some(c => admitted.has(c))
    && !(classes.some(c => SETTLEMENT_CLASSES.has(c)) && ![...admitted].some(c => SETTLEMENT_CLASSES.has(c)));
}
