/**
 * Which Wikidata classes make something public art or a monument, which make
 * it something else, and which are the heritage sense of "monument" — which
 * admits a monument and lifts no veto.
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

/**
 * Commemorative closures: what they reach admits, but is not an artwork. With
 * `MEMORIAL_CLASSES` below, the commemorative set of the trees.
 */
export const COMMEMORATIVE_ROOTS: Record<string, string> = {
  Q575759: 'war memorial',
  Q321053: 'cenotaph',
};

/**
 * The commemorative classes pinned by name, beside the closures above: what a
 * thing built to remember carries. A memorial can be a plaque, a park or a
 * hall, so none of these is an artwork and none lifts a building's veto — but
 * a memorial that Wikidata also types a museum is a memorial complex with a
 * museum in it, not a museum: a traveller stands in front of Tsitsernakaberd's
 * flame and the 9/11 pools whether or not there is a museum below (#803). So
 * the commemorative classes lift the museum veto alone. Measured on the pool
 * of 2026-09-13: above the line, that admits Tsitsernakaberd, the 9/11
 * Memorial and the Victoria Memorial in Kolkata. For Monuments & memorials
 * they lift a cemetery's veto and a bare building's too (`MEMORIAL_LIFTS`):
 * the Neue Wache is a guardhouse raised as a memorial, and Arlington is a
 * cemetery a traveller visits as one. The Anne Frank House, which Wikidata types `historic house
 * museum, war memorial`, is a house (`OTHER_PLACE_CLASSES`).
 */
export const MEMORIAL_CLASSES: Record<string, string> = {
  Q5003624: 'memorial',
  Q20011797: 'Holocaust memorial',
  Q1885014: 'cautionary memorial',
  Q114125020: 'victims of communism memorial',
  Q1541043: 'tomb of the unknown soldier',
  // Read off what Wikidata says commemorates someone (P547) and no class
  // question named, on 2026-10-23 (#1832): at 15 sitelinks or more these
  // classes hold the Hiroshima and Nagasaki peace parks, the Mask of Sorrow,
  // the Šumarice Memorial Park, the Srebrenica Genocide Memorial and the
  // United Nations Memorial Cemetery, the Murambi, Nyamata and Kigali
  // genocide memorials, the Skull Tower in Niš and the Bismarck Memorial.
  Q12327290: 'memorial park',
  Q56190453: 'memorial complex',
  Q2532223: 'memorial cemetery',
  Q130753722: 'Memorial of the Genocide against the Tutsi in Rwanda',
  Q16052426: 'skull tower',
  Q820243: 'Bismarck monument',
};

/**
 * The commemorative classes a constant can read: the pinned ones and the roots
 * of the walked closures. What lifts a kill for Monuments & memorials
 * (`MEMORIAL_LIFTED_KILLS`) is read off this floor rather than off the walked
 * tree, so the rule and the catalogue check, which cannot walk a tree
 * (`objectAssertions.ts`), read one list and agree on every row.
 */
export const COMMEMORATIVE_FLOOR: Record<string, string> = {
  ...COMMEMORATIVE_ROOTS,
  ...MEMORIAL_CLASSES,
};

/**
 * The heritage sense of "monument": a designation that admits a row to the
 * pool and says nothing about what stands there. Spain's register calls a
 * museum a monument (the Reina Sofía, the Bilbao Fine Arts Museum); a national
 * monument is a designation; a National Memorial of the United States is a
 * kind of protected area. None of these lifts a veto — not even the museum's.
 *
 * Monuments & memorials admits by the two monument senses: a row typed only
 * that is the Tsar Bell or the Krakus Mound, something a traveller visits as a
 * monument, once the place vetoes have refused the lake and the road. The
 * National Memorial designation alone admits nothing: Federal Hall is a
 * building with a museum, and the Jefferson Memorial, typed nothing else, is
 * admitted by whom it commemorates (`P547`).
 */
