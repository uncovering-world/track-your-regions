/**
 * ADR-0175 decision 5: every number the six place kinds admit by — Places of
 * worship, Squares & streets, Monuments & memorials, Public art, Towers, and
 * Bridges & engineering marvels — lives here, with how it was derived, the
 * evidence and the date. The runs read it (`worldBars.ts`, `regionalCut.ts`)
 * and so does the coverage report (`report.ts`); no kind module states a line
 * of its own.
 *
 * A parameter changes only by the method of decision 5, which
 * `docs/tech/filling-a-kind.md` § 11 spells out: the frozen metrics on the
 * development regions, the frontier, a point chosen by a rule the maintainer
 * states, and one read of a control group no tuning has read. Moving a value
 * here without that is moving a picked line back in.
 */

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
  stayShare: derived(0.8,
    'A place the last run admitted stays while it reaches 0.8 of any bar: the churn between the two half-years of one readership year falls from 12.3 % to 8.9 %.',
    'Results, Checks at the point'),
} as const;

/**
 * The regional tier (ADR-0175 decision 3, ADR-0171's cut). Declared here with
 * the world's; the slice that switches the tier on (#2252) reads the parameters
 * the cut does not read yet — the readers test, the readers' floor, the guided
 * types and the stay — and `REGIONAL_CUT.enabled` stays off until then.
 */
export const REGIONAL_REGISTER = {
  neighbours: derived('all' as const,
    "A place is measured against every place of the live kinds within the radius, museums included, as ADR-0171's measurement counted them.",
    'Results, The point'),
  radiusKm: {
    value: 50,
    derivation: 'ADR-0171 decision 1: what lies within 50 km of a place, unchanged by the review.',
    evidence: 'docs/decisions/0171-a-global-sources-regional-tier-measures-a-place-against-what-lies-within-50-km.md',
    date: '2026-10-31',
  } satisfies Parameter<number>,
  best: derived(10,
    'The reference is the median of the ten best within the radius; skipping the first ranks moved nothing worth its load.',
    'Results, The point'),
  minLanguages: derived(2,
    'A regional place has a Wikipedia article in two languages or more, as ADR-0171 asked.',
    'Results, The point'),
  minReaders: derived(3_000,
    'At least 3,000 readers a year: a floor of 10,000 costs 1,100 places for 0.2 points of noise, and a floor of 1,000 doubles the noise.',
    'Results, The point'),
  guideShare: derived(0.5,
    'The Wikivoyage test passes at half the reference, in an area of five places or more (ADR-0171 said a quarter).',
    'Results, The point'),
  guideGroupFloor: derived(5,
    'The Wikivoyage minimum moved nothing in the screening and is fixed at ADR-0171\'s five places.',
    'Method, The search'),
  editionsShare: derived(1,
    'The editions test passes at the reference: the editions reference moved nothing in the screening and is fixed.',
    'Method, The search'),
  editionsGroupFloor: derived(25,
    'The editions test reads an area of 25 places or more, as ADR-0171 did.',
    'Results, The point'),
  readersShare: derived(1,
    'The readers test, new, passes at the reference, in an area of 25 places or more.',
    'Results, The point'),
  readersGroupFloor: derived(25,
    'The readers test reads an area of 25 places or more, as the editions test does.',
    'Results, The point'),
  guideForTypes: derived(['tunnel', 'dam', 'lock'] as readonly string[],
    'A tunnel, a dam or a lock enters the regional tier only when a Wikivoyage edition uses it, and stays only while one still does: 370 places out, noise 9.1 % to 6.5 %, recall and canon unmoved.',
    'Results, The noise is in the regional tier of two kinds'),
  stayReadersShare: derived(0.8,
    'A regional place stays while it keeps two editions, reaches 0.8 of the readers\' floor (2,400 a year) and passes one test, the readers test read at 0.8 and the others whole.',
    'Results, Checks at the point'),
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

/** The coverage slugs of the six kinds the frame admits by. */
export type FrameKindSlug =
  | 'places-of-worship' | 'squares-and-streets' | 'monuments-and-memorials'
  | 'public-art' | 'towers' | 'bridges-and-engineering';

/**
 * Each kind's bars as the review read them on its pool (the readership year to
 * 2026-09, the dump of 2026-10-19): the evidence of the levels above, never a
 * line a run admits by — a run computes its own bars from its own pool. The
 * coverage report reads the editions bar, since a survey entry carries
 * editions and no readers (`report.ts`).
 */
export const MEASURED_BARS: Parameter<Readonly<Record<FrameKindSlug, { editions: number; readers: number; guidedReaders: number }>>> = {
  value: {
    towers: { editions: 19, readers: 64_996, guidedReaders: 12_838 },
    'bridges-and-engineering': { editions: 17, readers: 56_955, guidedReaders: 13_757 },
    'squares-and-streets': { editions: 15, readers: 44_480, guidedReaders: 10_963 },
    'places-of-worship': { editions: 16, readers: 49_634, guidedReaders: 10_577 },
    'public-art': { editions: 17, readers: 93_029, guidedReaders: 20_871 },
    'monuments-and-memorials': { editions: 18, readers: 85_409, guidedReaders: 16_719 },
  },
  derivation: "The three quantiles above read on each kind's pool in the review's extract.",
  evidence: 'docs/decisions/0175-a-place-kind-admits-by-quantiles-of-its-own-pool.md, decision 1',
  date: DERIVED,
};
