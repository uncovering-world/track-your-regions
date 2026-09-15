/**
 * Whether an archaeological site belongs to the kind, and where it stands
 * against the fame line: ADR-0058 decision 4 as #581's PR 2 narrowed it, and
 * nothing else.
 *
 * **Wikidata cannot tell Troy from Athens.** Both are settlements in its tree —
 * Troy is `city-state, polis, Bronze Age settlement, settlement site` and
 * carries no class saying "dig" at all — so a rule reading classes alone either
 * loses Troy or admits Athens, Cairo and Damascus. What tells them apart is
 * what somebody mapped on the ground: OpenStreetMap has
 * `historic=archaeological_site` on a polygon around Troy's excavations and
 * `place=city` on a node in the middle of Athens. That is the second signal
 * ADR-0059 lets this catalogue read, and this module is where it is read.
 *
 * The shape of `worshipTest.ts` and `museumTest.ts`, and for the same reason:
 * every fact is handed in, so the rule is pure and can be tried on the
 * catalogue's own mistakes without a network. The rules run in the order a
 * person would give the reason — what the item *is not*, then what the map
 * says, then what Wikidata says where the map says nothing, then whether the
 * world has heard of it.
 *
 * **Population is not the living-place rule** (ADR-0058 decision 4 stands). It
 * is the last word in one narrow dispute — OSM says town, Wikidata says site —
 * and nowhere else: Pompeii states a population of 0 and is admitted without
 * the number ever being read.
 */

import {
  CENSUS_BOUNDARY, DESTROYED_CLASS, LIVING_PLACE, OSM_DIG_HISTORIC, OSM_DIG_KEY,
  OSM_ONLY_NOT_A_PLACE, OSM_RUINS_HISTORIC, OSM_RUINS_KEY, PROTECTED_BOUNDARY, RUIN_HISTORIC,
  RUIN_KEYS, RUIN_MAN_MADE, RUINS_ONLY_MONUMENT_CLASSES, SHIPWRECK_ROOT, SITE_CLASSES,
  SITE_KILL_BY_NAME, SITE_KILL_CLASSES, SITE_KILL_NATURAL, SITE_KILL_UNLESS_SITE,
  type ArchaeologyTrees,
} from './classes.js';
import { largestByArea, wktIsPolygonal, type OsmObject } from '../osm/types.js';
import { belowLineReason, lineStanding, type LinePair, type LineStanding } from '../sourceLine.js';

/** What the rule is told about one candidate. */
export interface SiteFacts {
  qid: string;
  /** Every `P31` the item carries. */
  classes: string[];
  /** Whether the item is a World Heritage site itself: `P757`, or `P1435` = Q9259. */
  worldHeritage: boolean;
  /** Whether the item states a population (`P1082`) — any number, 0 included. */
  statesPopulation: boolean;
  sitelinks: number;
  /**
   * Whether English Wikipedia files the item's article under `Archaeological
   * sites in …` — the second vote a living place OpenStreetMap named gets
   * (#895). Read only of such candidates; a candidate the tree vouches for
   * never needs it, so a caller judging one may leave it out.
   */
  namedByCategory?: boolean;
}

/**
 * Which of the rule's answers a refusal came from, as a tag rather than as a
 * sentence.
 *
 * The run groups its refusals for the line a curator reads at the end
 * (`proposal.ts`), and grouping them by matching words in the sentence is a
 * grouping that drifts the day somebody rewords one: Lake Bled's refusal names
 * a lake *and* says "with no ruin on the map", so a substring test filed it
 * under the map's answer when the class is what refused it.
 *
 * `placeless` is the one value the rule itself never returns: it is the pool's
 * (`sites.ts`), for a candidate with no coordinate to pin. It is named here all
 * the same, because the report's groups are one vocabulary and a caller should
 * not have to invent a word for the one refusal it owns.
 */
export type SiteRefusalGroup =
  | 'living'
  | 'no-ruin'
  | 'class-or-name'
  | 'below-the-line'
  | 'placeless';

