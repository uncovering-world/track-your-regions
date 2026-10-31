/**
 * The regional tier of a place kind, read from Wikidata by ADR-0171's cut
 * (#2178): what a region holds that a traveller standing there would visit,
 * where no native source is adopted. ADR-0048's second tier — no Iconic
 * badge, through the source's curator gate, the same place as the world
 * tier's where both name it.
 *
 * Cheap before dear: the pass reads one regional pool — every item of every
 * place kind's classes with a point, and each one's surroundings
 * (`regionalPool.ts`) — and the cut runs over it first; only the few it admits
 * are then asked about by id — facts, what holds them, what they depict — and
 * put to the kind's own rule, so a museum's statue or a church's tower is
 * refused there as it is in the pool. A run on the live door reads no regional
 * tier: the radius is a question over the whole pool, which the local subset
 * answers and the query service cannot.
 */

import type { FilteredEntity } from '../syncContract.js';
import type { WikidataLandmark } from '../types.js';
import type { SparqlFn } from '../wikidataQueries.js';
import type { PoolEntity } from '../publicArt/queries.js';
import type { SubjectRunner } from '../publicArt/subjects.js';
import { gatherPlaces, shareOf, type GatheredPlaces, type KindShare, type PlaceKind } from './gather.js';
import { placeLandmark } from './candidates.js';
import { REGIONAL_CUT, regionalVerdict, type RegionalCut } from './regionalCut.js';
import type { RegionalGroup, RegionalPool } from './regionalPool.js';

/**
 * The kind's verdict on a survivor of the cut. Where the kind's rule answers
 * more than a type — Public art's whether an artwork class answered a
 * building's veto, and the makers it read — the answer travels with the
 * verdict, so a regional row carries what a world row of the kind carries and
 * the catalogue checks read the rule's own answer.
 */
export type RegionalRuleVerdict =
  | { pass: true; type: string; artwork?: boolean; creators?: string[] }
  | { pass: false; reason: string };

/** A passing verdict, as a builder reads it. */
export type RegionalPass = Extract<RegionalRuleVerdict, { pass: true }>;

/** How a kind takes part in the regional tier. */
export interface RegionalKind<Trees, Context = undefined> {
  kind: PlaceKind<Trees>;
  /** The classes whose instances are the kind's regional candidates. */
  classesOf(trees: Trees): ReadonlySet<string>;
  /** The kind's types by the classes that name them, for a cut that measures a place among its type's (`neighbours: 'type'`). */
  typesOf?(trees: Trees): ReadonlyMap<string, ReadonlySet<string>>;
  /** What the kind's rule needs beside the share, read once per run (what other kinds offer, say). */
  context?(): Promise<Context>;
  /** The kind's own verdict on a survivor of the cut, read off what the gather asked about it by id. */
  verdict(entity: PoolEntity, share: KindShare<Trees>, context: Context): RegionalRuleVerdict;
  logPrefix: string;
}

export interface RegionalArrivals<T = WikidataLandmark> {
  items: T[];
  filtered: FilteredEntity[];
  /** Why nothing was read, when nothing was. */
  skipped?: string;
}

/** A row of the kind's own shape from a survivor: the entity, the classes its rule read, the rule's verdict, the cut's note. */
export type RegionalBuilder<T> = (entity: PoolEntity, classes: string[], verdict: RegionalPass, note: string) => T;

/** A landmark of the regional tier, as the place sources write one, with what the kind's rule answered beside its type. */
export const regionalLandmark: RegionalBuilder<WikidataLandmark> = (entity, classes, verdict, note) => ({
  ...placeLandmark(entity, classes, verdict.type as WikidataLandmark['type']),
  ...(verdict.artwork === undefined ? {} : { artwork: verdict.artwork }),
  ...(verdict.creators === undefined ? {} : { creators: verdict.creators }),
  tier: 'regional',
  readershipNote: note,
});

