/**
 * What the site door reads: the trees a candidate is judged against, the OSM
 * tags that say *ruin* and *a town people live in*, and the classes that refuse
 * a row outright.
 *
 * Split out of `classes.ts` at the door's own seam (#581 PR 2). That file is
 * the museum door's lists — which classes and which Wikipedia categories make a
 * museum an archaeology museum, and what makes an object inside one a find —
 * and the two doors share nothing but the kind they fill. It re-exports every
 * name below, so a caller still asks one module for this kind's lists; the
 * split is about a file somebody has to read, not about making callers choose.
 *
 * The shape is `classes.ts`'s and for its reasons: lists of *classes*, *keys*
 * and *values*, never entities — a rule about kinds of thing, which a curator's
 * verdict can extend without a deploy — with every QID carrying the label
 * Wikidata gave it, verified with `wbgetentities`, and every OSM value read off
 * the measurement of 2026-09-14 (`data/cache/osm-sites/`, summarised in
 * `docs/sources/global/openstreetmap-qlever.md`). Nothing here decides
 * anything: `siteTest.ts` does that.
 */

import type { DigTags, KeepWkt } from '../osm/types.js';

/**
 * Under the museum tree, and a site rather than a museum.
 *
 * Wikidata files `archaeological park` under `archaeological museum` as well
 * as under `archaeological site`, so the museum closure reaches it and the
 * survey had to subtract it to count museums at all. An open-air excavation
 * with a ticket office is somewhere you walk around, not a building of
 * display cases, and ADR-0058 decision 2 says plainly that the parks the
 * museum tree reaches are sites. Taken out of the museum set by
 * `buildArchaeologyTrees` so that the subtraction happens once; the site door
 * admits it on its own terms (decision 4), which is why the constant lives on
 * this side of the seam.
 *
 * **The subtraction is of this class's tree, not of this class.** `Fudoki no
 * oka` (Q11665453) is Japan's word for an archaeological park with a museum on
 * it, and Wikidata files it under this root (checked 2026-09-13): a row typed
 * only *Fudoki no oka* carries no `archaeological park` class of its own, so
 * deleting the one QID would leave it in the museum set and admit a park as a
 * museum. The park closure is fetched like the other three and every class of
 * it comes out.
 */
export const ARCHAEOLOGICAL_PARK = 'Q3363945';

/**
 * The root of the site pool: `archaeological site`, walked as a tree.
 *
 * 590 classes under it, measured on 2026-09-14, and 1,960 items with a
 * coordinate at the pool's floor of 15 sitelinks — which is why the root is
 * asked in fame bands and the rest of the tree in batches, as the worship pool
 * is, rather than taken whole as the museum pool is.
 *
 * The tree is not the boundary of what a traveller would call a dig. It holds
 * `polis`, `ancient city`, `free city` and `city-state` — so Athens (288
 * sitelinks, through `free city`), Cairo and Damascus are in the pool — and it
 * holds shipwrecks. Lakes, reservoirs, deserts and mountain ranges reach it
 * another way, by carrying `archaeological site` itself. Telling any of them
 * from Troy is what `siteTest.ts` does, with OpenStreetMap as the second
 * signal.
 */
export const SITE_ROOT = 'Q839954';

/**
 * The branch the rule reads differently: `human settlement`, walked as a tree.
 *
 * 2,720 classes, measured the same day. A candidate is on the *settlement
 * branch* when one of its own `P31`s is in this tree — which is true of 510 of
 * the 1,126 world-tier candidates, Troy and Athens alike — and the branch
 * decides what "no signal at all" means: on the site branch it is a site by
 * class, on the settlement branch it is a city until something says otherwise.
 *
 * `settlement site` (Q1708422) is under **both** roots, which is exactly the
 * ambiguity: it is the class Wikidata gives Troy.
 */
export const SETTLEMENT_ROOT = 'Q486972';

/**
 * Never a place to stand: `shipwreck`, walked as a tree (4 classes).
 *
 * 58 of the 1,126 candidates are wrecks — the Titanic at 160 sitelinks, the
 * Bismarck, the Yamato, the Costa Concordia. They are in the tree because a
 * wreck really is an archaeological site, and they are refused because this
 * kind is a list of places a traveller stands in (ADR-0058 decision 1) and a
 * wreck is on a seabed: what can be visited is a dive at best and a museum at
 * most, and neither is the row.
 */