/**
 * What OpenStreetMap said, in the shape the row stores it (ADR-0059 decision
 * 2): the verdict, the object it was read off, and the tag that decided it.
 */
export interface OsmSignal {
  verdict: 'ruin' | 'living' | 'none';
  /** `way/423938794`, or null where nothing decided. */
  object: string | null;
  /** `historic=archaeological_site`, or null where nothing decided. */
  tag: string | null;
}

export type SiteVerdict =
  | {
    pass: true;
    type: 'site';
    osm: OsmSignal & { extentFrom: string | null };
    /**
     * What a curator reads on the card of a row the tree did not vouch for:
     * which signal carried it in (#895). Absent on a row admitted by class.
     */
    note?: string;
  }
  | { pass: false; reason: string; group: SiteRefusalGroup }
  | { pass: false; out: true };

/**
 * The value of a key whose presence says something, unless the mapper wrote
 * the opposite: `ruins=no` is a statement that the thing is *not* in ruins,
 * and both enumerations leave it out (`FILTER(?ruins != "no")`,
 * `["ruins"!="no"]`) — but the per-item read carries every value, and both
 * readers below see the same objects, so the rule says it once here.
 */
function saidOf(object: OsmObject, key: string): string | null {
  const value = object.tags[key];
  return value && value !== 'no' ? value : null;
}

/** The ruin tag of one object, spelled as `key=value`, or null. */
function ruinTagOf(object: OsmObject): string | null {
  const historic = object.tags.historic;
  if (historic && RUIN_HISTORIC.has(historic)) return `historic=${historic}`;
  for (const key of RUIN_KEYS) {
    const value = saidOf(object, key);
    if (value) return `${key}=${value}`;
  }
  const manMade = object.tags.man_made;
  if (manMade && RUIN_MAN_MADE.has(manMade)) return `man_made=${manMade}`;
  return null;
}

/**
 * The living-place tag of one object, or null.
 *
 * `boundary=census` counts as one, and not as a courtesy: it is the outline a
 * statistical office drew around a population it counts. The four New Mexico
 * census places of the pool — Acomita Lake, North Acomita Village,
 * Skyline-Ganipa, Sunrise — are mapped `place=locality` (a named spot, not a
 * town) with that boundary around them, and without this line they walked in as
 * digs on the `archaeological site` class Wikidata also gives them.
 */
function livingTagOf(object: OsmObject): string | null {
  const place = object.tags.place;
  if (place && LIVING_PLACE.has(place)) return `place=${place}`;
  return object.tags.boundary === CENSUS_BOUNDARY ? `boundary=${CENSUS_BOUNDARY}` : null;
}

/**
 * What OSM says that is not nothing and is not a verdict: the tags that say
 * somebody thinks this place is worth protecting or visiting.
 *
 * `heritage=*` is a listing on somebody's register, a protected area is a line
 * drawn around something, `tourism=attraction` is a sign at the road. None of
 * the three says *ruin* — a living town is on heritage registers too — which is
 * why step 2 does not read them. Step 4 does, where there is nothing else.
 */
function weakTagOf(object: OsmObject): string | null {
  if (object.tags.heritage) return `heritage=${object.tags.heritage}`;
  const boundary = object.tags.boundary;
  if (boundary && PROTECTED_BOUNDARY.has(boundary)) return `boundary=${boundary}`;
  return object.tags.tourism === 'attraction' ? 'tourism=attraction' : null;
}

/**
 * What the map says about this item, over all of its objects.
 *
 * **A ruin anywhere outweighs a town anywhere**, and that is deliberate: Petra,
 * Palmyra, Byblos and Cyrene are each a living town beside the ruins with both
 * mapped, and the ruin is what a traveller goes for. The `wikidata` tag names
 * the item of the *mapped object* (the tagging wiki's own convention), so which
 * of an item's objects carries it is an accident of mapping — which is why
 * every object is read rather than one being chosen.
 */