export const HERITAGE_MONUMENT_CLASSES: Record<string, string> = {
  Q4989906: 'monument',
  Q893745: 'national monument',
};

export const HERITAGE_SENSE_CLASSES: Record<string, string> = {
  ...HERITAGE_MONUMENT_CLASSES,
  Q1967454: 'National Memorial of the United States',
};

/**
 * The commemorative forms: structures a traveller stands in front of, raised
 * to remember, pinned because no closure the run follows reaches them — they
 * sit under `monument`, whose tree is not walked. Each is an artwork for the
 * veto rule — an obelisk inside a museum's grounds is still an obelisk, which
 * is how Monas in Jakarta (typed museum too) stays. `cross` (Q40843) is
 * labelled a geometrical figure, and it is the class the Millennium Cross in
 * Skopje and the Three Crosses in Vilnius carry; a figure has no coordinates,
 * so nothing else reaches the pool by it. An equestrian statue is a monument
 * to its rider by tradition — Genghis Khan at Tsonjin Boldog, Emperor William
 * at the Deutsches Eck — where a statue may be anyone's. A monumental
 * sculpture is one made as a monument: the Bronze Horseman, the Lion of
 * Belfort, and the Statue of Liberty by its genre (#1832). What Monuments &
 * memorials admits, with the commemorative set and the heritage sense, read
 * from the genre (`P136`) as well as the class: the Bronze Horseman and
 * Gattamelata are typed sculptures and filed as equestrian statues.
 */
export const COMMEMORATIVE_FORMS: Record<string, string> = {
  Q143912: 'triumphal arch',
  Q12277: 'arch',
  Q170980: 'obelisk',
  Q1930585: 'victory column',
  Q1112897: 'rostral column',
  Q60234534: 'spiral column',
  Q11741382: 'Holy Trinity column',
  Q26789694: 'plague column',
  Q492255: 'tetrapylon',
  Q1753584: 'tropaion',
  Q178743: 'stele',
  Q22022298: 'rock relief',
  Q815241: 'runestone',
  Q40843: 'cross',
  Q659396: 'equestrian statue',
  Q3476533: 'monumental sculpture',
  // The Monument to the Great Fire of London (#1832).
  Q51845395: 'memorial column',
};

/**
 * The genre (`P136`) Wikidata files a work of public art under: a work, then,
 * whatever building, museum or cemetery it is also typed. For Monuments &
 * memorials it answers those vetoes as an artwork class does: the Soviet War
 * Memorial in the Tiergarten is typed cemetery, military museum and monument,
 * and the Monument to the Conquerors of Space historic site, monument and
 * museum, with the museum in its base; neither the Reina Sofía nor the Bilbao
 * Fine Arts Museum is filed under it (#1832).
 */
export const PUBLIC_ART_GENRE = 'Q557141';

/**
 * Whom a statue is raised to, read from what it depicts (`P180`, #1832): a
 * person — Sardar Vallabhbhai Patel on the Statue of Unity, Jan Hus in the Old
 * Town Square — or a nation, as Mother Ukraine depicts Ukraine. A depicted
 * person Wikidata says is worshipped (`P1049`) or types a biblical figure is a
 * devotional image, not a monument: the Tian Tan Buddha depicts the Buddha,
 * Christ the King in Świebodzin Jesus, and the Rondanini Pietà Mary. Being a
 * saint is not that: St Wenceslas on Wenceslas Square is a monument.
 */
export const PERSON_CLASS = 'Q5';
export const BIBLICAL_FIGURE_CLASS = 'Q20643955';
export const NATION_CLASSES: Record<string, string> = {
  Q6256: 'country',
  Q3624078: 'sovereign state',
};

/** The forms a Monuments & memorials type names, beside `memorial` and `monument`. */
export const ARCH_CLASSES: Record<string, string> = {
  Q143912: 'triumphal arch',
  Q12277: 'arch',
  Q492255: 'tetrapylon',
};
export const COLUMN_CLASSES: Record<string, string> = {
  Q1930585: 'victory column',
  Q51845395: 'memorial column',
  Q1112897: 'rostral column',
  Q60234534: 'spiral column',
  Q11741382: 'Holy Trinity column',
  Q26789694: 'plague column',
};
export const OBELISK_CLASSES: Record<string, string> = {
  Q170980: 'obelisk',
};

