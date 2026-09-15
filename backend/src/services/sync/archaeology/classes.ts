/**
 * Which Wikidata classes and which English Wikipedia categories make a museum
 * an archaeology museum, and which classes make an object inside one a find.
 *
 * The shape of `worship/classes.ts`, and for the same reasons: the lists are
 * *classes* and *categories*, not entities — a rule about kinds of thing,
 * which a curator's verdict can extend without a deploy — and every QID below
 * carries the label Wikidata gave it, verified with `wbgetentities` on
 * 2026-09-13. The rows each list was read off are named in its comment, and
 * the counts behind them were measured the same day through QLever and written
 * up in `docs/sources/global/wikidata-archaeology.md`.
 *
 * This module holds the lists and nothing else — no queries, no rules. What is
 * asked of Wikidata with them, and what the answers decide, are their own
 * modules, so that the question "which classes does this kind read?" has one
 * place to be answered and the reasons live beside the answer.
 *
 * **The site door's lists live in `siteClasses.ts`** and are re-exported below
 * (#581 PR 2). The two doors share nothing but the kind they fill, and the file
 * had grown past the length anybody reads at once; the re-export is so that the
 * split costs a caller nothing — one module still answers "which classes does
 * this kind read?" — while the reasons for a ruin tag and the reasons for a
 * museum category stop sitting in one scroll.
 */

import {
  SETTLEMENT_ROOT,
  SHIPWRECK_ROOT,
  SITE_ROOT,
  ARCHAEOLOGICAL_PARK,
  FORTIFICATION_ROOT,
  PALACE_ROOT,
  WORSHIP_STRUCTURE_ROOT,
} from './siteClasses.js';

export {
  ARCHAEOLOGICAL_PARK,
  SITE_ROOT,
  SETTLEMENT_ROOT,
  SHIPWRECK_ROOT,
  FORTIFICATION_ROOT,
  PALACE_ROOT,
  WORSHIP_STRUCTURE_ROOT,
  DESTROYED_CLASS,
  OSM_DIG_HISTORIC,
  OSM_RUINS_HISTORIC,
  OSM_DIG_KEY,
  OSM_RUINS_KEY,
  OSM_DIG_TAGS,
  OSM_ONLY_NOT_A_PLACE,
  RUINS_ONLY_MONUMENT_CLASSES,
  SITE_CATEGORY,
  WORLD_HERITAGE_DESIGNATION,
  RUIN_HISTORIC,
  RUIN_KEYS,
  RUIN_MAN_MADE,
  PROTECTED_BOUNDARY,
  CENSUS_BOUNDARY,
  LIVING_PLACE,
  SITE_CLASSES,
  SITE_KILL_CLASSES,
  SITE_KILL_UNLESS_SITE,
  SITE_KILL_NATURAL,
  SITE_KILL_BY_NAME,
  OSM_KEEP_WKT,
} from './siteClasses.js';

/**
 * What a reader filters an archaeology place by (ADR-0058 decision 1).
 *
 * One kind with two types, because a traveller into archaeology wants Pompeii
 * and the Naples museum in one list. Both words were spelled here from the
 * first slice, which filled only `museum`, so that the writers already knew
 * about the type the site door would bring (#581 PR 2 built that door).
 */
export type ArchaeologyType = 'site' | 'museum';

/**
 * The roots of the museum door: walked as trees by `fetchArchaeologyTrees`.
 *
 * The class is one of two signals and never the whole door. It is right about
 * the Louvre, which Wikidata types `art museum, national museum,
 * archaeological museum` (169 sitelinks) — a museum can be two kinds at once,
 * and what Art Museums makes of the same row is not this kind's business. It
 * is silent about the canon, though: the British Museum is `art museum,
 * national museum` (109) with no archaeological class at all, the Pergamon
 * Museum `art museum, museum` (61), the Neues Museum `museum, museum building`
 * (47), the National Museum of Iraq `national museum` (36), the Bardo `museum`
 * (35), the Museo del Oro `museum` (28). That silence is why `NATURE_CATEGORY`
 * is read beside the tree rather than after it.
 *
 * `egyptological museum` is a subclass of `archaeological museum` (checked on
 * 2026-09-13), so the second root adds no branch the first does not reach. It
 * is named anyway, as the floor under a closure that stops short: a row typed
 * only egyptological must not be missed because a hop was not walked.
 */
export const MUSEUM_ROOTS: Record<string, string> = {
  Q3329412: 'archaeological museum',
  Q3330834: 'egyptological museum',
};