export function siteSignal(objects: OsmObject[]): OsmSignal {
  for (const object of objects) {
    const tag = ruinTagOf(object);
    if (tag) return { verdict: 'ruin', object: object.ref, tag };
  }
  for (const object of objects) {
    const tag = livingTagOf(object);
    if (tag) return { verdict: 'living', object: object.ref, tag };
  }
  return { verdict: 'none', object: null, tag: null };
}

/**
 * The polygon to draw on the map, among the item's ruin objects and the
 * protected areas drawn around them: **a designated one first, then the one
 * covering the most ground**; none where it has neither.
 *
 * Not the ruin object first, and the Nazca Lines are why. Its ruin object
 * (`relation/17435522`, `historic=archaeological_site`) traces one group of
 * geoglyphs and measures 0.0015 km² — a speck the reader would see as a dot
 * beside the pin — while the World Heritage zone around the whole desert of
 * lines (`relation/2729059`, `heritage=1`) measures 774 km². A ruin-first rule
 * drew the speck. Petra reads the same way from the other side: there the ruin
 * object *is* the park.
 *
 * **A designation first**, because an object carrying `heritage=*` is one a
 * heritage body drew a line around — for a World Heritage site, the inscribed
 * zone — and at Nazca the outer archaeological reserve is a four-corner box of
 * 5,638 km² that nobody designated, which the most ground alone would draw.
 * **Then the most ground** (`largestByArea`) rather than the longest tracing:
 * replayed on the mirror's answers for the 836 items with an extent (the dev
 * cache of 2026-09-14), the two differ on twenty, and the finer tracing is the
 * smaller shape where they do — Sarmizegetusa Regia's castle speck in 3,217
 * characters against its site, a hundred times the ground, in 267; Preah
 * Khan's central temple against its enclosure; the Theatre of Dionysus,
 * Tintern Abbey, Sacsayhuamán likewise. The replay's areas are the shoelace
 * approximation; the two Nazca figures above are the writer's own expression
 * on the dev database. The replay is `extent-rule-compare-2026-09-14.txt` in
 * the gitignored `data/cache/osm-sites/`.
 *
 * A point and a line are not extents — `experiences.boundary` is a MultiPolygon
 * and a line around nothing tells a reader nothing — and neither is a city's
 * administrative outline, whose geometry the reader never even fetches.
 */
export function siteExtent(objects: OsmObject[]): { ref: string; wkt: string } | null {
  const drawable = objects.filter((object) => wktIsPolygonal(object.wkt));
  const candidates = drawable.filter(
    (object) => ruinTagOf(object) !== null
      || PROTECTED_BOUNDARY.has(object.tags.boundary ?? ''),
  );
  const designated = candidates.filter((object) => object.tags.heritage !== undefined);
  const chosen = largestByArea(designated.length > 0 ? designated : candidates);
  return chosen && chosen.wkt ? { ref: chosen.ref, wkt: chosen.wkt } : null;
}

/**
 * What a kept-out card says where OSM maps a town and nothing says ruin.
 *
 * The sentence names the two things the rule actually read, and only those. A
 * row that states a population is refused because people are counted there
 * (Athens 643,452, Asyut 562,061). A row that states none is refused because
 * nothing on the item says "dig" — Populonia, Baia, Tindari, Tus and Halki are
 * the five of those above the line, each a hamlet or a suburb on the map with
 * an ancient city of the same name under it, and each a curator's to return.
 * Telling those five that "Wikidata counts its people" would put a fact in the
 * refusal that the rule never read.
 */
function livingReason(facts: SiteFacts, signal: OsmSignal): string {
  // What OSM actually drew: a town, or the outline a statistical office put
  // around a population it counts (`boundary=census`, the four New Mexico rows).
  const mapped = signal.tag?.startsWith('boundary=') ? 'a counted population' : 'a town';
  const found = facts.statesPopulation ? 'counts its people' : 'gives it no class of a site';
  return `a living place — OSM maps ${mapped} here and Wikidata ${found} `
    + `(${signal.tag} on ${signal.object})`;
}