/**
 * Sculptural classes pinned by name, beside the sculpture, statue and
 * fountain closures: what Public art admits. A sculpture group or a sculptural
 * set is typed by neither closure; a mural and street art are painted, and a
 * traveller walks to the Fraternal Kiss on the East Side Gallery for the same
 * reason as to a statue.
 */
export const SCULPTURAL_CLASSES: Record<string, string> = {
  Q3476533: 'monumental sculpture',
  Q2293362: 'group of sculptures',
  Q107338575: 'sculptural set',
  Q219423: 'mural',
  Q17516: 'street art',
};

/**
 * A public clock with a show, made to be watched from the street: the Prague
 * Astronomical Clock, the Zytglogge, Munich's Rathaus-Glockenspiel (#2136).
 * Wikidata files an astronomical clock under works of art, and Public art
 * offers one; Towers refuses one that no clock-tower class names. Pinned
 * rather than walked: the clock tree holds watches, stopwatches and Fabergé
 * eggs.
 */
export const PUBLIC_CLOCK_CLASSES: Record<string, string> = {
  Q5275: 'astronomical clock',
  Q20826189: 'Glockenspiel',
};

/** What a Public art type `street-art` names. */
export const STREET_ART_CLASSES: Record<string, string> = {
  Q219423: 'mural',
  Q17516: 'street art',
};

/**
 * A place a monument class says nothing about: the row is the lake, the road,
 * the square or the house, and a traveller visiting it is not standing in
 * front of a monument (#1807). Wikidata types Sanabria Lake a monument, the
 * Way of Saint James a monument, the Field of Mars a memorial and the Anne
 * Frank House a war memorial; no kind holds a lake, a trail or a house museum
 * yet. Refused unless a sculptural class, a commemorative form or a depiction
 * answers it — the Mansu Hill Grand Monument is typed a square and depicts the
 * two statues it is visited for, and Manneken Pis is a sculpture and a
 * heritage site. A fountain does not: the Villa d'Este's fountains are the
 * villa's garden.
 */
