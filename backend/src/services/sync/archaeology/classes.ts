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
 */

/**
 * What a reader filters an archaeology place by (ADR-0058 decision 1).
 *
 * One kind with two types, because a traveller into archaeology wants Pompeii
 * and the Naples museum in one list. Both words are spelled here from the
 * start, though this slice fills only `museum`: the site door is its own
 * slice, and a type the writers already know about is one nobody has to widen
 * a union for later.
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
 * Under the museum tree, and a site rather than a museum.
 *
 * Wikidata files `archaeological park` under `archaeological museum` as well
 * as under `archaeological site`, so the museum closure reaches it and the
 * survey had to subtract it to count museums at all. An open-air excavation
 * with a ticket office is somewhere you walk around, not a building of
 * display cases, and ADR-0058 decision 2 says plainly that the parks the
 * museum tree reaches are sites. Taken out of the museum set by
 * `buildArchaeologyTrees` so that the subtraction happens once; the site door
 * admits it on its own terms (decision 4).
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
  /** Every class that vetoes one (`NATURAL_HISTORY_ROOT`). */
  naturalHistory: ReadonlySet<string>;
  /** Every class that makes an object something dug up (`ARTEFACT_ROOT`). */
  artefact: ReadonlySet<string>;
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
 */
export function buildArchaeologyTrees(fetched: {
  museum: string[];
  park: string[];
  naturalHistory: string[];
  artefact: string[];
}): ArchaeologyTrees {
  const museum = new Set([...fetched.museum, ...Object.keys(MUSEUM_ROOTS)]);
  for (const park of [...fetched.park, ARCHAEOLOGICAL_PARK]) museum.delete(park);
  return {
    museum,
    naturalHistory: new Set([...fetched.naturalHistory, NATURAL_HISTORY_ROOT]),
    artefact: new Set([...fetched.artefact, ARTEFACT_ROOT]),
  };
}