/**
 * And where nothing on the map says anything at all — in the words of what the
 * row actually is.
 *
 * "A city" is right for Sabratha, Akkad and Carthage and wrong for a quarter of
 * the rows it is written for: 17 of the 60 settlement-branch rows this sentence
 * refuses carry `place=island` in OSM and nothing else — Rhodes, Samos, Chios,
 * Ithaca, Zakynthos, Milos, Salamis, Lefkada … the Aegean poleis, which are in
 * the pool because Wikidata types each an ancient `polis` (measured
 * 2026-09-14). Telling a curator that Ithaca is a city Wikidata files under
 * archaeological sites is telling them something false about the island in the
 * photograph beside it, and the fact was in the rule's own hand all along.
 */
const NO_RUIN_REASON = 'a city Wikidata files under archaeological sites, with no ruin on the map';
const NO_RUIN_ISLAND_REASON =
  'an island Wikidata files under archaeological sites, with no ruin on the map';

/** Which of the two the map's own tags call for. */
const noRuinReason = (objects: OsmObject[]): string => (
  objects.some((object) => object.tags.place === 'island')
    ? NO_RUIN_ISLAND_REASON
    : NO_RUIN_REASON
);

/**
 * What the map had to offer, said the way a curator would say it.
 *
 * The singular is spelled out rather than assembled: 16 rows of the pool carry
 * exactly one object that says nothing this kind reads — Constantinople, Samos,
 * Chios among them — and "1 OSM object carries it, none of them a ruin" is not
 * a sentence anybody would write.
 */
function osmNote(objects: OsmObject[]): string {
  if (objects.length === 0) return 'no OSM object carries this item';
  if (objects.length === 1) return 'one OSM object carries it, and it is not a ruin';
  return `${objects.length} OSM objects carry it, none of them a ruin`;
}

/** The first of the item's classes in a list, or null. */
const firstIn = (classes: string[], list: Record<string, string>): string | null =>
  classes.find((cls) => list[cls] !== undefined) ?? null;

/** Whether the item says, directly and not through a closure, that it is a dig. */
const hasSiteClass = (facts: SiteFacts): boolean =>
  facts.classes.some((cls) => SITE_CLASSES[cls] !== undefined);

/**
 * What refuses this item outright, or null.
 *
 * Three lists, and the difference between them is what can lift each. A
 * shipwreck is a shipwreck whatever else it is. A `lost city` is lifted by a
 * direct site class, because an item Wikidata also calls a dig is not a modern
 * evacuation. A lake, a reservoir, a desert or a mountain range is lifted only
 * by a ruin on the map or by the place being World Heritage itself, because
 * Lake Bled carries the site class and is still a lake.
 *
 * **Only the wrecks are matched as a tree**, and only they need to be: ADR-0058
 * decision 4 says "shipwreck and its subclasses", the closure is four classes
 * wide, and the `SS Central America` is a wreck by a class the root does not
 * spell. The other three lists are matched flat against the item's own `P31`s,
 * which is what they are about — a row Wikidata calls a lake, a desert or a
 * lost city, in those words. A closure under `lake` would drag in every kind of
 * water body ever defined and refuse rows nobody measured.
 */
function killed(facts: SiteFacts, signal: OsmSignal, trees: ArchaeologyTrees): string | null {
  const byName = SITE_KILL_BY_NAME[facts.qid];
  if (byName) return byName;

  // The wreck classes are read as a tree — `SHIPWRECK_ROOT`'s own closure, four
  // classes on 2026-09-14 — so a subclass of `shipwreck` is refused with the
  // sentence the root carries.
  if (facts.classes.some((cls) => trees.shipwreck.has(cls))) {
    return `Wikidata types it ${SITE_KILL_CLASSES[SHIPWRECK_ROOT]}`;
  }

  const lostCity = firstIn(facts.classes, SITE_KILL_UNLESS_SITE);
  if (lostCity && !hasSiteClass(facts)) return SITE_KILL_UNLESS_SITE[lostCity];

  const natural = firstIn(facts.classes, SITE_KILL_NATURAL);
  if (natural && signal.verdict !== 'ruin' && !facts.worldHeritage) {
    return `${SITE_KILL_NATURAL[natural]} Wikidata also files under archaeological sites, `
      + 'with no ruin on the map';
  }
  return null;
}

