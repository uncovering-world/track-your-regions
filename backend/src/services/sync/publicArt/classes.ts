/**
 * Which Wikidata classes make something public art, which make it something
 * else, and which are the heritage sense of "monument" that says nothing
 * either way.
 *
 * Read off the real rows the first import admitted (205 on the dev database,
 * classes fetched on 2026-09-04) rather than off a label search, the way the
 * museum lists were: every QID below carries the label named, verified against
 * Wikidata on that date. The lists are *classes*, not entities — a rule about
 * kinds of thing, which a curator's verdict can extend without a deploy.
 *
 * Two facts about Wikidata shape the lists:
 *
 * - `monument` (Q4989906) is the heritage-designation sense as often as the
 *   commemorative one. Eleven Spanish cathedrals are typed `Catholic
 *   cathedral, monument` because "Monumento" is what Spain's heritage register
 *   calls a listed building. So a monument class admits, but never lifts a
 *   veto: a cathedral that is also a monument is a cathedral.
 * - The subclass trees under `monument` (1000 classes, three hops) and
 *   `memorial` (694) are burial and archaeology. Of their classes with an
 *   instance at 15 sitelinks or more, the biggest are tomb (95), mausoleum
 *   (93), historic site (95), tell (66) and hypogeum (57). Neither tree is
 *   followed; the commemorative kinds worth having are pinned by name below.
 */

// =============================================================================
// What admits
// =============================================================================

/**
 * The roots the run walks with `boundedClosure`, as the museum import walks
 * its artwork roots. `sculpture` refuses its second hop (142 841 classes —
 * Wikidata gives every denomination of coin its own class under it) and keeps
 * its first (237, measured); `statue` reaches 280 classes in three hops,
 * `fountain` 72, `war memorial` 38, `cenotaph` 12.
 */
export const SCULPTURAL_ROOTS: Record<string, string> = {
  Q860861: 'sculpture',
  Q179700: 'statue',
};

export const FOUNTAIN_ROOT = 'Q483453';

/** Commemorative closures: what they reach admits, but is not an artwork. */
export const COMMEMORATIVE_ROOTS: Record<string, string> = {
  Q575759: 'war memorial',
  Q321053: 'cenotaph',
};

/**
 * The heritage sense of "monument": a class that admits a row to the pool and
 * says nothing about what stands there. A memorial can be a plaque, a park or
 * a museum; a National Memorial of the United States is a kind of protected
 * area; a national monument is a designation. None of these lifts a veto.
 */
export const HERITAGE_SENSE_CLASSES: Record<string, string> = {
  Q4989906: 'monument',
  Q5003624: 'memorial',
  Q893745: 'national monument',
  Q1967454: 'National Memorial of the United States',
  Q20011797: 'Holocaust memorial',
  Q1885014: 'cautionary memorial',
  Q114125020: 'victims of communism memorial',
  Q1541043: 'tomb of the unknown soldier',
};

/**
 * Structures a traveller stands in front of, pinned because no closure the
 * run follows reaches them: they sit under `monument`, whose tree is not
 * walked. Each is an artwork for the veto rule — an obelisk inside a museum's
 * grounds is still an obelisk, which is how Monas in Jakarta (typed museum
 * too) stays. `cross` (Q40843) is labelled a geometrical figure, and it is
 * the class the Millennium Cross in Skopje and the Three Crosses in Vilnius
 * carry; a figure has no coordinates, so nothing else reaches the pool by it.
 */
export const MONUMENT_CLASSES: Record<string, string> = {
  Q143912: 'triumphal arch',
  Q12277: 'arch',
  Q170980: 'obelisk',
  Q1930585: 'victory column',
  Q1112897: 'rostral column',
  Q60234534: 'spiral column',
  Q11741382: 'Holy Trinity column',
  Q492255: 'tetrapylon',
  Q1753584: 'tropaion',
  Q178743: 'stele',
  Q22022298: 'rock relief',
  Q3476533: 'monumental sculpture',
  Q2293362: 'group of sculptures',
  Q107338575: 'sculptural set',
  Q815241: 'runestone',
  Q40843: 'cross',
};

// =============================================================================
// What refuses
// =============================================================================

/**
 * The second `P279*` tree the indoor rule and the vetoes are asked against;
 * the first is `MUSEUM_ROOT` from the shared kit. 1265 classes, measured on
 * 2026-09-04 — class space, which is cheap.
 */
export const WORSHIP_ROOT = 'Q1370598';

/**
 * A floor under that tree: the worship classes the first import's rows
 * actually carried, pinned by name. The tree read at run time extends this
 * and never replaces it — so a tree that comes back short still refuses a
 * cathedral, and the catalogue check, which reads constants and cannot walk
 * a tree, names the same rows the rule would.
 */