export const OTHER_PLACE_CLASSES: Record<string, string> = {
  Q23397: 'lake',
  Q34442: 'road',
  Q194029: 'Roman road',
  Q67179750: 'trail system',
  Q3317612: 'historic grouping',
  Q358: 'heritage site',
  Q174782: 'square',
  Q12781: "Giardino all'italiana",
  Q3950: 'villa',
  Q2087181: 'historic house museum',
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
 * statue can carry, and a column raised in a square. The first dry run
 * refused Christ the Redeemer as a place of worship because Wikidata's tree
 * under "structure of worship" reaches "pilgrimage site", which is what
 * pilgrims make of a statue on a mountain; it refused the Holy Trinity Column
 * in Olomouc because the tree reaches "Holy Trinity column". Taken out of the
 * tree by name, so the rest of it — every church, temple, mosque and shrine
 * class Wikidata knows — still refuses outright.
 */
export const WORSHIP_DESIGNATIONS: Record<string, string> = {
  Q15135589: 'pilgrimage site',
  Q11741382: 'Holy Trinity column',
};

/**
 * What stands under the sky by what it is: a colossal statue and an obelisk
 * (#1444). Not the commemorative set, since a memorial may be a plaque in a
 * nave or a hall. Read only of a work the rule found
 * inside a museum or a place of worship that no kind offers a reader, where
 * it decides whether the work stands on the grounds — the Mother Ukraine
 * Monument on the war museum's hill, the Philae obelisk in Kingston Lacy's
 * garden — or in a hall, like the Veiled Christ in the Cappella Sansevero,
 * which is a `sculpture` and nothing more. A public clock (`PUBLIC_CLOCK_CLASSES`)
 * is read the same way: the Prague Astronomical Clock is on the Old Town Hall,
 * which Wikidata types a museum too and no kind offers, while Strasbourg's
 * stands in the cathedral that Places of worship offers.
 */
export const OUTDOOR_CLASSES: Record<string, string> = {
  Q1779653: 'colossal statue',
  Q170980: 'obelisk',
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
 * Burial: a building around the dead, not a work in a square, and refused as
 * such (`KILL_CLASSES`) — unless, for Monuments & memorials, a commemorative
 * form stands with it: the Monumento a la Revolución is typed mausoleum and
 * triumphal arch, and a traveller visits the arch (#1832). A mausoleum alone
 * stays refused: Anıtkabir and the mausoleums of Mao and Ho Chi Minh are a
 * kind of their own, still proposed.
 */
export const BURIAL_CLASSES: Record<string, string> = {
  Q381885: 'tomb',
  Q162875: 'mausoleum',
  Q173387: 'grave',
  Q192619: 'crypt',
  Q838159: 'türbe',
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
  ...BURIAL_CLASSES,
  // Finds: a museum object wherever Wikidata locates it. The Venus of
  // Willendorf is "located in" Austria and stands in a case in Vienna.
  Q248726: 'Venus figurine',
  Q1066288: 'figurine',
  Q10855061: 'archaeological find',
  Q220659: 'archaeological artefact',
  // Organisations: a foundation, an archive, a government body. A memorial
  // typed one of these as well is still the memorial, for Monuments &
  // memorials (`MEMORIAL_LIFTED_KILLS`): Yad Vashem is a research institute,
  // an archive and a publishing house too.
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
  // Nothing to stand in front of. A lost or destroyed *work* is read from the
  // whole tree under `lost artwork` instead (`PublicArtTrees.lost`, floored by
  // `LOST_CLASSES`), the tree the works-first kinds read for the same
  // question; a building is not in it.
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
 * with a museum in its base — and, unlike these, one a commemorative class
 * lifts as well (`MEMORIAL_CLASSES`). The worship tree is not — a building
 * of worship refuses outright, see `WORSHIP_CLASSES` and
 * `WORSHIP_DESIGNATIONS`.
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
  // Not here: parks and landforms (park, avenue, hill, mound). The first dry
  // run refused Mamayev Kurgan as a hill — a monument Wikidata types with its
  // site is a monument on a site. A square, a garden or a road is a place of
  // its own unless something on it is a work (`OTHER_PLACE_CLASSES`).
};

/**
 * The vetoes a memorial lifts for Monuments & memorials: a cemetery, and a
 * building Wikidata names no more than a building. The Hiroshima Peace
 * Memorial is an A-bombed building, the Neue Wache a guardhouse, Arlington and
 * Piskaryovskoye cemeteries a traveller visits as memorials. A building of a
 * kind of its own is still that building — Montjuïc Castle is typed a memorial
 * and a castle, and is a castle.
 */
export const MEMORIAL_LIFTS: Record<string, string> = {
  Q39614: 'cemetery',
  Q1241568: 'war cemetery',
  Q1516659: 'United States national cemetery',
  Q2305029: 'Soviet war cemeteries in Germany',
  Q41176: 'building',
  Q811979: 'built structure',
  Q2914427: 'guardhouse',
  Q95652804: 'A-bombed building',
};

/**
 * The kills a commemorative class (`COMMEMORATIVE_FLOOR`) lifts for Monuments
 * & memorials (#1989): the organisations, since a memorial that is also an
 * archive, a research institute or a government body is still the memorial a
 * traveller goes to — Yad Vashem, the United States Holocaust Memorial Museum,
 * the Australian War Memorial; the two attractions a memorial can be filed as
 * — the Walhalla is a hall of fame, Nagasaki Peace Park a sculpture garden;
 * and the burial classes, which a commemorative form lifts already
 * (`BURIAL_CLASSES`, #1832) — Anıtkabir, the Ho Chi Minh Mausoleum and
 * Mazar-e-Quaid are mausoleums typed memorials, and are the monument of their
 * country. Measured on the development run of 2026-10-30 (#1989): ten places
 * enter, every one a monument. A camp, an archaeological site, a settlement,
 * a park and a landscape stay killed whatever else they carry: Stutthof,
 * Stonehenge, the commune of Le Gua and Madurodam are what they are. A `P547`
 * statement lifts none of these — a foundation that commemorates someone is
 * not a place to stand in front of.
 */
export const MEMORIAL_LIFTED_KILLS: Record<string, string> = {
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
  Q1046088: 'hall of fame',
  Q1759852: 'sculpture garden',
  ...BURIAL_CLASSES,
};

// =============================================================================
// The trees a verdict is asked against
// =============================================================================

/**
 * A floor under the lost tree (`LOST_WORK_ROOT`): its members as Wikidata
 * answered on 2026-09-12, pinned by name for the worship floor's reason — the
 * tree read at run time extends this and never replaces it, so a tree that
 * comes back short still refuses a lost sculpture, and the catalogue check,
 * which reads constants and cannot walk a tree, names the rows the rule would.
 */
export const LOST_CLASSES: Record<string, string> = {
  Q4140840: 'lost artwork',
  Q21745157: 'destroyed artwork',
  Q26883973: 'lost sculpture',
  Q104438958: 'lost painting',
};

export interface PublicArtTrees {
  /** The sculpture and statue closures and the pinned sculptural classes. */
  sculptural: ReadonlySet<string>;
  /** The fountain closure: a Public art row carrying one is typed `fountain`. */
  fountain: ReadonlySet<string>;
  /** Everything that lifts a veto: sculptural, fountains, public clocks and the commemorative forms. */
  artwork: ReadonlySet<string>;
  /**
   * The commemorative closures and the pinned memorial classes: what admits,
   * is not an artwork, and lifts the museum veto alone (`MEMORIAL_CLASSES`).
   */
  commemorative: ReadonlySet<string>;
  /** Everything the pool is asked for: artwork, the commemorative set, the heritage sense. */
  admitting: ReadonlySet<string>;
  /** `P279*` under museum (Q33506). */
  museum: ReadonlySet<string>;
  /** `P279*` under structure of worship (Q1370598). */
  worship: ReadonlySet<string>;
  /**
   * `P279*` under lost artwork (`LOST_WORK_ROOT`, Q4140840): a work the source
   * records as lost or destroyed, which leaves nothing to stand in front of.
   * The same tree the Art Museums and Archaeology collectors read for the same
   * question (#868), with the same one exception by name (`REMAINS_ON_SHOW`),
   * so one fact is read one way by every kind (#872).
   */
  lost: ReadonlySet<string>;
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
  lost: Iterable<string>;
}): PublicArtTrees {
  const sculptural = new Set([...fetched.sculptural, ...Object.keys(SCULPTURAL_CLASSES)]);
  const fountain = new Set(fetched.fountain);
  const artwork = new Set([...sculptural, ...fountain, ...Object.keys(PUBLIC_CLOCK_CLASSES), ...Object.keys(COMMEMORATIVE_FORMS)]);
  const commemorative = new Set([...fetched.commemorative, ...Object.keys(MEMORIAL_CLASSES)]);
  const admitting = new Set([...artwork, ...commemorative, ...Object.keys(HERITAGE_SENSE_CLASSES)]);
  const worship = new Set([...fetched.worship, ...Object.keys(WORSHIP_CLASSES)]);
  for (const designation of Object.keys(WORSHIP_DESIGNATIONS)) worship.delete(designation);
  return {
    sculptural,
    fountain,
    artwork,
    commemorative,
    admitting,
    museum: new Set(fetched.museum),
    worship,
    lost: new Set([...fetched.lost, ...Object.keys(LOST_CLASSES)]),
  };
}
