/**
 * ADR-0175 decision 5: every number the place kinds admit by — Places of
 * worship, Squares & streets, Monuments & memorials, Public art, Towers,
 * Bridges & engineering marvels, and Archaeology's sites (ADR-0179) — lives
 * here, with how it was derived, the evidence and the date. The runs read it
 * (`worldBars.ts`, `surroundingsCut.ts`, `archaeology/surroundingsSites.ts`); no
 * kind module states a line of its own. It holds the frame's parameters and no
 * value per kind (#2321): a kind's bars are what its run reads off its own pool,
 * kept on the run's sync log, and the coverage report reads them from there.
 *
 * A parameter changes only by the method of decision 5, which
 * `docs/tech/filling-a-kind.md` § 11 spells out: the frozen metrics on the
 * development regions, the frontier, a point chosen by a rule the maintainer
 * states, and one read of a control group no tuning has read. Moving a value
 * here without that is moving a picked line back in.
 */

import type { PlaceTypeOf } from '@tyr/shared/placeTypes';

/** One parameter of the frame: its value, and what a person reads before moving it. */
export interface Parameter<T> {
  value: T;
  /** How the value was derived, in one sentence. */
  derivation: string;
  /** Where the evidence is: the report and its section. */
  evidence: string;
  /** The day the value was derived. */
  date: string;
}

const REPORT = 'docs/research/2026-11-02-one-admission-frame-for-the-place-kinds.md';
const DERIVED = '2026-11-02';

const derived = <T>(value: T, derivation: string, section: string): Parameter<T> => ({
  value, derivation, evidence: `${REPORT} § ${section}`, date: DERIVED,
});

const NEIGHBOURHOOD_REPORT = 'docs/research/2026-11-02-a-surroundings-neighbourhood-that-follows-density.md';

const TWO_YEAR_REPORT = 'docs/research/2026-11-02-the-admission-frame-over-two-readership-years.md';

/** A value the two-year reading of #2177 confirmed, at ADR-0175's point. */
const heldOverTwoYears = <T>(value: T, derivation: string, section: string): Parameter<T> => ({
  value, derivation, evidence: `${TWO_YEAR_REPORT} § ${section}`, date: DERIVED,
});

const BRIDGES_REPORT = 'docs/research/2026-11-03-a-guide-for-a-bridge-in-the-surroundings-tier.md';

/** A value the bridges measurement of #2324 moved, on the 2177 harness at the live point (ADR-0181). */
const bridgesMeasured = <T>(value: T, derivation: string, section: string): Parameter<T> => ({
  value, derivation, evidence: `${BRIDGES_REPORT} § ${section}`, date: '2026-11-03',
});

const RANK_RECORD = 'docs/decisions/0184-a-readers-floor-is-the-readers-of-a-fixed-rank-among-the-years-items.md';

/** A readers' floor restated as a rank of the year's items (ADR-0184): the rank, and the count it yielded on the year it was derived on. */
export interface ReadersRank { rank: number; yieldedThen: number }

/** A value ADR-0184 restated as a rank, derived on the readership year to September 2026. */
const rankedOnTheYear = (value: ReadersRank, derivation: string): Parameter<ReadersRank> => ({
  value, derivation, evidence: `${RANK_RECORD} § Measurement`, date: '2026-11-08',
});

/** A value the neighbourhood measurement of #2297 moved (ADR-0181). */
const remeasured = <T>(value: T, derivation: string, section: string): Parameter<T> => ({
  value, derivation, evidence: `${NEIGHBOURHOOD_REPORT} § ${section}`, date: DERIVED,
});

/**
 * The world tier (ADR-0175 decisions 1, 2 and 4): three bars, each a quantile
 * of the kind's own pool, recomputed from that pool at every run, and the
 * share of them a place the last run admitted stays at.
 */
