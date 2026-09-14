/**
 * Whether a museum belongs to the Archaeology kind, and where it stands against
 * the fame line: the rule ADR-0058 decision 2 states, and nothing else.
 *
 * A museum is admitted **for what it is, never for one find**. That is the
 * whole of the decision, and it is a product judgement before it is a query: a
 * person who collects archaeology museums and is sent to the Uffizi for the
 * Venus de' Medici has been misled, and so has one sent to the Sverdlovsk
 * regional museum for the Shigir Idol. So the door asks what the museum is
 * about — the English Wikipedia category `Archaeological museums in …`, or a
 * Wikidata class under `archaeological museum` — and a find only ever moves a
 * museum that already passed that door across the line.
 *
 * Two signals rather than one because neither is whole on its own. The class
 * misses the canon (the British Museum is `art museum, national museum`, the
 * Pergamon `art museum, museum`, the Bardo just `museum`); the category is
 * editorial and sits on rows Wikidata never typed. Read together they name
 * every museum the survey of 2026-09-13 expected, and one it did not: Museum
 * Ulm carries `Archaeological museums in Germany` beside `History museums in
 * Germany` and so passes this door, though the survey filed it among the city
 * museums that one famous find (the Lion man) would wrongly admit. The counts
 * are in `docs/sources/global/wikidata-archaeology.md`.
 *
 * The category is also a *door* and not only a test (`NATURE_CATEGORY_ROOT`),
 * and what walks in through it is asked one thing more: whether Wikidata calls
 * the place a museum at all (`isMuseumOnWikidata`). An editorial shelf holds
 * the dig beside the building, and a museum named by a class or by a find it
 * holds is a museum by the road it came in on.
 *
 * The shape of `worship/worshipTest.ts`, and for the same reason: every fact is
 * handed in, so the rule is pure and can be tried on the catalogue's own
 * mistakes without a network. The rules run in the order a person would give
 * the reason — what the museum *is not* first, then what it is, then whether
 * the world has heard of it.
 */

import {
  DEPARTMENT_CATEGORIES,
  MUSEUM_ROOTS,
  NATURE_CATEGORY,
  type ArchaeologyTrees,
} from './classes.js';
import { belowLineReason, lineStanding, type SourceLine } from '../sourceLine.js';

export interface MuseumFacts {
  qid: string;
  /** Every `P31` the entity carries. */
  classes: string[];
  /** The categories of its English Wikipedia article, as they are spelled there. */
  categories: string[];
  lat: number | null;
  lon: number | null;
}

/**
 * What the museum is about: archaeological by nature, an antiquities department
 * inside a museum of some other nature, or neither — each with the signal it
 * was read off, so the card can say why.
 */
export type MuseumNature =
  | { nature: 'archaeological'; why: string }
  | { nature: 'department'; why: string }
  | { nature: 'none' };

/** A nature, or the one word that refuses the row whatever its nature would be. */
export type MuseumNatureOrVeto = MuseumNature | { veto: string };

/**
 * What the museum is about, or why it is not this kind's at all.
 *
 * A veto is answered ahead of any nature, because it names the thing better
 * than "no archaeological signal" would — the shape `worshipVerdict`'s kill
 * classes use.
 *
 * The natural-history veto is for a natural history museum **with no
 * archaeological signal of its own**, and it is the find door it refuses: a
 * famous find does not make a museum this kind's (ADR-0058 decision 2). The
 * Naturhistorisches Museum Wien is typed `natural history museum`, holds the
 * Venus of Willendorf, and its article carries `Natural history museums in
 * Austria`, `Geology museums in Austria` and nothing archaeological — vetoed,
 * and the Venus reaches no kind until a natural-history one exists. The
 * Yorkshire Museum is typed `natural history museum` *and* `archaeological
 * museum`, and its article carries `Archaeological museums in England` and
 * `Museums of ancient Rome in the United Kingdom` beside `Natural history
 * museums in England`; its draw is Roman York. A museum of both is a museum of
 * both and enters — held or not, that is the verdict's question, not this one.
 * So the veto is asked *after* the two signals of the nature have been read and
 * only when neither answered: either signal is enough, because the class misses
 * the canon and the category is where half of it is named.
 *
 * The park veto reads the whole park tree, not the one root class.
 * `buildArchaeologyTrees` already took that tree out of the museum set, which
 * closes the class door against parks and nothing more — the category door is
 * still open. A row typed only `Fudoki no oka` (Q11665453, Japan's word for an
 * archaeological park with a museum on it, filed under `archaeological park`)
 * whose article carries `Archaeological museums in Japan` would otherwise walk
 * in as a museum. An open-air excavation with a ticket office is somewhere you
 * walk around: it is a site, and the site door (decision 4) admits it on its
 * own terms.
 *
 * Then the category before the class, so that the why a person reads is the
 * editorial judgement where there is one. Where there is not, the class names
 * the root's label: a subclass of `archaeological museum` reads as its root,
 * because what a curator checks is that Wikidata files the museum under
 * `archaeological museum` at all, and which subclass it arrived by adds nothing
 * to that.
 *
 * A department category last, and only when nothing above it matched: the Larco
 * Museum carries `Pre-Columbian art museums` *and* `Archaeological museums in
 * Peru`, and a department word beside a nature takes nothing away.
 */