/**
 * Natural history: a veto, walked as a tree.
 *
 * A natural history museum is not an archaeology museum, whatever one find it
 * holds — the product decision of 2026-09-13, written into ADR-0058 decision
 * 2. The row it was taken from is the Naturhistorisches Museum Wien, which
 * holds the Venus of Willendorf and would otherwise arrive through the find
 * door; the Musée de l'Homme (the Venus of Lespugue) and the National Museum
 * of Ethiopia (Lucy) are the same shape. Those finds reach no kind until a
 * natural-history kind exists, which the source record says out loud rather
 * than leaving it to be discovered.
 *
 * Walked as a tree, not matched as one class: the national natural-history
 * museums are filed under it, and a veto that only refuses the generic word
 * refuses nothing.
 */
export const NATURAL_HISTORY_ROOT = 'Q1970365';

/**
 * The classes of a find asked whole beside the artefact tree.
 *
 * The nine ADR-0058 decision 3 names, read off the pool of finds measured at
 * 15 sitelinks or more: inscription 12 rows, Venus figurine 9, hoard 8,
 * figurine 5, stele 5, sarcophagus 4, papyrus 4, death mask 2, viking ship 2.
 * Each is narrow enough to ask whole in one question. Seven of the nine sit
 * outside the artefact tree, which is the point of asking for them at all;
 * `hoard` and `sarcophagus` are inside it (checked 2026-09-13) and are named
 * anyway, as the floor under a closure that stops short — the same reason the
 * egyptological root is spelled out above.
 *
 * The label doubles as the treasure type a reader sees on the card, as it does
 * for the art museums' roots (`MUSEUM_BROAD_ROOTS` in
 * `museum/worksCollector.ts`): the Oseberg ship reads as a viking ship, which
 * is the only one of the nine it matches. A row can match more than one, and
 * then the word is the rule module's to choose, not this list's — the Rosetta
 * Stone is typed `stele` and `bilingual inscription`, which is a subclass of
 * `inscription` (both checked 2026-09-13), so the list says which classes
 * count and the rule says which word the card carries.
 *
 * `papyrus` here is Wikidata's "manuscript written on papyrus", a subclass of
 * `manuscript` (checked 2026-09-13) — the narrow word, not the wide one. The
 * generic `manuscript` (7 rows in the same pool) is not a find class: at the
 * lower lines it is what brings in the libraries, the Chester Beatty and the
 * Austrian National Library among them.
 */
export const FIND_CLASSES: Record<string, string> = {
  Q1640824: 'inscription',
  Q178743: 'stele',
  Q1066288: 'figurine',
  Q248726: 'Venus figurine',
  Q40555: 'death mask',
  Q48634: 'sarcophagus',
  Q164099: 'hoard',
  Q12043767: 'papyrus',
  Q211969: 'viking ship',
};

/**
 * What was dug up, as Wikidata itself says it: walked as a tree.
 *
 * The first and widest of the four ways into a find (ADR-0058 decision 3),
 * and it covers about half of the pool on its own — 33 of the finds measured
 * at 15 sitelinks or more carry `archaeological artefact` directly. The other
 * half is the ancient sculpture the art pool already reads, plus the find
 * classes above.
 */
export const ARTEFACT_ROOT = 'Q220659';

/**
 * The art-pool roots whose ancient members are finds: walked in fame bands.
 *
 * Sculpture and statue are the two largest classes in the whole find pool —
 * 47 and 21 rows at 15 sitelinks or more, against 33 for the artefact tree —
 * and they are what makes Naples and the Vatican worth an archaeology
 * traveller's day: the Doryphoros and the Laocoön among them. They are
 * also the art museums' own broad roots, so the shape `{ qid, type }` is
 * theirs too (`MUSEUM_BROAD_ROOTS` in `museum/worksCollector.ts`): the type is
 * the word a reader sees, and the roots are asked in fame bands because
 * sculpture holds far more than one question can carry.
 *
 * Membership of these trees is not itself a find. What makes one a find is the
 * cut below, or a discovery place on the item.
 */
export const ANCIENT_ART_ROOTS: { qid: string; type: string }[] = [
  { qid: 'Q860861', type: 'sculpture' },
  { qid: 'Q179700', type: 'statue' },
];