export const WORLD_REGISTER = {
  poolSitelinks: derived(3,
    "The pool is every item of the kind's classes with a point and at least three sitelinks of any Wikimedia site, whatever its Wikipedia editions, that the kind's rule passes: the floor the review's extract read the candidates at, so the quantiles below are the review's (ADR-0176).",
    'Method, Data'),
  editionsQuantile: derived(0.97,
    "The point the maintainer's rule chose from the frontier: canon at 85 % or more, judged noise at 7 % or less, and of those the fewest places.",
    'Results, The point'),
  readersQuantile: derived(0.98,
    'Fixed by the screening, where the readers quantile moved neither recall, load nor noise.',
    'Method, The search'),
  guidedQuantile: derived(0.9,
    "The point the maintainer's rule chose from the frontier, the third bar standing for the superseded guide doors of ADR-0167, ADR-0168 and ADR-0169.",
    'Results, The point'),
  guideEditions: derived(1,
    'A guide marks a place when at least one Wikivoyage edition uses its item: the Wikivoyage minimum moved nothing in the screening and is fixed.',
    'Method, The search'),
  atlasObscura: derived(true,
    'An Atlas Obscura place ID (P7772) marks a place as a guide does: 147 more places (Florence\'s Porcellino, Munich\'s Glockenspiel), canon 0.850 to 0.852, noise unchanged, the control figure unchanged.',
    'Results, The point'),
  stayShare: heldOverTwoYears(0.8,
    'A place the last run admitted stays while it reaches 0.8 of any bar: between the readership years ending 2025-09 and 2026-09 the share of the set that changes falls from 10.6 % to 5.6 %, where between the two half-years of one year it fell from 12.3 % to 8.9 %.',
    'Results, Churn by form'),
} as const;

/**
 * The surroundings tier (ADR-0175 decisions 2 and 3, ADR-0171's cut, its
 * neighbourhood and shares narrowed by ADR-0181), read by `SURROUNDINGS_CUT`
 * in `surroundingsCut.ts`: the neighbourhood and its reference, the three
 * tests and their group floors, the languages and readers' floor, the types
 * that need a guide, and the share a held place stays at.
 */