export function museumNature(facts: MuseumFacts, trees: ArchaeologyTrees): MuseumNatureOrVeto {
  // The two signals of the nature, read before either veto is asked. The first
  // matching *category*, not the first matching pattern: the why quotes what
  // Wikipedia says, in the order the article lists it.
  const nature = facts.categories.find((c) => NATURE_CATEGORY.test(c));
  const cls = facts.classes.find((c) => trees.museum.has(c));

  if (!nature && !cls && facts.classes.some((c) => trees.naturalHistory.has(c))) {
    return { veto: 'a natural history museum, not an archaeology museum' };
  }
  // The park veto is asked of every row, signal or no signal: an open-air
  // excavation with a ticket office is somewhere you walk around whatever
  // Wikipedia shelves it under, and the site door admits it on its own terms.
  if (facts.classes.some((c) => trees.park.has(c))) {
    return { veto: 'an archaeological park: a site, not a museum' };
  }

  if (nature) return { nature: 'archaeological', why: `category: ${nature}` };

  if (cls) {
    return { nature: 'archaeological', why: `class: ${MUSEUM_ROOTS[cls] ?? 'archaeological museum'}` };
  }

  const department = facts.categories.find((c) => DEPARTMENT_CATEGORIES.some((re) => re.test(c)));
  if (department) return { nature: 'department', why: `category: ${department}` };

  return { nature: 'none' };
}

/**
 * The sentence a row refused at the category door carries, and what it does
 * *not* claim.
 *
 * It used to end "the site door's", and for a row like Chaco Culture National
 * Historical Park (dry run 121) that was a promise nobody kept: the site door
 * judges what Wikidata files under `archaeological site`, Chaco is not in that
 * tree, and no door had it. So the sentence says what is true — this is not
 * this door's row — and names what the other door's pool actually is, leaving a
 * curator to see for themselves whether it turned up there.
 */
export const NOT_A_MUSEUM = 'no museum class on Wikidata: a site, a castle or a city in '
  + 'Wikipedia\'s category — not this door\'s. The site door judges what Wikidata files '
  + 'under archaeological sites';

/**
 * Whether Wikidata calls this place a museum at all — the one thing a row the
 * English Wikipedia category named has to carry.
 *
 * `Archaeological museums in <country>` is an editorial shelf, not a class, and
 * the editors file the dig beside the building: of the 776 articles under the
 * root's country categories on 2026-09-13, 75 are at or above the place line
 * and **27 of those carry no museum class at all** — Pompeii (`archaeological
 * site, ancient city`, 122 sitelinks), Chichén Itzá, Teotihuacan, Masada,
 * Çatalhöyük, Hierapolis, Sforza Castle, Bodrum Castle, the Cathedral of the
 * Annunciation. Nothing else in this rule refuses them: the park veto reads
 * Wikidata's park tree and Pompeii is in none of it, and the category answers
 * the nature question before the class is ever asked. Admitted, each would be
 * a `museum` pin on an ancient city.
 *
 * So the category door asks Wikidata one question of its own, and it asks it of
 * every museum the walk named rather than only of those nothing else knows. A
 * row another road really did vouch for passes by construction — a pool row is
 * a museum by the class that named it and a holder is a venue the museum import
 * already judged, both classes being under `museum` — so nothing is refused
 * that those roads admitted for good reasons, and there is no road to exempt.
 * Being in the *venue graph* vouches for nothing: it holds every entity a find
 * points at, the dig it was dug out of included, which is the row this gate is
 * really for. Which road a row came by is the pipeline's to know; this is the
 * rule it applies.
 *
 * The set is the museum import's own closure (`fetchMuseumClasses`), the same
 * one its venue rule reads, rather than a second list: what counts as a museum
 * is one question for the catalogue, and a kind with a narrower answer would
 * refuse the Bardo, which is typed nothing but `museum`.
 *
 * What is refused here is not refused from the catalogue — it is the site door's
 * (ADR-0058 decision 4). Whether the refusal is *named* is the caller's
 * question and the line's: the sites at or above the place line are a worklist
 * that door will want, and a country's whole archaeology named row by row is
 * the long tail every `out` in this kind exists to keep out of a curator's
 * list.
 */