export const SHIPWRECK_ROOT = 'Q852190';

/** The Wikidata item `P1435` names when a place is a World Heritage site. */
export const WORLD_HERITAGE_DESIGNATION = 'Q9259';

/**
 * `historic=*` values that say a ruin stands here.
 *
 * Read off the measurement of 2026-09-14 in order of how many items carry them:
 * `archaeological_site` 477, `ruins` 70, `castle` 34, `tomb` 29, `monument` 18,
 * `temple` 6, `bridge` 6, `citywalls` 3, `theatre` 3, `aqueduct` 2, with `fort`
 * and `fortification` named beside them from the tagging wiki's own list for
 * the same kind of object.
 *
 * A castle and a monument are in it and a church is not, which is the line this
 * kind draws: a ruined keep is somewhere you walk around the remains, a working
 * church is somewhere you attend. The places of worship have their own kind.
 *
 * **`roman_road` and `memorial` were in this set and are not** (#581's final
 * pass), and the measurement is why both go. `roman_road` decides exactly two
 * items of the pool, Watling Street (Q1434239) and the Via Flaminia (Q374149):
 * a 430 km road is not a place a traveller stands in, and a linestring is not
 * an extent to draw. `memorial` decides exactly one, Lop Desert (Q620724),
 * whose only mapped object is a memorial node in a desert — and a memorial is a
 * modern plaque or marker in OSM's own words, not remains. Neither value was
 * read off the counts; both came from the wiki's list, and the rows they
 * actually judged say they do not belong.
 */
export const RUIN_HISTORIC: ReadonlySet<string> = new Set([
  'archaeological_site', 'ruins', 'tomb', 'castle', 'fort', 'monument',
  'temple', 'citywalls', 'fortification', 'theatre', 'aqueduct', 'bridge',
]);

/**
 * Keys whose presence says a ruin, whatever the value — except `no`, which is
 * the mapper saying the opposite (`saidOf` in `siteTest.ts`). Both
 * enumerations leave a `no` out, and the rule reads the per-item objects the
 * same way, so a `ruins=no` is no step-2 signal for a class-pool row either
 * (`ruinTagOf`), not only no naming for the map's entrance.
 *
 * `ruins=*` is on 96 of the measured items and `archaeological_site=*` on 190 —
 * the secondary key the tagging wiki documents for
 * `historic=archaeological_site`, whose values are `city` (101), `settlement`
 * (33), `fortification` (13), `megalith` (12), `necropolis` (12) and the rest.
 * `site_type` is not among them: the wiki does not document it for this tag,
 * and it was unused across all 1,544 objects.
 *
 * Every key here is one the reader fetches a geometry for, which
 * `classes.test.ts` pins against the query's own `BOUND(…)` guard: a key added
 * here and forgotten there would name a ruin whose outline never arrives.
 */
export const RUIN_KEYS: readonly string[] = ['ruins', 'archaeological_site'];

/** `man_made=*` values that are themselves the remains. */
export const RUIN_MAN_MADE: ReadonlySet<string> = new Set(['mound', 'tell', 'geoglyph']);

/**
 * The boundaries worth an extent.
 *
 * A protected area or a national park is drawn around the thing being
 * protected, which for these rows is the dig. `boundary=administrative` is the
 * municipality around a living town and is never an extent — nor is its
 * geometry ever fetched (`osm/qleverOsm.ts`).
 */
export const PROTECTED_BOUNDARY: ReadonlySet<string> = new Set(['protected_area', 'national_park']);

/**
 * `place=*` values that mean people live here now.
 *
 * Measured on the settlement branch: `town` 41, `city` 37, `village` 19,
 * `neighbourhood` 5, `suburb` 4, `hamlet` 2, with `quarter`, `borough` and
 * `municipality` named beside them from the tagging wiki's own list of
 * populated places.
 *
 * **`locality` and `island` are deliberately absent.** `place=locality` (27
 * items: Pompeii, Sounion, Capernaum) is OSM's tag for a named spot with no
 * population, and `place=island` (20: Rhodes, Samos) says an island, not a
 * town. Reading either as "people live here" would refuse Pompeii.
 */
