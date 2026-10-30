/**
 * ADR-0161: what makes a holy place of this kind when no building class does:
 * the `sacred place` tree, the landforms a holy place lifts the kills for,
 * what tells a holy mountain people worship at from a peak, and what refuses
 * a holy place that is a city or an object kept inside a building. Pinned
 * lists only, read by `buildWorshipTrees` and `worshipVerdict`.
 */

/**
 * `sacred place` (Q4588528): its tree is part of the kind, beside the tree
 * under `structure of worship`. The kind is holy places, not only buildings
 * (`kinds.jsonl`: "a holy spring, grove, lake or mountain where the place
 * itself is what is venerated"), and the Western Wall (`wall, archaeological
 * site, sacred place`) and Mount Kailash (`mountain, sacred mountain`) carry no
 * class under the building tree.
 */
export const SACRED_PLACE_ROOT = 'Q4588528';

/** The landforms a traveller calls a mountain: a holy site carrying one is typed a sacred mountain (`typeOf`). */
export const MOUNTAIN_FORMS: Record<string, string> = {
  Q54050: 'hill',
  Q8502: 'mountain',
  Q46831: 'mountain range',
  Q8072: 'volcano',
};

/**
 * The kill classes a holy place lifts: a sacred mountain is a mountain, and
 * the mountain is what is venerated. A row carrying a class of the
 * `sacred place` tree is not refused for a landform here (`hill`, `mountain`
 * are the two in `WORSHIP_KILL_CLASSES`) and for nothing else there: the
 * Temple Mount, `hill, sacred mountain, compound, mosque, neighborhood`, is
 * still refused as a neighbourhood. A holy landform also needs a faith or a
 * pilgrimage named for it (`WORSHIP_EVIDENCE_CLASSES`).
 */
export const LANDFORM_CLASSES: Record<string, string> = { ...MOUNTAIN_FORMS, Q39816: 'valley' };

/** `sacred mountain` (Q1595289): its tree types a holy mountain, and every row in it is read as a landform. */
export const SACRED_MOUNTAIN_ROOT = 'Q1595289';

/**
 * What tells a holy mountain people worship at from a peak a people hold
 * sacred and leave alone, beside the faiths it is holy to (`P140`). Kailash,
 * Arafat and Mount Kōya name their faiths; Fuji, Nantai and Tsukuba are typed
 * a mountain that is a kami (`shintaisan`); Hiei is a temple's mountain name
 * (`sangō`). Kanchenjunga, Gangkhar Puensum, Machhapuchhre, Rainier, Baekdu
 * and Shiprock carry none of them: climbing the second and third is
 * forbidden, and none is a place a traveller goes to pray. Read on the subset
 * on 2026-10-30 (#1978).
 */
export const WORSHIP_EVIDENCE_CLASSES: Record<string, string> = {
  Q15135589: 'pilgrimage site',
  Q11588709: 'shintaisan',
  Q11058522: 'sangō',
  Q98116669: 'religious complex',
};

/**
 * Refused on a holy place that is no building of worship: a city held holy is
 * the city (Anuradhapura, `sacred place, city, archaeological site`), and a
 * city's walls are a fortification (the Walls of Jerusalem). The Western Wall
 * is typed `wall`, which is none of these.
 */
export const HOLY_SITE_KILL_CLASSES: Record<string, string> = {
  Q515: 'city',
  Q16748868: 'city walls',
  Q57821: 'fortification',
  Q57346: 'defensive wall',
};

/** `museum` (Q33506): a holy object whose location is a museum is the museum's to show (the Pergamon Altar). */
export const MUSEUM_ROOT = 'Q33506';
