/**
 * Whether an entity is a place of worship a traveller visits: a building
 * (or a ruin of one) that is open to be stood in front of, and not a tower
 * beside one, a hill it sits on, or a temple that no longer exists.
 *
 * The museum's venue test and the public-art verdict, one kind over. Wikidata
 * types a hilltop a mosque, a campanile a church tower and a statue on a
 * mountain a pilgrimage site, so the class a row arrived by is a necessary
 * condition and nothing more. The rules run in the order a person would give
 * the reason: what the row *is* first (a demolished temple, a hill), then
 * whether it is a building or a tower attached to one, then whether it is a
 * place of worship at all, then whether there is anywhere to stand.
 *
 * Pure: every fact is handed in, so the rule can be tried on the catalogue's
 * own mistakes without a network.
 */

import {
  DESTROYED_BUILDING,
  RUIN_CLASSES,
  WORSHIP_KILL_CLASSES,
  WORSHIP_PART_CLASSES,
  TYPE_OVERRIDES,
  TYPE_ROOTS,
  type WorshipTrees,
  type WorshipType,
} from './classes.js';
import {
  HOLY_SITE_KILL_CLASSES, LANDFORM_CLASSES, MOUNTAIN_FORMS, WORSHIP_EVIDENCE_CLASSES,
} from './holyPlaces.js';

export interface WorshipFacts {
  qid: string;
  /** Every `P31` the entity carries. */
  classes: string[];
  /** Whether `P625` is on this planet. */
  onEarth: boolean;
  lat: number | null;
  lon: number | null;
  /** `P140`: the faiths it is holy to. */
  religions?: readonly string[];
  /** What its `P276` names, with that thing's classes: where an object is kept. */
  locatedIn?: ReadonlyArray<{ label: string; classes: readonly string[] }>;
}

export type WorshipResult =
  | { pass: true; type: WorshipType | null }
  | { pass: false; reason: string };

export function worshipVerdict(e: WorshipFacts, trees: WorshipTrees): WorshipResult {
  // What it is, before whether it is ours: a kill class names the thing better
  // than "no place-of-worship class" would, and it refuses whatever else the
  // row carries — the Temple Mount is a hill though it is also a mosque.
  //
  // With one exception, and only one: a row Wikidata calls a ruin is a place
  // you stand in front of, so a ruin class lifts `destroyed building or
  // structure` and nothing else. Fountains Abbey is `monastery, abbey, monastery
  // ruins, destroyed building or structure`; a ruined chapel on a hill is still
  // refused as the hill.
  //
  // And a holy place lifts the landform kills: Kailash is a mountain, and the
  // mountain is what pilgrims walk round (`LANDFORM_CLASSES`).
  const standing = e.classes.some((c) => RUIN_CLASSES[c]);
  const holy = e.classes.some((c) => trees.sacred.has(c));
  const killed = e.classes
    .filter((c) => WORSHIP_KILL_CLASSES[c] && !(standing && c === DESTROYED_BUILDING) && !(holy && LANDFORM_CLASSES[c]))
    .map((c) => WORSHIP_KILL_CLASSES[c]);
  if (killed.length) {
    return { pass: false, reason: `not a place to visit: ${killed.join('; ')}` };
  }

  // The same set on both sides: `buildWorshipTrees` takes the parts out of the
  // worship set, so a row with a proper worship class beside its bell tower
  // still has one here and is the place, while a row whose only worship class
  // was the part has none and is not. `WORSHIP_PART_CLASSES` is only where the
  // name in the reason comes from.
  const parts = e.classes.filter((c) => trees.parts.has(c)).map((c) => WORSHIP_PART_CLASSES[c]);
  const worship = e.classes.filter((c) => trees.worship.has(c));
  // One reason for every tower, whatever it stands next to. The Leaning Tower
  // over the Duomo and the Minaret of Jam alone in a Ghor river valley are the
  // same answer to a traveller — something you climb, not somewhere you pray —
  // so the rule does not ask about containers and the refusal names the tower
  // rather than a church to hand the row to: Towers is the kind that has it.
  if (parts.length && !worship.length) {
    return { pass: false, reason: `a tower, not a place of worship: ${parts.join('; ')}` };
  }
  if (!worship.length) {
    return { pass: false, reason: 'no place-of-worship class' };
  }
  if (!e.classes.some((c) => trees.buildings.has(c))) {
    const refusal = holyPlaceRefusal(e, trees);
    if (refusal) return { pass: false, reason: refusal };
  }

  if (!e.onEarth) {
    return { pass: false, reason: 'not on Earth: its coordinate (P625) is on another globe' };
  }
  // Number.isFinite, not truthiness: a church on the prime meridian has a
  // longitude of 0.
  if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon)) {
    return { pass: false, reason: 'no coordinates of its own (P625)' };
  }

  return { pass: true, type: typeOf(e.classes, trees) };
}