/**
 * The art-pool classes narrow enough to take whole, on the same terms.
 *
 * Three mosaics and three groups of sculptures in the pool at 15 sitelinks or
 * more — the Alexander Mosaic among them — which is a count no band is needed
 * for. `MUSEUM_WHOLE_ROOTS` takes mosaic whole for the art museums' kind for
 * the same reason.
 *
 * `fresco` and `vase` complete the six art-pool classes ADR-0058 decision 3
 * names, and they carry rows no other root reaches: the Bull-leaping fresco at
 * Heraklion and the François Vase in Florence, each the thing a traveller
 * walks into that museum to see. `fresco` is Wikidata's class for the artwork
 * (Q22669139, "artwork produced via the fresco painting technique", the one
 * the worship test reads), not for the technique.
 */
export const ANCIENT_ART_WHOLE: { qid: string; type: string }[] = [
  { qid: 'Q133067', type: 'mosaic' },
  { qid: 'Q2293362', type: 'group of sculptures' },
  { qid: 'Q22669139', type: 'fresco' },
  { qid: 'Q191851', type: 'vase' },
];

/**
 * The date under which a member of the art pool is read as a find.
 *
 * A fourth way in, and never the definition. "Ancient" is not the criterion of
 * a find and the rows say why: the Aztec sun stone is a `sculpture` of 1510
 * with no discovery place on its item, Sutton Hoo is AD 625, the Oseberg ship
 * AD 820, the Benin Bronzes sixteenth-century. A catalogue that asked the date
 * alone would read the Mediterranean as archaeology and the Americas, Africa
 * and the North as not — which is a claim about scholarship, not about what
 * was dug up.
 *
 * So the criterion is *dug up* — the artefact tree, the find classes, a
 * discovery place — and this cut is kept only for the ancient sculpture and
 * mosaics that the art pool already holds and that carry no discovery place of
 * their own.
 */
export const ANCIENT_CUTOFF_YEAR = 500;

/**
 * Not a find whatever else it carries: natural history.
 *
 * The discovery-place door is the loosest of the three, and these are what it
 * lets in. The Hope Diamond and Sue the tyrannosaur both reach the pool
 * through a discovery place, and neither was dug up by an archaeologist; Lucy
 * is an `individual animal`, a meteorite is a rock that fell, a coprolite is
 * fossilised dung. Seven such rows were in the measured pool at 15 sitelinks
 * or more, and every one of them is natural history.
 *
 * Refused whatever else the item carries, in the shape `WORSHIP_KILL_CLASSES`
 * uses: a diamond in a museum case is still a diamond, and the vault it sits
 * in is not an archaeology museum for holding it.
 *
 * **Six of the eight are walked as trees** (#890, `NOT_A_FIND_WALKED`). The
 * pool never met a subclass, because the pool is collected by this kind's
 * own classes; the venue-side read meets whatever a museum's statements name,
 * and the Bendegó meteorite is typed `iron meteorite` (Q827989, a subclass of
 * `meteorite`) with a discovery place in Bahia — kept as a find by the flat
 * list on live run 127, which is a meteorite in an archaeology museum's case
 * described as something somebody dug up. Each walked root is asked by
 * `fetchArchaeologyTrees` and floored with itself in `buildArchaeologyTrees`,
 * as every other tree of this kind is.
 *
 * **`skeleton` and `individual animal` are matched flat and never walked.**
 * Wikidata files `mummy` (Q43616) under both (checked 2026-09-15), and live
 * run 128, which walked all eight, withdrew the Gebelein predynastic mummies
 * from the British Museum and Clonycavan Man from the National Museum of
 * Ireland — the canon of what a traveller enters those rooms to see. Sue is
 * typed `skeleton` and `individual animal` directly, and Lucy `individual
 * animal`, so the flat match is what the veto was measured on.
 */
export const NOT_A_FIND: Record<string, string> = {
  Q40614: 'fossil',
  Q7881: 'skeleton',
  Q26401003: 'individual animal',
  Q7946: 'mineral',
  Q5283: 'diamond',
  Q60186: 'meteorite',
  Q544041: 'coprolite',
  Q83437: 'gemstone',
};

/** The roots of `NOT_A_FIND` whose trees are walked: the objects, never the two Wikidata files a mummy under. */
export const NOT_A_FIND_WALKED: Record<string, string> = Object.fromEntries(
  Object.entries(NOT_A_FIND).filter(([qid]) => qid !== 'Q7881' && qid !== 'Q26401003'),
);