/** The line, asked last, as `lineStanding` decides it for every kind. */
function admit(
  signal: OsmSignal,
  objects: OsmObject[],
  stands: LineStanding,
  facts: SiteFacts,
  line: LinePair,
): SiteVerdict {
  if (stands === 'out') return { pass: false, out: true };
  if (stands === 'fell') {
    return {
      pass: false,
      reason: belowLineReason(facts.sitelinks, line),
      group: 'below-the-line',
    };
  }
  const extent = siteExtent(objects);
  return { pass: true, type: 'site', osm: { ...signal, extentFrom: extent ? extent.ref : null } };
}

/** How one object names the thing: as a dig, as ruins, or not at all. */
function digTagOf(object: OsmObject): { tag: string; names: 'dig' | 'ruins' } | null {
  const historic = object.tags.historic;
  if (historic && OSM_DIG_HISTORIC.has(historic)) return { tag: `historic=${historic}`, names: 'dig' };
  const dig = saidOf(object, OSM_DIG_KEY);
  if (dig) return { tag: `${OSM_DIG_KEY}=${dig}`, names: 'dig' };
  if (historic && OSM_RUINS_HISTORIC.has(historic)) return { tag: `historic=${historic}`, names: 'ruins' };
  const ruins = saidOf(object, OSM_RUINS_KEY);
  if (ruins) return { tag: `${OSM_RUINS_KEY}=${ruins}`, names: 'ruins' };
  return null;
}

/** What OpenStreetMap says the thing is: the strongest word over all of its objects. */
interface OsmNaming { object: OsmObject; tag: string; names: 'dig' | 'ruins' }

/**
 * The object that named a candidate the tree did not vouch for, a dig before
 * ruins: `historic=archaeological_site` is a statement about what stands
 * there, `ruins=yes` about its condition, and the vetoes read the two apart.
 */
function osmNaming(objects: OsmObject[]): OsmNaming | null {
  let ruins: OsmNaming | null = null;
  for (const object of objects) {
    const named = digTagOf(object);
    if (!named) continue;
    if (named.names === 'dig') return { object, ...named };
    ruins ??= { object, ...named };
  }
  return ruins;
}

/**
 * What refuses a candidate only OpenStreetMap named, or null (#895).
 *
 * Four vetoes, each read off the item's own classes, because the map's word
 * is all the row has and Wikidata is where the mapper's slip shows: a ruin
 * node carrying the item of a building that no longer exists (the Hanging
 * Gardens), of the find rather than the find spot (the Venus of Willendorf),
 * of something that is not a place to stand in at all (`OSM_ONLY_NOT_A_PLACE`:
 * Azovstal's works, a national library, a council), or `ruins=yes` on a
 * castle, a palace, a church or a museum that is a monument in ruins and
 * another kind's row or nobody's (Devín, Bodiam, the Tower of David). `historic=archaeological_site` on the same item is the
 * mapper saying otherwise and is not vetoed by a class: Tintagel Castle and the
 * Thracian Tomb of Kazanlak come in.
 */
function osmOnlyVeto(facts: SiteFacts, naming: OsmNaming, trees: ArchaeologyTrees): string | null {
  if (facts.classes.includes(DESTROYED_CLASS)) {
    return 'Wikidata files it as a destroyed building or structure, and gives it no class of a site';
  }
  if (facts.classes.some((cls) => trees.artefact.has(cls))) {
    return 'a find, not a place: Wikidata files it under archaeological artefacts';
  }
  const notAPlace = firstIn(facts.classes, OSM_ONLY_NOT_A_PLACE);
  if (notAPlace) {
    return `not a place to stand in: Wikidata files it as ${OSM_ONLY_NOT_A_PLACE[notAPlace]}`;
  }
  if (naming.names === 'ruins') {
    const monument = [
      [trees.fortification, 'a fortification'],
      [trees.palace, 'a palace'],
      [trees.worship, 'a place of worship'],
      [trees.museum, 'a museum'],
    ] as const;
    const flat = firstIn(facts.classes, RUINS_ONLY_MONUMENT_CLASSES);
    const what = monument.find(([tree]) => facts.classes.some((cls) => tree.has(cls)))?.[1]
      ?? (flat ? RUINS_ONLY_MONUMENT_CLASSES[flat] : undefined);
    if (what) {
      return `Wikidata files it as ${what}, and OpenStreetMap says only that it is in ruins `
        + `(${naming.tag} on ${naming.object.ref})`;
    }
  }
  return null;
}