/** The regional tier as a classifier carries it: the kind's part, with its trees read off the pass's gather. */
export interface RegionalReader {
  /** The classes whose instances the kind measures: its share of the pass's pool. */
  classes(gathered: GatheredPlaces): ReadonlySet<string>;
  /** The neighbourhoods the cut reads for this kind (`regionalGroups`). */
  groups(gathered: GatheredPlaces, cut: RegionalCut): RegionalGroup[];
  arrivals(run: SubjectRunner, sparql: SparqlFn, gathered: GatheredPlaces, worldAdmitted: ReadonlySet<string>,
    pool: RegionalPool | null, held: ReadonlySet<string>): Promise<RegionalArrivals>;
}

export function regionalReader<Trees, Context = undefined>(regional: RegionalKind<Trees, Context>, cut: RegionalCut = REGIONAL_CUT): RegionalReader {
  return {
    classes: (gathered) => regional.classesOf(shareOf(gathered, regional.kind).trees),
    groups: (gathered, cut) => regionalGroups(regional, shareOf(gathered, regional.kind).trees, cut),
    arrivals: (run, sparql, gathered, worldAdmitted, pool, held) =>
      regionalArrivals(run, sparql, regional, shareOf(gathered, regional.kind).trees, worldAdmitted, regionalLandmark, pool, held, cut),
  };
}

const none = <T>(): RegionalArrivals<T> => ({ items: [], filtered: [] });

/**
 * The world tier's decision and the regional tier's, as one run's: every
 * admitted row once, and no row both admitted and refused. A row the world
 * classifier refused that the regional tier admits is admitted (its refusal
 * dropped), and a refusal both tiers name is listed once — the world's, which
 * a candidate in the pool already carries — so the run never refuses and
 * readmits the same place in one pass.
 */
export function mergeRegional<T>(
  items: T[], filtered: FilteredEntity[], regional: RegionalArrivals<T>, idOf: (item: T) => string,
): void {
  const admitted = new Set(regional.items.map(idOf));
  const kept = filtered.filter((entity) => !admitted.has(entity.externalId));
  const refused = new Set(kept.map((entity) => entity.externalId));
  filtered.splice(0, filtered.length, ...kept, ...regional.filtered.filter((entity) => !refused.has(entity.externalId)));
  items.push(...regional.items);
}

/** The key of the group a row of `classes` is measured among, under the cut's `neighbours`; null for a row of no type where types decide. */
export function regionalGroupKey<Trees>(
  regional: RegionalKind<Trees, unknown>, trees: Trees, classes: readonly string[], cut: RegionalCut,
): string | null {
  if (cut.neighbours === 'all') return 'all';
  if (cut.neighbours === 'kind') return regional.kind.name;
  for (const [type, set] of regional.typesOf?.(trees) ?? []) {
    if (classes.some((c) => set.has(c))) return `${regional.kind.name}:${type}`;
  }
  return null;
}

/** The neighbourhoods the pool reads for a kind under the cut: the whole pool, the kind's places, or one group per type. */
export function regionalGroups<Trees>(regional: RegionalKind<Trees, unknown>, trees: Trees, cut: RegionalCut): RegionalGroup[] {
  if (cut.neighbours === 'all') return [{ key: 'all', classes: null }];
  if (cut.neighbours === 'kind') return [{ key: regional.kind.name, classes: regional.classesOf(trees) }];
  return [...(regional.typesOf?.(trees) ?? [])].map(([type, classes]) => ({ key: `${regional.kind.name}:${type}`, classes }));
}

/** The candidates of the kind's classes the cut admits, with the notes they clear it by. */
function survivorsOf<Trees>(
  regional: RegionalKind<Trees, unknown>, trees: Trees, worldAdmitted: ReadonlySet<string>, pool: RegionalPool,
  held: ReadonlySet<string>, cut: RegionalCut,
): { survivors: string[]; notes: Map<string, string>; fell: Map<string, string>; candidates: number } {
  const classes = regional.classesOf(trees);
  const survivors: string[] = [];
  const notes = new Map<string, string>();
  const fell = new Map<string, string>();
  let candidates = 0;
  for (const row of pool.rows.values()) {
    if (worldAdmitted.has(row.qid) || !row.classes.some((c) => classes.has(c))) continue;
    const key = regionalGroupKey(regional, trees, row.classes, cut);
    // A row this tier held that has no surroundings any more (under the cut's
    // languages, or of no type where types decide) still meets the cut, so it
    // falls with the cut's reason rather than the sweep's generic one.
    const near = (key === null ? undefined : pool.around.get(key)?.get(row.qid))
      ?? (held.has(row.qid) ? { groupSize: 0, topEditions: [], topGuideEditions: [] } : undefined);
    if (!near) continue;
    candidates += 1;
    const verdict = regionalVerdict({ editions: row.editions, guideEditions: row.guideEditions }, near, cut);
    if (verdict.in) { survivors.push(row.qid); notes.set(row.qid, verdict.note); }
    // A row this tier admitted before that no longer clears the cut falls with
    // the cut's own reason, rather than the sweep's generic one.
    else if (held.has(row.qid)) fell.set(row.qid, verdict.reason);
  }
  return { survivors, notes, fell, candidates };
}