export const SURROUNDINGS_REGISTER = {
  neighbours: derived('all' as const,
    "A place is measured against every place of the live kinds within the radius, museums included, as ADR-0171's measurement counted them.",
    'Results, The point'),
  radiusKm: remeasured(150,
    'A place is measured against what lies within 150 km of it, among the places of its own density: at the shares below, 150 km shows 12,653 places and 299 of the 451 demanded, where 100 km shows 13,432 and 300.',
    'The point'),
  densityNeighbours: remeasured(20,
    "A place's density is its distance to the 20th-nearest place of the pool: the 50th shows 12,601 places, two demanded fewer and canon 0.856 against 0.860.",
    'Neighbourhoods that follow density'),
  densityRatio: remeasured(4,
    "A neighbour counts while its density is within a factor of 4 of the candidate's, either way: a factor of 2 shows 779 more places (13,432) for two more demanded.",
    'Neighbourhoods that follow density'),
  best: derived(10,
    'The reference is the median of the ten best within the radius; skipping the first ranks moved nothing worth its load.',
    'Results, The point'),
  minLanguages: derived(2,
    'A surroundings-tier place has a Wikipedia article in two languages or more, as ADR-0171 asked.',
    'Results, The point'),
  minReaders: rankedOnTheYear({ rank: 889_568, yieldedThen: 3_000 },
    'At least the readers of the 889,568th most read item of the year, 3,000 on the year to September 2026 (a floor of 10,000 '
    + 'cost 1,100 places for 0.2 points of noise, and one of 1,000 doubled the noise, #2177): a rank follows the level of '
    + 'readership, where a count admitted 5.3 % fewer items a year later and the rank the same number.'),
  guideShare: remeasured(0.25,
    'The Wikivoyage test passes at a quarter of the reference, in an area of five places or more: half shows 10,551 places and 279 demanded against 12,653 and 299, and per kind the share moves demand by 2 to 16 places where the neighbourhood moves it by 0 to 3.',
    'Per kind'),
  guideGroupFloor: derived(5,
    'The Wikivoyage minimum moved nothing in the screening and is fixed at ADR-0171\'s five places.',
    'Method, The search'),
  editionsShare: derived(1,
    'The editions test passes at the reference: the editions reference moved nothing in the screening and is fixed.',
    'Method, The search'),
  editionsGroupFloor: derived(25,
    'The editions test reads an area of 25 places or more, as ADR-0171 did.',
    'Results, The point'),
  readersShare: remeasured(1.5,
    'The readers test passes at one and a half times the reference, in an area of 25 places or more: at the reference itself it shows 233 more places (12,886) for no more demanded and the same canon.',
    'The point'),
  readersGroupFloor: derived(25,
    'The readers test reads an area of 25 places or more, as the editions test does.',
    'Results, The point'),
  guideForTypes: bridgesMeasured<readonly PlaceTypeOf<'bridges-and-engineering'>[]>(['tunnel', 'dam', 'lock', 'bridge'],
    'A tunnel, a dam, a lock (#2177: 370 places out, noise 9.1 % to 6.5 %) and a bridge (#2324) enter the surroundings tier only when a Wikivoyage edition uses them, and stay only while one still does: with the bridge, 146 shown places out, judged noise 6.67 % to 5.00 %, demand and canon unmoved.',
    'The measurement'),
  heritageForTypes: bridgesMeasured<readonly PlaceTypeOf<'bridges-and-engineering'>[]>(['bridge'],
    'A bridge with a heritage designation (P1435) that still holds counts as one a guide uses: it keeps 20 sights no list names, the Anping, Luding and Kawarau Gorge bridges among them, at the same noise (the maintainer\'s choice, 2026-11-03).',
    'The heritage exception'),
  stayReadersShare: derived(0.8,
    'A surroundings-tier place stays while it keeps two editions, reaches 0.8 of the readers\' floor (2,400 a year on the year it was derived on) and passes one test, the readers test read at 0.8 and the others whole.',
    'Results, Checks at the point'),
  stayEditionsShare: {
    value: 0.8,
    derivation: 'A surroundings-tier place stays while its editions reach 0.8 of the reference, as its readers do: a pool that gains a class moves the reference of every place near the class\'s items with nothing changed about the place (#2380 dropped Wat Wang Wiwekaram, 5 editions against 5.5, when Mueang Sing joined its neighbours at 149 km).',
    evidence: 'docs/decisions/0187-a-held-surroundings-tier-place-stays-at-0-8-of-its-editions-reference.md § Measurement',
    date: '2026-11-08',
  } satisfies Parameter<number>,
} as const;

const ARCHAEOLOGY_REPORT = 'docs/research/2026-11-02-archaeologys-sites-in-the-admission-frame.md';

const NAMED_RUIN_RECORD = 'docs/decisions/0188-a-ruin-mapped-near-a-site-under-its-name-shows-the-site.md';

const WORLD_HERITAGE_DOORS_RECORD = 'docs/decisions/0185-archaeology-reads-a-world-heritage-listing-as-a-mark-and-as-the-map.md';

/**
 * Archaeology's conditions on its surroundings tier, read on the kind's
 * survivors of the cut after its rule (`archaeology/surroundingsSites.ts`): the
 * map shows the place and a part of a held place is not one of its own
 * (ADR-0179), and a World Heritage listing stands in for the map (ADR-0185).
 * The bare frame's surroundings tier brought 10.2 % noise to Archaeology, nearly
 * all of it finds spots with nothing to see, places gone or under water, and
 * parts of a site the kind already holds. ADR-0179's hold for the surroundings
 * tier alone: on the world tier the map would cost Palenque and Calakmul, the
 * parts Giza, Karnak and Stonehenge.
 */