export const LIVING_PLACE: ReadonlySet<string> = new Set([
  'city', 'town', 'village', 'hamlet', 'suburb', 'quarter',
  'neighbourhood', 'borough', 'municipality',
]);

/**
 * The one boundary value that says people live here as plainly as `place=*`
 * does: a census area.
 *
 * `boundary=census` is the outline a statistical office drew around a
 * population it counts, and the four rows of the pool that carry it are the
 * reason this line exists: Acomita Lake (Q342064), North Acomita Village
 * (Q1237840), Skyline-Ganipa (Q2293403) and Sunrise (Q1836972) — New Mexico
 * census-designated places that Wikidata also types `archaeological site`, each
 * mapped `place=locality` + `boundary=census` and each stating its population
 * of a few hundred. Read as a named spot they walked in as digs; read as what
 * the tag says, the living-place rule refuses them by name (they state a
 * population and are not World Heritage). They are the only four objects in the
 * measurement carrying the value.
 */
export const CENSUS_BOUNDARY = 'census';

/**
 * The classes that say *site* on the item itself, whatever else it carries.
 *
 * The one thing that can outweigh OSM mapping a town: Wikidata saying, directly
 * and not through a closure, that this is a dig. Read off the measured pool on
 * 2026-09-14 with the count of candidates carrying each: `archaeological site`
 * 802, `tell` 40, `ruins` 38, `Ancient Greek archaeological site` 24,
 * `necropolis` 19, `archaeological park` 16, `Paleolithic site` 6, `ancient
 * monument` 4, `settlement site` 2, `Ancient Egyptian archaeological site` 2,
 * `prehistoric necropolis` 1, `tumulus` 1.
 *
 * The label is what a reason quotes, so it is the label Wikidata gives the
 * class.
 */
export const SITE_CLASSES: Record<string, string> = {
  Q839954: 'archaeological site',
  Q755017: 'tell',
  Q200141: 'necropolis',
  Q109607: 'ruins',
  Q1708422: 'settlement site',
  [ARCHAEOLOGICAL_PARK]: 'archaeological park',
  Q125866553: 'Ancient Egyptian archaeological site',
  Q93342462: 'Ancient Greek archaeological site',
  Q12137573: 'Paleolithic site',
  Q125866985: 'prehistoric necropolis',
  Q34023: 'tumulus',
  Q3395377: 'ancient monument',
};

/**
 * Refused whatever else the item says: the class names the thing better than
 * "archaeological site" does, and names something nobody stands in.
 *
 * The value is the sentence the refusal carries. Walked as a tree, so a
 * subclass of `shipwreck` is refused with it.
 */
export const SITE_KILL_CLASSES: Record<string, string> = {
  [SHIPWRECK_ROOT]: 'a shipwreck',
};

/**
 * Refused **unless the item also carries a class in `SITE_CLASSES`**.
 *
 * `lost city` is Wikidata's class for two different things: a town people left
 * in living memory — Pripyat (86 sitelinks), Chernobyl (106) — and an ancient
 * city nobody has located, Thinis (39) being the pool's example. Neither is a
 * place this catalogue can send anybody to, and the four in the pool split
 * three to one that way. What rescues the third kind — Al-Hirah, `lost city`
 * *and* `archaeological site` — is the direct site class: an item Wikidata also
 * calls a dig is not a modern evacuation.
 *
 * The sentence names the class and stops there. A refusal that asked a curator
 * to pick between two stories ("a town people left, or a city nobody has
 * found") makes them answer a question the rule never asked; the row's own
 * description says which of the two this one is.
 */
export const SITE_KILL_UNLESS_SITE: Record<string, string> = {
  Q2974842: 'Wikidata files it as a lost city',
};