/**
 * The English Wikipedia category that says what a museum is *about*.
 *
 * The editorial signal the class tree does not carry, and the honest one:
 * `Archaeological museums in <place>` sits on every museum the class misses —
 * the British Museum, the Pergamon Museum, the Neues Museum, the National
 * Museum of Iraq, the Bardo, the Museo del Oro — and on the Louvre, the
 * Egyptian Museum, the Museo Nacional de Antropología, the Acropolis Museum,
 * the Ashmolean, the Larco Museum, the Israel Museum, Naples, the Museum of
 * Anatolian Civilizations and Heraklion besides. It is absent from the Uffizi,
 * the Prado, the Deutsches Historisches Museum, the Carnavalet and the
 * Sverdlovsk regional museum — the art and local-history museums that one
 * famous find would otherwise admit (ADR-0058 decision 2: a museum is
 * admitted for what it is, never for one find).
 *
 * The trailing space is deliberate: the category names a place after the
 * preposition, and a bare `Archaeological museums` is a parent category rather
 * than a statement about a museum.
 */
export const NATURE_CATEGORY = /^Archaeological museums (in|of) /;

/**
 * Where the same categories are entered rather than tested: the root of the
 * walk that names candidates (`wikipediaCategoryMembers.ts`).
 *
 * Read only of museums a pool already named, the category can refuse and it
 * cannot admit — and the museums it is right about are precisely the ones no
 * class names. The Bardo is `museum` at 35 sitelinks, the Museo del Oro
 * `museum` at 28, the National Museum of Iraq `national museum` at 36, and none
 * of the three holds a find in the pool the Warka Vase is kept out of by being
 * typed `container`. So the tree is walked from here and its articles join the
 * candidates.
 *
 * Measured on 2026-09-13: this category holds 60 country subcategories and no
 * articles of its own; a country nests regional ones one step further (Greece
 * has 15, `Archaeological museums in Crete` among them) beside siblings that
 * are another kind's (`Byzantine museums in Greece`, `Archaeological
 * collections in Greece`). Which of them the walk follows is `NATURE_CATEGORY`
 * above — the same rule that reads a museum's nature, asked of a category's own
 * title.
 *
 * **What else the editors file here.** The country categories held 776 articles
 * that day, of which 75 are at or above the place line — and **27 of those 75
 * carry no museum class on Wikidata at all**: Pompeii (`archaeological site,
 * ancient city`, 122 sitelinks), Chichén Itzá, Teotihuacan, Masada, Çatalhöyük,
 * Hierapolis, Sforza Castle, Bodrum Castle, the Cathedral of the Annunciation.
 * A category is a shelf and not a class, and the dig is shelved beside the
 * building. So what comes in by this door is asked one thing more —
 * `isMuseumOnWikidata` in `museumTest.ts` — and what fails it is refused rather
 * than pinned as a museum: by name at or above the place line, where those 27
 * are a worklist for the site door (ADR-0058 decision 4), and in silence below
 * it, where the rest of a country's archaeology would bury a curator's real
 * refusals.
 */
export const NATURE_CATEGORY_ROOT = 'Category:Archaeological museums by country';

/**
 * The categories that name an antiquities *department* rather than a museum.
 *
 * The Hermitage carries `Egyptological collections in Russia` and `Museums of
 * ancient Greece in Russia` and nothing that says the museum itself is
 * archaeological, while the British Museum carries `Archaeological museums in
 * London`. The difference is real and it is not a matter of quality: the
 * Hermitage's antiquities are among the world's best, and the museum is still
 * visited as an art museum. The Vatican Museums, the Kunsthistorisches Museum,
 * the Pushkin Museum and the Ny Carlsberg Glyptotek read the same way.
 *
 * The last two name a department the same way, and were read off the same
 * category dumps on 2026-09-13: the Larco Museum carries `Pre-Columbian art
 * museums`, and the Museo Nacional de Antropología and the British Museum
 * carry `Mesoamerican art museums`. All three carry `Archaeological museums
 * in …` besides, which is what admits them — a department word beside the
 * nature category takes nothing away.
 *
 * What a row carrying only one of these deserves is the rule's decision, not
 * this list's — ADR-0058 decision 2 holds it for a curator, with the question
 * "an antiquities department; is the exposition substantially archaeology?" on
 * the card. All this list says is which words name a department.
 */
export const DEPARTMENT_CATEGORIES: RegExp[] = [
  /^Museums of ancient /,
  /^Museums of the ancient Near East/,
  /^Egyptological collections/,
  /^Pre-Columbian art museums/,
  /^Mesoamerican art museums/,
];