/**
 * The kind's regional arrivals this run: every candidate of the kind's classes
 * the cut admits that the world tier did not (`worldAdmitted`), the kind's
 * rule passed, as rows of the regional tier with the cut's note for the
 * curator. `pool` is the pass's regional pool, or null where the run read the
 * live service and none could be read.
 */
export async function regionalArrivals<Trees, Context, T>(
  run: SubjectRunner,
  sparql: SparqlFn,
  regional: RegionalKind<Trees, Context>,
  trees: Trees,
  worldAdmitted: ReadonlySet<string>,
  build: RegionalBuilder<T>,
  pool: RegionalPool | null,
  held: ReadonlySet<string>,
  cut: RegionalCut = REGIONAL_CUT,
): Promise<RegionalArrivals<T>> {
  const { logPrefix } = regional;
  if (!cut.enabled) {
    const skipped = 'The regional tier is switched off (REGIONAL_CUT.enabled) until the admission review settles its numbers (#2177)';
    console.log(`${logPrefix} ${skipped}`);
    return { ...none<T>(), skipped };
  }
  if (!pool) {
    const skipped = 'The regional tier is read from the local subset alone (ADR-0171); this run read the live service, so none was read';
    console.log(`${logPrefix} ${skipped}`);
    return { ...none<T>(), skipped };
  }
  const { survivors, notes, fell, candidates } = survivorsOf(
    regional as RegionalKind<Trees, unknown>, trees, worldAdmitted, pool, held, cut,
  );
  console.log(`${logPrefix} Regional tier: ${candidates.toLocaleString('en')} candidates of the kind's classes at ${cut.minLanguages}+ editions, `
    + `${survivors.length.toLocaleString('en')} clear the cut within ${cut.radiusKm} km, ${fell.size} it held fell`);
  if (!survivors.length && !fell.size) return none<T>();

  // The survivors asked about by id, with everything the kind's rule reads of a
  // candidate: a kind with no pool question of its own, so the gather reads them alone.
  const byId: PlaceKind<Trees> = { ...regional.kind, poolClasses: () => ({ broad: [], narrow: [] }), belowFloor: undefined, entrance: undefined, editions: undefined };
  run.phase(`Asking about the ${survivors.length} places the regional cut admits...`);
  const gathered = await gatherPlaces(run, [{ kind: byId, admitted: new Set([...survivors, ...fell.keys()]) }]);
  const share = shareOf(gathered, byId);
  const context = (regional.context ? await regional.context() : undefined) as Context;
  const items: T[] = [];
  const filtered: FilteredEntity[] = [];
  for (const qid of survivors) {
    const entity = share.pool.get(qid);
    if (!entity) continue;
    const verdict = regional.verdict(entity, share, context);
    if (!verdict.pass) {
      filtered.push({ externalId: qid, name: entity.label, reason: verdict.reason });
      continue;
    }
    items.push(build(entity, share.facts.get(qid)?.classes ?? [], verdict, notes.get(qid) ?? ''));
  }
  for (const [qid, reason] of fell) {
    filtered.push({ externalId: qid, name: share.pool.get(qid)?.label ?? qid, reason });
  }
  console.log(`${logPrefix} Regional tier: ${items.length} admitted by the kind's rule, ${filtered.length} refused`);
  return { items, filtered };
}