/**
 * The verdict on a candidate OpenStreetMap named and the class tree did not
 * — the pool's second entrance (#895, ADR-0060).
 *
 * The map's word is the step-2 signal by construction, so what is asked here
 * is whether Wikidata's classes contradict it: the four vetoes above, then
 * the living place. **A population statement is the living-place rule here**,
 * where for a row the tree vouches for it is the last word in one narrow
 * dispute: a comune of Italy or a Spanish municipality is on no settlement
 * branch and states its people all the same, and eighteen of them arrive on a
 * ruin object the mapper linked to the town's article (Potenza, Alcalá de
 * Henares). Two things outweigh it — the place being World Heritage itself
 * (Delos, counted at a handful of people), and English Wikipedia filing the
 * article under its archaeological sites (Jerash, Lagash, Kilwa Kisiwani,
 * Qalhat, Písac) — and the card says which carried it.
 *
 * A row nothing on the map names any more — the per-item read no longer
 * answers with the object that put it in the pool — is `out`, never refused:
 * it claimed nothing, and the sweep decides an admitted row's fate.
 */
function osmNamedVerdict(
  facts: SiteFacts,
  objects: OsmObject[],
  trees: ArchaeologyTrees,
  stands: LineStanding,
  line: LinePair,
  refuse: (reason: string, group: SiteRefusalGroup) => SiteVerdict,
): SiteVerdict {
  const naming = osmNaming(objects);
  if (!naming) return { pass: false, out: true };

  const veto = osmOnlyVeto(facts, naming, trees);
  if (veto) return refuse(veto, 'class-or-name');

  // What the mapper wrote, as the card quotes it: a town under `historic=ruins`
  // was not called a dig by anyone.
  const mapped = `${naming.names === 'dig' ? 'an archaeological site' : 'ruins'} here `
    + `(${naming.tag} on ${naming.object.ref})`;
  const vouched = facts.worldHeritage || facts.namedByCategory === true;
  if (facts.statesPopulation && !vouched) {
    return refuse(
      `a living place — Wikidata counts its people and gives it no class of a site; only OpenStreetMap maps ${mapped}`,
      'living',
    );
  }

  const signal: OsmSignal = { verdict: 'ruin', object: naming.object.ref, tag: naming.tag };
  const admitted = admit(signal, objects, stands, facts, line);
  if (!admitted.pass) return admitted;
  const note = `no class of a site on Wikidata; OpenStreetMap maps ${mapped}`
    + (facts.namedByCategory ? '; English Wikipedia files it under its archaeological sites' : '');
  return { ...admitted, note };
}

/**
 * The whole verdict on one candidate: in, refused by name, or simply out.
 *
 * `out` is not a refusal, and the distinction is `sourceLine.ts`'s for every
 * kind: a refusal names a rule that ran on a row somebody has heard of, and a
 * row nobody has heard of that the source never admitted had none run on it.
 * 830 of this pool's rows sit between 15 and 21 sitelinks, and naming a living
 * village down there would bury the refusals a curator has to read — Athens,
 * Cairo, Rhodes, Sabratha — under the long tail. So the rule decides first and
 * the line decides whether the answer is *said*.
 */