export interface ArchaeologyTrees {
  /** Every class that makes a museum an archaeology museum, floored and cleaned. */
  museum: ReadonlySet<string>;
  /** Every class that makes a row a park, and so a site rather than a museum. */
  park: ReadonlySet<string>;
  /** Every class that vetoes one (`NATURAL_HISTORY_ROOT`). */
  naturalHistory: ReadonlySet<string>;
  /** Every class that makes an object something dug up (`ARTEFACT_ROOT`). */
  artefact: ReadonlySet<string>;
  /** Every class that makes an object natural history and no find (`NOT_A_FIND`, walked). */
  notAFind: ReadonlySet<string>;
  /** Every class under `archaeological site`: the site pool's own tree (`SITE_ROOT`). */
  site: ReadonlySet<string>;
  /** Every class under `human settlement`: which branch a candidate came in on. */
  settlement: ReadonlySet<string>;
  /** Every class under `shipwreck`: the one class refused outright. */
  shipwreck: ReadonlySet<string>;
  /**
   * The three trees a `ruins=*` tag alone cannot carry a candidate past
   * (`RUINS_ONLY_VETO_ROOTS` in `siteClasses.ts`, #895): a fortification, a
   * palace, a structure of worship. Read only of a candidate OpenStreetMap
   * named and the site tree did not.
   */
  fortification: ReadonlySet<string>;
  palace: ReadonlySet<string>;
  worship: ReadonlySet<string>;
}

/**
 * Compose the three sets the rules read from what the run fetched and what is
 * pinned here, so that the joining is written once. Pure: the pipeline hands
 * over the closures, this floors them and takes the parks out.
 *
 * Each root is a floor under its own tree, the way `buildWorshipTrees` floors
 * the worship set: a closure that refuses a hop, or a fetch that came back
 * short, must not turn a row typed with the root itself into a row the rule
 * cannot name. What the rule can name, the rule admits.
 *
 * The parks come out of the museum set afterwards and are the one subtraction
 * here: the museum tree reaches them, and a park is a site. **The whole park
 * tree is subtracted, not the one class** — `Fudoki no oka` (Q11665453) is
 * under `archaeological park` and a row carrying only it would otherwise stay
 * a museum — which is why this takes a fourth closure rather than deleting a
 * QID. `ARCHAEOLOGICAL_PARK` floors that closure for the same reason the other
 * three roots floor theirs.
 *
 * The park set is also handed on rather than discarded after the subtraction.
 * Taking the parks out of the museum set closes the class door against them and
 * nothing more, and the museum door has a second signal: a row typed only
 * `Fudoki no oka` whose English article carries `Archaeological museums in
 * Japan` would walk in through the category. The rule that refuses it has to be
 * able to ask whether a class is a park, so the answer is a set it can read.
 *
 * Seven trees now, not four: the site pool's own tree, the settlement branch it
 * is read against, and the one class refused outright (#581 PR 2). The last
 * three are optional, because the museum door reads none of them and a test of
 * it should not have to state them.
 */
export function buildArchaeologyTrees(fetched: {
  museum: string[];
  park: string[];
  naturalHistory: string[];
  artefact: string[];
  /** The six walked natural-history trees (#890); floored with all eight roots below. Optional for the reason the site door's three are. */
  notAFind?: string[];
  site?: string[];
  settlement?: string[];
  shipwreck?: string[];
  /** The OSM-only vetoes' trees (#895), optional for the same reason. */
  fortification?: string[];
  palace?: string[];
  worship?: string[];
}): ArchaeologyTrees {
  const museum = new Set([...fetched.museum, ...Object.keys(MUSEUM_ROOTS)]);
  const park = new Set([...fetched.park, ARCHAEOLOGICAL_PARK]);
  for (const cls of park) museum.delete(cls);
  return {
    museum,
    park,
    naturalHistory: new Set([...fetched.naturalHistory, NATURAL_HISTORY_ROOT]),
    artefact: new Set([...fetched.artefact, ARTEFACT_ROOT]),
    notAFind: new Set([...(fetched.notAFind ?? []), ...Object.keys(NOT_A_FIND)]),
    // Each floored by its own root, for the reason the four above are: a
    // closure that refused a hop, or a fetch that came back short, must not
    // turn a row typed with the root itself into a row the rule cannot name.
    // The three are optional so that a caller judging only museums — every
    // test of the museum door — need not state a site tree it never reads.
    site: new Set([...(fetched.site ?? []), SITE_ROOT]),
    settlement: new Set([...(fetched.settlement ?? []), SETTLEMENT_ROOT]),
    shipwreck: new Set([...(fetched.shipwreck ?? []), SHIPWRECK_ROOT]),
    fortification: new Set([...(fetched.fortification ?? []), FORTIFICATION_ROOT]),
    palace: new Set([...(fetched.palace ?? []), PALACE_ROOT]),
    worship: new Set([...(fetched.worship ?? []), WORSHIP_STRUCTURE_ROOT]),
  };
}