export function isMuseumOnWikidata(
  facts: MuseumFacts, museumClasses: ReadonlySet<string>,
): boolean {
  return facts.classes.some((cls) => museumClasses.has(cls));
}

export type MuseumVerdict =
  | { pass: true; held: false; type: 'museum' }
  | { pass: true; held: true; note: string; type: 'museum' }
  | { pass: false; reason: string }
  | { pass: false; out: true };

/**
 * The whole verdict on one museum: in, in and held for a curator, refused by
 * name, or simply out.
 *
 * `out` is not a refusal. A refusal names a rule that ran on the row, and a
 * museum nobody has heard of that the source never admitted had none run on it
 * — reporting it would bury the real refusals under the long tail. That
 * distinction, and the sentence a fallen row is refused with, are
 * `sourceLine.ts`'s `lineStanding` and `belowLineReason`: a curator reading two
 * kinds' refusals should not have to learn two sentences for one fact.
 *
 * `findsForTheDoor` is how many finds this museum holds at or above the *find*
 * line — the second pair on the source row (ADR-0058 decision 5), applied by
 * the caller that counted them, hysteretically, as this door is. It is the
 * door's number and not the badge's: the item the caller builds carries
 * `findsAboveLine`, counted at the enter line alone, and the two are different
 * questions about the same finds, which is why they no longer share a name. One
 * such find carries a museum that passed the nature door below the place line:
 * Delphi at 15 sitelinks for the Charioteer, Olympia at 17 for the Hermes,
 * Heraklion at 21 for the Phaistos disc. It never carries a museum that failed
 * that door, which is the whole point of the decision, and the refusal says how
 * many finds were not enough.
 *
 * The coordinates are never asked here. The venue graph's `venueVerdict`
 * already refused a museum without them, and a rule asked twice is a rule that
 * can answer differently in two places.
 */
export function museumVerdict(input: {
  facts: MuseumFacts;
  sitelinks: number;
  findsForTheDoor: number;
  nature: MuseumNatureOrVeto;
  admitted: ReadonlySet<string>;
  line: SourceLine;
}): MuseumVerdict {
  const { facts, sitelinks, findsForTheDoor, nature, admitted, line } = input;

  if ('veto' in nature) return { pass: false, reason: nature.veto };

  if (nature.nature === 'none') {
    const n = findsForTheDoor;
    const word = n === 1 ? 'find' : 'finds';
    const held = n === 0 ? 'no find above the line' : `${n} famous ${word} held`;
    return { pass: false, reason: `not an archaeology museum by category or class (${held})` };
  }

  // The place line, with a find as the second way over it — the one thing about
  // this door that is not every kind's rule, so it is asked here and the rest
  // is `sourceLine.ts`'s: hysteresis, and the sentence a fallen row is refused
  // with. A find above the finds' own line counts as in before the standing is
  // asked at all.
  if (findsForTheDoor === 0) {
    const stands = lineStanding(sitelinks, admitted.has(facts.qid), line);
    if (stands === 'out') return { pass: false, out: true };
    if (stands === 'fell') return { pass: false, reason: belowLineReason(sitelinks, line) };
  }

  // In, and the one open question goes on the card. The source is gated
  // (ADR-0025), so a held museum is not a museum kept out — it is one whose
  // arrival waits on the only judgement Wikidata cannot make: the Hermitage's
  // antiquities are among the world's best and it is still visited as an art
  // museum, and a person has to say which this is.
  if (nature.nature === 'department') {
    return {
      pass: true,
      held: true,
      type: 'museum',
      note: `an antiquities department (${nature.why}); is the exposition substantially archaeology?`,
    };
  }
  return { pass: true, held: false, type: 'museum' };
}