export const WORSHIP_CLASSES: Record<string, string> = {
  Q16970: 'church building',
  Q56242215: 'Catholic cathedral',
  Q2577114: 'co-cathedral',
  Q120560: 'minor basilica',
  Q24398318: 'religious building',
  Q32815: 'mosque',
  Q845945: 'Shinto shrine',
  Q1534477: 'gokoku shrine',
  Q175288: 'chokusaisha',
  Q5393308: 'Buddhist temple',
  Q44613: 'monastery',
  Q817056: 'benedictine abbey',
  Q840482: 'shrine of Our Lady',
  Q136868: 'imamzadeh',
};

/**
 * What the worship tree reaches that is not a building: a designation a
 * statue can carry. The first dry run refused Christ the Redeemer as a place
 * of worship because Wikidata's tree under "structure of worship" reaches
 * "pilgrimage site", which is what pilgrims make of a statue on a mountain.
 * Taken out of the tree by name, so the rest of it — every church, temple,
 * mosque and shrine class Wikidata knows — still refuses outright.
 */
export const WORSHIP_DESIGNATIONS: Record<string, string> = {
  Q15135589: 'pilgrimage site',
};

/**
 * A container that is indoors whatever the building is called. The Dendera
 * zodiac is located in Room 325 of the Sully Wing of the Louvre *Palace*,
 * which Wikidata types a palace and not a museum; the room says enough.
 */
export const INDOOR_CLASSES: Record<string, string> = {
  Q180516: 'room',
  Q1125776: 'wing',
};

/**
 * Refused whatever else the entity carries, with the reason named. These are
 * other kinds' objects or nobody's: a place of worship is a place of worship
 * though a statue stands in it, a camp is a camp though it is also a memorial,
 * and a commune of France is not somewhere to stand in front of.
 */
export const KILL_CLASSES: Record<string, string> = {
  // Camps and stadiums.
  Q328468: 'Nazi concentration camp',
  Q152081: 'concentration camp',
  Q1264690: 'transit camp',
  Q5996900: 'Ilag',
  Q483110: 'stadium',
  Q1049757: 'multi-purpose stadium',
  Q589481: 'Olympic stadium',
  Q4728370: 'all-seater stadium',
  Q64722124: 'Ancient Greek stadium',
  Q2310214: 'pitch',
  // Archaeology, which is another kind's — and the World Heritage list's.
  Q839954: 'archaeological site',
  Q11269813: 'cave with prehistoric art',
  Q4443227: 'Stone Age site',
  Q755017: 'tell',
  Q665247: 'hypogeum',
  // Burial: a building around the dead, not a work in a square.
  Q381885: 'tomb',
  Q162875: 'mausoleum',
  Q173387: 'grave',
  Q192619: 'crypt',
  Q838159: 'türbe',
  // Finds: a museum object wherever Wikidata locates it. The Venus of
  // Willendorf is "located in" Austria and stands in a case in Vienna.
  Q248726: 'Venus figurine',
  Q1066288: 'figurine',
  Q10855061: 'archaeological find',
  Q220659: 'archaeological artefact',
  // Organisations: Yad Vashem is a research institute, an archive and a
  // publishing house before it is a memorial; the Australian War Memorial is
  // a government body.
  Q31855: 'research institute',
  Q166118: 'archives',
  Q2945282: 'documentation centre',
  Q2085381: 'publishing house',
  Q699386: 'statutory corporation',
  Q163740: 'nonprofit organization',
  Q20857065: 'United States federal agency',
  Q110376455: 'Government body of Australia',
  Q11396960: 'production company',
  Q7247847: 'production team',
  // Settlements and areas: the row is the place, not a monument on it.
  Q486972: 'human settlement',
  Q484170: 'commune of France',
  Q61297932: 'neighborhood of Manhattan',
  Q2755753: 'area of London',
  Q1529: 'traffic circle',
  // Events and works.
  Q1253136: 'liturgical drama',
  Q7725634: 'literary work',
  Q200538: 'party',
  // Attractions and lists.
  Q194195: 'amusement park',
  Q974968: 'miniature park',
  Q47502370: 'walk of fame',
  Q1046088: 'hall of fame',
  Q1759852: 'sculpture garden',
  // Nothing to stand in front of.
  Q26883973: 'lost sculpture',
  Q19860854: 'destroyed building or structure',
  // Landscape.
  Q1129474: 'cultural landscape',
  Q811600: 'sacred grove',
  Q4421: 'forest',
  Q9444: 'rainforest',
  Q820477: 'mine',
  Q124714: 'spring',
};

/**
 * The kill classes that own their parts: a work that is part of an
 * archaeological site or a camp is the site's — the Ishtar Gate is part of
 * Babylon, and what stands in the Pergamon Museum is Babylon's. Read against
 * a *container*, where the rest of the kill-list would be wrong: the Charging
 * Bull is part of the Financial District, the Hermannsdenkmal of the
 * Teutoburg Forest, the Lion Monument of Lucerne, and a settlement, an area
 * or a landscape is where outdoor art stands.
 */