/**
 * Why a holy place that is no building of worship is not one a traveller goes
 * to, or null when it is. Three shapes, each read off the rows `sacred place`
 * brings (#1978):
 *
 * - **a city or its walls** (`HOLY_SITE_KILL_CLASSES`): Anuradhapura, the
 *   Walls of Jerusalem;
 * - **an object kept inside a building of worship or a museum**, by its
 *   location (`P276`): the Black Stone in the Masjid al-Haram, the Pergamon
 *   Altar in the Pergamon Museum. Only the location, never `part of`: the
 *   Western Wall is part of the al-Aqsa compound and stands in the Old City;
 * - **a holy mountain no faith or pilgrimage is named for**
 *   (`WORSHIP_EVIDENCE_CLASSES`): Kanchenjunga and Rainier are held sacred and
 *   left alone, while Kailash names its four faiths.
 */
function holyPlaceRefusal(e: WorshipFacts, trees: WorshipTrees): string | null {
  const settled = e.classes.filter((c) => HOLY_SITE_KILL_CLASSES[c]).map((c) => HOLY_SITE_KILL_CLASSES[c]);
  if (settled.length) return `a holy place that is a ${settled.join('; ')}, not a place of worship`;

  const keeper = (e.locatedIn ?? [])
    .find((place) => place.classes.some((c) => trees.buildings.has(c) || trees.museums.has(c)));
  if (keeper) return `kept inside ${keeper.label}, which is the place to visit`;

  const mountains = trees.types.get('sacred mountain');
  const landform = e.classes.find((c) => LANDFORM_CLASSES[c]);
  const isLandform = landform !== undefined || e.classes.some((c) => mountains?.has(c));
  const worshipped = (e.religions?.length ?? 0) > 0 || e.classes.some((c) => WORSHIP_EVIDENCE_CLASSES[c]);
  if (!isLandform || worshipped) return null;
  return `a holy ${landform ? LANDFORM_CLASSES[landform] : 'mountain'} no faith or pilgrimage is named for (P140)`;
}

/**
 * What a traveller would call the place: the first type in `TYPE_ROOTS`'
 * precedence whose tree the row's classes reach, or nothing.
 *
 * Nothing is a real answer. A row typed only `religious building` is a place
 * of worship none of the type words fits, and it is admitted untyped rather
 * than forced into the nearest one.
 *
 * `TYPE_OVERRIDES` runs first, and holds one class: a Thai `wat` is a temple
 * whatever the class graph files it under. Everything else is the precedence.
 */
export function typeOf(classes: string[], trees: WorshipTrees): WorshipType | null {
  for (const cls of classes) {
    const override = TYPE_OVERRIDES[cls];
    if (override) return override;
  }
  for (const { type } of TYPE_ROOTS) {
    const tree = trees.types.get(type);
    if (!tree || !classes.some((c) => tree.has(c))) continue;
    // A holy site that is a mountain is a sacred mountain, whichever holy
    // class Wikidata gave it: Mount Arafat is `mountain, sacred place`.
    return type === 'holy site' && classes.some((c) => MOUNTAIN_FORMS[c]) ? 'sacred mountain' : type;
  }
  return null;
}