/**
 * Refused **unless OSM maps a ruin on it, or it is a World Heritage site
 * itself**: a landform or a body of water that Wikidata also files under
 * archaeological sites.
 *
 * Lake Bled is `lake` and `archaeological site`, and what OSM maps there is
 * `natural=water` — a lake, and the pin would be on the water. Held against
 * the two mountain ranges in the pool, the rule comes out right on both:
 * Tadrart Acacus carries `historic=archaeological_site` on a node inside it and
 * stays; Tassili n'Ajjer carries no ruin object at all and stays because it is
 * World Heritage 179, which is the rock art that is the reason to go.
 *
 * **The reservoir and the desert are #581's final pass**, and each is a row run
 * 121 admitted: Qiandao Lake (Q2470528, `reservoir` + `archaeological site`),
 * whose dig — Shi Cheng — is thirty metres under the water a dam put there, and
 * Lop Desert (Q620724, `desert`), which is a desert. The pool's other water and
 * landform classes were read the same day and left out on purpose: the two
 * `reservoir` rows include the Pool of Bethesda, which is lifted by the
 * excavation OSM maps on it, and all three `valley` rows are real digs (the
 * Valley of the Kings by its ruin object, M'zab by World Heritage 188, Timna by
 * neither) — a `valley` kill would cost a site and buy nothing. `island`,
 * `cave`, `hill` and `oasis` are not on this list at all: a cave with
 * prehistoric art is this kind's canon.
 *
 * The direct site class is deliberately *not* a rescue here, where it is one
 * for `lost city`: Lake Bled carries it, and the whole point is that the item
 * is a lake all the same.
 */
export const SITE_KILL_NATURAL: Record<string, string> = {
  Q23397: 'a lake',
  Q46831: 'a mountain range',
  Q131681: 'a reservoir',
  Q8514: 'a desert',
};

/**
 * The one row refused by its own name, with the reason beside it.
 *
 * The Aysén Region of Chile is typed `region of Chile`, `pene-enclave` **and**
 * `archaeological site` (67 sitelinks, checked 2026-09-14) — an editing slip on
 * Wikidata that nothing else in the rule catches: its class says site, it is
 * not on the settlement branch, and the only thing OSM maps under its item is
 * the administrative relation of the region. A list of one, kept as a list
 * because a second such row is a day's work away and a rule with a name in it
 * should say so out loud.
 */
export const SITE_KILL_BY_NAME: Record<string, string> = {
  Q2181: 'the Aysén Region of Chile, mis-typed on Wikidata as an archaeological site',
};

/**
 * The OSM tags that *name a dig* — the second entrance to the pool (#895).
 *
 * `historic=archaeological_site` and its secondary key `archaeological_site=*`
 * are the mapper's statement about what the thing is; `historic=ruins` and
 * `ruins=*` are a statement about its condition, and the rule reads the two
 * differently for a candidate the class tree does not vouch for
 * (`osmOnlyVeto` in `siteTest.ts`, over `FORTIFICATION_ROOT`, `PALACE_ROOT`,
 * `WORSHIP_STRUCTURE_ROOT`, the museum tree and
 * `RUINS_ONLY_MONUMENT_CLASSES`). Measured on 2026-09-15 over every
 * object carrying one of these and a `wikidata` tag: 63,630 rows, 41,163
 * objects, 38,753 items, 774 at the place line, 210 of them in no class under
 * `archaeological site`.
 */
export const OSM_DIG_HISTORIC: ReadonlySet<string> = new Set(['archaeological_site']);
export const OSM_RUINS_HISTORIC: ReadonlySet<string> = new Set(['ruins']);
export const OSM_DIG_KEY = 'archaeological_site';
export const OSM_RUINS_KEY = 'ruins';

/**
 * Nothing left to stand in: `destroyed building or structure` (Q19860854).
 *
 * The Hanging Gardens of Babylon (99 sitelinks), the Colossus of Rhodes, the
 * Lighthouse of Alexandria and the Palace of Whitehall each carry a
 * `historic=ruins` node on the spot and this class on the item — a place that
 * *was*, which OpenStreetMap marks and a traveller cannot visit. Read only of
 * a candidate the tree did not vouch for: an item Wikidata also files under
 * archaeological sites is a dig whatever else it once was.
 */
export const DESTROYED_CLASS = 'Q19860854';

/**
 * The trees a `ruins=*` tag alone cannot carry a candidate past: a
 * fortification (Q57821 — castles, forts, citadels), a palace (Q16560), a
 * structure of worship (Q1370598, the same root the places of worship walk),
 * and the museum tree the museum door already holds.
 *
 * Measured on the 210 OSM-only candidates at the line (2026-09-15): fifty-three
 * carry only a `ruins` tag and one of these classes — Bodiam, Devín, Rochester
 * and Kenilworth castles, the Transfiguration Cathedral, St Nicholas in
 * Hamburg, the Tower of David — a monument in ruins, which is another kind's
 * row or nobody's, never a dig. `historic=archaeological_site` on the same
 * item is the mapper saying otherwise, and is read as such: Tintagel Castle
 * (`archaeological_site=fortification`) and the Thracian Tomb of Kazanlak
 * (`tomb`, `museum`, `archaeological_site=tumulus`) come in.
 */