export const ARCHAEOLOGY_SURROUNDINGS_REGISTER = {
  mapped: {
    value: true,
    derivation: 'A surroundings-tier site needs an OpenStreetMap object carrying its item that the site rule reads as the place: a ruin or a dig, or the village the rule lifts a dig over. With the next, the noise among the additions falls from 10.2 % to 3.5 %, the canon stays at 0.876, and the control regions show 4 places against 3 today.',
    evidence: `${ARCHAEOLOGY_REPORT} § The point`,
    date: DERIVED,
  } satisfies Parameter<boolean>,
  partsOfHeld: {
    value: true,
    derivation: 'A surroundings-tier site that is part (P361) of a place Archaeology holds or admits in the same run is not a place of its own: the Forum of Pompeii is Pompeii, the Temple of Olympian Zeus at Agrigento is the Valley of the Temples.',
    evidence: `${ARCHAEOLOGY_REPORT} § The point`,
    date: DERIVED,
  } satisfies Parameter<boolean>,
  namedRuinWithinMetres: {
    value: 2_000,
    derivation: 'A site no OpenStreetMap object carries the item of is one the map shows where a ruin or dig it maps within 2 km is named with a whole word of the item\'s labels that no site\'s name carries by its kind: on a sample of 80 of the 674 places ADR-0179\'s map condition refused on 2026-11-08, it shows 16 of the 38 ruins a traveller visits (Abellinum, Candi Muara Takus, Necropoli Li Muri) and none of the 24 refused rightly; an unnamed ruin nearby showed 5 of those.',
    evidence: `${NAMED_RUIN_RECORD} § Measurement`,
    date: '2026-11-08',
  } satisfies Parameter<number>,
  listedStandsForTheMap: {
    value: true,
    derivation: 'A site the World Heritage List inscribes (P757, or P1435 naming it) is one the map shows for this tier, whatever OpenStreetMap tags carry its item, unless a place Archaeology holds or admits is part of it, or it is an archaeology museum, an old town or a part of a place the kind holds (ADR-0185 decision 3): of the 28 inscribed sites under the tree Archaeology missed on 2026-11-04, this lets in the Moidams of Charaideo, the Early Christian Necropolis of Pécs, SGang Gwaay, Sabratha and Red Bay, and keeps out Mérida, whose theatre and circus Archaeology holds.',
    evidence: `${WORLD_HERITAGE_DOORS_RECORD} § Measurement`,
    date: '2026-11-08',
  } satisfies Parameter<boolean>,
} as const;

/**
 * ADR-0185: Archaeology's world tier reads a World Heritage listing as a
 * guide's mark, the readers' bar of a marked place applying, as it reads a
 * Wikivoyage guide's use and an Atlas Obscura entry.
 */
export const ARCHAEOLOGY_WORLD_REGISTER = {
  listedIsAMark: {
    value: true,
    derivation: 'A site the World Heritage List inscribes is marked as one a guide uses, unless it is an archaeology museum, an old town or a part of a place the kind holds (ADR-0185 decision 3): on 2026-11-04 it lets in Qaryat al-Faw, Liangzhu and Tyre, which no other door reached, with two duplicates of places held and no other noise.',
    evidence: `${WORLD_HERITAGE_DOORS_RECORD} § Measurement`,
    date: '2026-11-08',
  } satisfies Parameter<boolean>,
} as const;

/** The world frame's values, as a run reads them. */
export interface WorldFrame {
  poolSitelinks: number;
  editionsQuantile: number;
  readersQuantile: number;
  guidedQuantile: number;
  guideEditions: number;
  atlasObscura: boolean;
  stayShare: number;
}

export const WORLD_FRAME: WorldFrame = {
  poolSitelinks: WORLD_REGISTER.poolSitelinks.value,
  editionsQuantile: WORLD_REGISTER.editionsQuantile.value,
  readersQuantile: WORLD_REGISTER.readersQuantile.value,
  guidedQuantile: WORLD_REGISTER.guidedQuantile.value,
  guideEditions: WORLD_REGISTER.guideEditions.value,
  atlasObscura: WORLD_REGISTER.atlasObscura.value,
  stayShare: WORLD_REGISTER.stayShare.value,
};