export const SITE_CLASSES: Record<string, string> = {
  Q839954: 'archaeological site',
  Q11269813: 'cave with prehistoric art',
  Q4443227: 'Stone Age site',
  Q755017: 'tell',
  Q665247: 'hypogeum',
  Q328468: 'Nazi concentration camp',
  Q152081: 'concentration camp',
};

/**
 * Refused unless the entity also carries an artwork class — the shape of the
 * museum test's site veto, and for the same reason: a great many real works
 * are also buildings or stand in cemeteries. The Hermannsdenkmal is typed
 * `sculpture, monument, tower, colossal statue` and the tower must not
 * disqualify it; the Soviet War Memorial in Treptower Park is a war cemetery
 * around a monumental sculpture. Without an artwork class the building wins:
 * the Aljafería is a palace, Bayterek is an observation tower, Arlington is a
 * cemetery.
 *
 * The museum tree, read at run time from Wikidata (`MUSEUM_ROOT`), is a veto
 * of this kind too rather than listed here: Monas in Jakarta is an obelisk
 * with a museum in its base. The worship tree is not — a building of worship
 * refuses outright, see `WORSHIP_CLASSES` and `WORSHIP_DESIGNATIONS`.
 */
export const VETO_CLASSES: Record<string, string> = {
  // Cemeteries.
  Q39614: 'cemetery',
  Q1241568: 'war cemetery',
  Q1516659: 'United States national cemetery',
  Q2305029: 'Soviet war cemeteries in Germany',
  // Buildings and structures.
  Q41176: 'building',
  Q811979: 'built structure',
  Q12518: 'tower',
  Q1440300: 'observation tower',
  Q81917: 'fortified tower',
  Q39715: 'lighthouse',
  Q3378136: 'ancient lighthouse',
  Q23413: 'castle',
  Q16560: 'palace',
  Q5383482: 'episcopal palace',
  Q98795663: 'fortified palace',
  Q57831: 'fortress',
  Q57821: 'fortification',
  Q91717: 'alcazaba',
  Q16748868: 'city walls',
  Q7138926: 'parliament building',
  Q153562: 'opera house',
  Q24354: 'theatre building',
  Q7075: 'library',
  Q64578911: 'former hospital',
  Q11707: 'restaurant',
  Q2190251: 'arts center',
  Q12516: 'pyramid',
  Q2914427: 'guardhouse',
  Q327328: 'stoa',
  Q95652804: 'A-bombed building',
  Q109607: 'ruins',
  // Not here: open places and landforms (park, square, avenue, garden, hill,
  // mound). The first dry run refused the Mansu Hill Grand Monument as a
  // square and Mamayev Kurgan as a hill — a monument Wikidata types with its
  // site is a monument on a site, and nothing about a square says a traveller
  // is not standing in front of something.
};

// =============================================================================
// The trees a verdict is asked against
// =============================================================================

export interface PublicArtTrees {
  /** The sculpture and statue closures: a row carrying one is typed `sculpture`. */
  sculptural: ReadonlySet<string>;
  /** Everything that lifts a veto: sculptural, fountains, and the pinned structures. */
  artwork: ReadonlySet<string>;
  /** Everything the pool is asked for: artwork, the commemorative closures, the heritage sense. */
  admitting: ReadonlySet<string>;
  /** `P279*` under museum (Q33506). */
  museum: ReadonlySet<string>;
  /** `P279*` under structure of worship (Q1370598). */
  worship: ReadonlySet<string>;
}

/**
 * Compose the sets the verdict reads from what the run fetched and what is
 * pinned here, so that the rule about which class counts for what is written
 * once — the pipeline hands over closures, and this is where the pinned lists
 * join them.
 */
export function buildTrees(fetched: {
  sculptural: Iterable<string>;
  fountain: Iterable<string>;
  commemorative: Iterable<string>;
  museum: Iterable<string>;
  worship: Iterable<string>;
}): PublicArtTrees {
  const sculptural = new Set(fetched.sculptural);
  const artwork = new Set([...sculptural, ...fetched.fountain, ...Object.keys(MONUMENT_CLASSES)]);
  const admitting = new Set([
    ...artwork, ...fetched.commemorative, ...Object.keys(HERITAGE_SENSE_CLASSES),
  ]);
  const worship = new Set([...fetched.worship, ...Object.keys(WORSHIP_CLASSES)]);
  for (const designation of Object.keys(WORSHIP_DESIGNATIONS)) worship.delete(designation);
  return {
    sculptural,
    artwork,
    admitting,
    museum: new Set(fetched.museum),
    worship,
  };
}