export function siteVerdict(input: {
  facts: SiteFacts;
  objects: OsmObject[];
  trees: ArchaeologyTrees;
  admitted: ReadonlySet<string>;
  line: LinePair;
}): SiteVerdict {
  const { facts, objects, trees, admitted, line } = input;
  const signal = siteSignal(objects);
  const stands = lineStanding(facts.sitelinks, admitted.has(facts.qid), line);
  const refuse = (reason: string, group: SiteRefusalGroup): SiteVerdict =>
    (stands === 'out' ? { pass: false, out: true } : { pass: false, reason, group });

  // 1. What the item is not.
  const kill = killed(facts, signal, trees);
  if (kill) return refuse(kill, 'class-or-name');

  // The second entrance (#895): no class under `archaeological site` on the
  // item — the pool named it off an OpenStreetMap object tagged as a dig or
  // as ruins — so the map's word stands in for the class, and Wikidata's
  // classes are read as what can contradict it.
  if (!facts.classes.some((cls) => trees.site.has(cls))) {
    return osmNamedVerdict(facts, objects, trees, stands, line, refuse);
  }

  // Which branch the item came in on is a question about the class tree — is
  // any of its `P31`s under `human settlement` — so it is answered here, off
  // the trees the rule already holds, rather than handed in. Handed in, it is a
  // boolean a caller can forget: a defaulted `false` reaches step 4 as if
  // Wikidata had called Athens a dig.
  const settlementBranch = facts.classes.some((cls) => trees.settlement.has(cls));

  // 2. The map says a ruin stands here. Whatever branch the item came in on,
  //    and whatever Wikidata's classes call it.
  if (signal.verdict === 'ruin') {
    return admit(signal, objects, stands, facts, line);
  }

  // 3. The map says people live here, and nothing says ruin. The one narrow
  //    dispute where the population statement is the last word: a site class
  //    with nobody counted is a dig inside a village (Saqqara, Dahshur, Cumae),
  //    and the same class with half a million people is a city (Asyut, Esna).
  //    World Heritage on the item itself outweighs both — Bagan, Anuradhapura,
  //    Baalbek are the ruins the town grew into, and the Committee has said so.
  if (signal.verdict === 'living') {
    const lifted = facts.worldHeritage || (hasSiteClass(facts) && !facts.statesPopulation);
    if (!lifted) return refuse(livingReason(facts, signal), 'living');
    return admit(signal, objects, stands, facts, line);
  }

  // 4. The map says nothing of interest — a weak tag, an object with no tag
  //    this kind reads, or no object at all. Then the branch decides: on the
  //    site branch the class is all there is and it says site; on the
  //    settlement branch the item is a city unless it says otherwise itself.
  //
  //    **Or unless somebody protects it and nobody is counted there.** Carthage
  //    is the row that made this arm: `city-state, ancient city, emporium` on
  //    Wikidata, no site class, no population statement, and one OSM object —
  //    relation/8305288 — carrying `heritage=1`. A settlement-branch item with
  //    a weak signal and no people counted is a dig, and the pool holds exactly
  //    two of them: Carthage (Q6343) and Demetrias (Q1150349,
  //    relation/18138696, `heritage=2`), measured 2026-09-14, both real sites.
  //
  //    The population half of the arm is a guard rather than a rule anybody
  //    reads: **no measured row reaches it**. The near misses are refused
  //    before this step — Tyre, Sidon, Agrigento and Side carry a town on the
  //    map and are living places at step 3 — and Syracuse reaches step 4 with
  //    an administrative relation and no weak tag at all, so it is refused by
  //    `osmNote`. The sentence below exists so that a row which does turn up
  //    with both facts says which two they were, rather than reporting the
  //    count of objects as if the tag had not been read.
  if (settlementBranch && !hasSiteClass(facts) && !facts.worldHeritage) {
    const weak = objects.map(weakTagOf).find((tag) => tag !== null) ?? null;
    if (weak && !facts.statesPopulation) return admit(signal, objects, stands, facts, line);
    const why = weak
      ? `${weak} is all OSM says, and Wikidata counts its people`
      : osmNote(objects);
    return refuse(`${noRuinReason(objects)} (${why})`, 'no-ruin');
  }
  return admit(signal, objects, stands, facts, line);
}