export const FORTIFICATION_ROOT = 'Q57821';
export const PALACE_ROOT = 'Q16560';
export const WORSHIP_STRUCTURE_ROOT = 'Q1370598';

/**
 * A monument in ruins that no tree above holds: `château` (Q751876) sits
 * under `manor house`, not under fortification or palace, and the Château
 * de Blois and the Château de Valençay arrived on dry run 136 (2026-09-15)
 * on a `ruins=*` tag. Read beside the trees, for a `ruins` tag alone.
 */
export const RUINS_ONLY_MONUMENT_CLASSES: Record<string, string> = {
  Q751876: 'a château',
};

/**
 * Not a place to stand in, whatever tag the map put on it: the classes of
 * what dry run 136 (2026-09-15) would have created beside the digs, read off
 * the rows by name — a steelworks (Azovstal), a dam, a country house
 * (Berghof), a camp, a massacre and a council with a coordinate, a national
 * library — never `library` itself, which Pergamum's, Celsus' and Hadrian's
 * carry and are digs — a concert hall, a hospital, a disambiguation page
 * (Sela). The map's word
 * was `ruins=yes` on most and `historic=archaeological_site` on some, and
 * the item says what the thing is; the sentence quotes the item.
 *
 * Flat, matched against the item's own `P31`s, for the reason
 * `SITE_KILL_NATURAL` is: a closure under `organization` or `occurrence`
 * would refuse rows nobody measured. A row this list misses is one card for
 * a curator, and one more label here.
 */
export const OSM_ONLY_NOT_A_PLACE: Record<string, string> = {
  Q4830453: 'a business',
  Q6881511: 'an enterprise',
  Q891723: 'a public company',
  Q15911738: 'a hydroelectric power station',
  Q159719: 'a power station',
  Q16884952: 'a country house',
  Q152081: 'a concentration camp',
  Q328468: 'a Nazi concentration camp',
  Q3199915: 'a massacre',
  Q124612203: 'a massacre of civilians',
  Q51645: 'an ecumenical council',
  Q96888669: 'an academic publisher',
  Q22806: 'a national library',
  Q7540126: 'a headquarters',
  Q1060829: 'a concert hall',
  Q1076486: 'a sports venue',
  Q16917: 'a hospital',
  Q3932025: 'a Hellenistic kingdom',
  Q4167410: 'a Wikimedia disambiguation page',
};

/**
 * The enumeration's tags in the shape the reader takes them (`osm/types.ts`):
 * the two `historic` values and the two keys above, composed once here
 * because they are this kind's line through OSM's keys, as `OSM_KEEP_WKT` is.
 */
export const OSM_DIG_TAGS: DigTags = {
  historic: [...OSM_DIG_HISTORIC, ...OSM_RUINS_HISTORIC],
  keys: [OSM_DIG_KEY, OSM_RUINS_KEY],
};

/**
 * English Wikipedia's shelf of digs, read as the second vote for a living
 * place the map named (#895): the article's own categories, as the museum
 * door reads a museum's, never a walk. The trailing space is the museum
 * rule's: a bare `Archaeological sites` is a parent category, not a filing.
 *
 * Measured 2026-09-15: the walk of `Archaeological sites by country` holds
 * 9,440 articles, and at the place line the editors shelve Istanbul, Tbilisi
 * and Yerevan beside the digs — which is why it is a vote and not a door.
 */
export const SITE_CATEGORY = /^Archaeological sites (in|of) /;

/**
 * Which OSM objects the reader may fetch a geometry for, in the shape the
 * reader takes it (`osm/qleverOsm.ts`).
 *
 * Composed here rather than spelled there, because it is this kind's line
 * through OSM's keys: a ruin or the protected area drawn around one. A city's
 * administrative outline is never asked for.
 */
export const OSM_KEEP_WKT: KeepWkt = {
  historic: [...RUIN_HISTORIC],
  manMade: [...RUIN_MAN_MADE],
  boundary: [...PROTECTED_BOUNDARY],
};
