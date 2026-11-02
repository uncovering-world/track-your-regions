/**
 * The surroundings tier of a place kind, read from Wikidata by ADR-0171's cut
 * (#2178, ADR-0178): the world tier's sources and analysis applied to what
 * lies within 150 km of a place among the places of its own density
 * (ADR-0181), so what a traveller standing there would visit is measured
 * against its own surroundings rather than the whole world or a dense core
 * next door. No
 * Iconic badge, its arrivals held for a curator where the source's gate is on
 * (the step does not ask the gate itself), the same place as the world tier's
 * where both name it.
 *
 * Cheap before dear: the pass reads one surroundings pool — every item of
 * every place kind's classes with a point, and each one's surroundings
 * (`surroundingsPool.ts`) — and the cut runs over it first; only the few it
 * admits are then asked about by id — facts, what holds them, what they
 * depict — and put to the kind's own rule, so a museum's statue or a church's
 * tower is refused there as it is in the pool. A run on the live door reads no
 * surroundings tier: the radius is a question over the whole pool, which the
 * local subset answers and the query service cannot.
 */

import type { FilteredEntity } from '../syncContract.js';
import type { WikidataLandmark } from '../types.js';
import type { SparqlFn } from '../wikidataQueries.js';
import type { PoolEntity } from '../publicArt/queries.js';
import type { SubjectRunner } from '../publicArt/subjects.js';
import { gatherPlaces, shareOf, type GatheredPlaces, type KindShare, type PlaceKind } from './gather.js';
import { placeLandmark } from './candidates.js';
import { needsAGuide, SURROUNDINGS_CUT, surroundingsVerdict, type SurroundingsCut } from './surroundingsCut.js';
import type { SurroundingsGroup, SurroundingsPool } from './surroundingsPool.js';

/**
 * The kind's verdict on a survivor of the cut. Where the kind's rule answers
 * more than a type — Public art's whether an artwork class answered a
 * building's veto, and the makers it read — the answer travels with the
 * verdict, so a surroundings-tier row carries what a world row of the kind carries and
 * the catalogue checks read the rule's own answer.
 */
export type SurroundingsRuleVerdict =
  | { pass: true; type: string; artwork?: boolean; creators?: string[] }
  | { pass: false; reason: string };

/** A passing verdict, as a builder reads it. */
export type SurroundingsPass = Extract<SurroundingsRuleVerdict, { pass: true }>;

/** How a kind takes part in the surroundings tier. */
export interface SurroundingsKind<Trees, Context = undefined> {
  kind: PlaceKind<Trees>;
  /**
   * The name the kind's neighbourhoods are keyed by, where two sources decide
   * over one gather kind with classes of their own (Public art and Monuments &
   * memorials): without it the pass's two groups would share a key and one
   * would overwrite the other. The gather kind's name when absent.
   */
  group?: string;
  /** The classes whose instances are the kind's surroundings-tier candidates. */
  classesOf(trees: Trees): ReadonlySet<string>;
  /**
   * The type the kind's own rule files a place of `classes` under, for a cut
   * that measures a place among its type's (`neighbours: 'type'`): the rule's
   * answer, with its precedence (a fountain before a sculpture, a clock before
   * either), never a second filing that could disagree with it.
   */
  typeOf?(classes: readonly string[], trees: Trees): string | null;
  /**
   * What the kind's rule needs beside the share, read once per run (what other
   * kinds offer, say), with the survivors of the cut and the share the gather
   * read of them in hand: a kind whose rule reads a source of its own reads it
   * here, of the survivors alone (Archaeology's map, ADR-0179).
   */
  context?(survivors: readonly PoolEntity[], share: KindShare<Trees>): Promise<Context>;
  /** The kind's own verdict on a survivor of the cut, read off what the gather asked about it by id. */
  verdict(entity: PoolEntity, share: KindShare<Trees>, context: Context): SurroundingsRuleVerdict;
  logPrefix: string;
}

export interface SurroundingsArrivals<T = WikidataLandmark> {
  items: T[];
  filtered: FilteredEntity[];
  /** Why nothing was read, when nothing was. */
  skipped?: string;
}

/** A row of the kind's own shape from a survivor: the entity, the classes its rule read, the rule's verdict, the cut's note. */
export type SurroundingsBuilder<T> = (entity: PoolEntity, classes: string[], verdict: SurroundingsPass, note: string) => T;

/** A landmark of the surroundings tier, as the place sources write one, with what the kind's rule answered beside its type. */
export const surroundingsLandmark: SurroundingsBuilder<WikidataLandmark> = (entity, classes, verdict, note) => ({
  ...placeLandmark(entity, classes, verdict.type as WikidataLandmark['type']),
  ...(verdict.artwork === undefined ? {} : { artwork: verdict.artwork }),
  ...(verdict.creators === undefined ? {} : { creators: verdict.creators }),
  tier: 'surroundings',
  readershipNote: note,
});

/** The surroundings tier as a classifier carries it: the kind's part, with its trees read off the pass's gather. */
export interface SurroundingsReader {
  /** The classes whose instances the kind measures: its share of the pass's pool. */
  classes(gathered: GatheredPlaces): ReadonlySet<string>;
  /** The neighbourhoods the cut reads for this kind (`surroundingsGroups`). */
  groups(gathered: GatheredPlaces, cut: SurroundingsCut): SurroundingsGroup[];
  arrivals(run: SubjectRunner, sparql: SparqlFn, gathered: GatheredPlaces, worldAdmitted: ReadonlySet<string>,
    pool: SurroundingsPool | null, held: ReadonlySet<string>): Promise<SurroundingsArrivals>;
}

export function surroundingsReader<Trees, Context = undefined>(surroundings: SurroundingsKind<Trees, Context>, cut: SurroundingsCut = SURROUNDINGS_CUT): SurroundingsReader {
  return {
    classes: (gathered) => surroundings.classesOf(shareOf(gathered, surroundings.kind).trees),
    groups: (gathered, cut) => surroundingsGroups(surroundings, shareOf(gathered, surroundings.kind).trees, cut),
    arrivals: (run, sparql, gathered, worldAdmitted, pool, held) =>
      surroundingsArrivals(run, sparql, surroundings, shareOf(gathered, surroundings.kind).trees, worldAdmitted, surroundingsLandmark, pool, held, cut),
  };
}

const none = <T>(): SurroundingsArrivals<T> => ({ items: [], filtered: [] });

/**
 * The world tier's decision and the surroundings tier's, as one run's: every
 * admitted row once, and no row both admitted and refused. A row the world
 * classifier refused that the surroundings tier admits is admitted (its refusal
 * dropped), and a refusal both tiers name is listed once — the world's, which
 * a candidate in the pool already carries — so the run never refuses and
 * readmits the same place in one pass.
 *
 * A tier the run did not read leaves its memberships as they stand (ADR-0175
 * decision 6): where the surroundings step was skipped, a refusal the world
 * classifier names of a row the surroundings tier holds (`held`) is dropped, so
 * the place waits for the run that reads its tier.
 */
export function mergeSurroundings<T>(
  items: T[], filtered: FilteredEntity[], surroundings: SurroundingsArrivals<T>, idOf: (item: T) => string,
  held: ReadonlySet<string> = new Set(),
): void {
  const admitted = new Set(surroundings.items.map(idOf));
  const unread = surroundings.skipped ? held : new Set<string>();
  const kept = filtered.filter((entity) => !admitted.has(entity.externalId) && !unread.has(entity.externalId));
  const refused = new Set(kept.map((entity) => entity.externalId));
  filtered.splice(0, filtered.length, ...kept, ...surroundings.filtered.filter((entity) => !refused.has(entity.externalId)));
  items.push(...surroundings.items);
}

/** The key a kind's neighbourhoods are read under: its own group name, or its gather kind's. */
function groupOf(surroundings: { group?: string; kind: { name: string } }): string {
  return surroundings.group ?? surroundings.kind.name;
}

/** The key of the group a row of `classes` is measured among, under the cut's `neighbours`; null for a row of no type where types decide. */
export function surroundingsGroupKey<Trees>(
  surroundings: SurroundingsKind<Trees, unknown>, trees: Trees, classes: readonly string[], cut: SurroundingsCut,
): string | null {
  if (cut.neighbours === 'all') return 'all';
  if (cut.neighbours === 'kind') return groupOf(surroundings);
  const type = surroundings.typeOf?.(classes, trees) ?? null;
  return type === null ? null : `${groupOf(surroundings)}:${type}`;
}

/** The neighbourhoods the pool reads for a kind under the cut: the whole pool, the kind's places, or one group per type. */
export function surroundingsGroups<Trees>(surroundings: SurroundingsKind<Trees, unknown>, trees: Trees, cut: SurroundingsCut): SurroundingsGroup[] {
  if (cut.neighbours === 'all') return [{ key: 'all', classes: null }];
  if (cut.neighbours === 'kind') return [{ key: groupOf(surroundings), classes: surroundings.classesOf(trees) }];
  // Each class of the kind goes to the type the rule files a place of that class
  // under, so a type's neighbours are the places of the classes the rule types so.
  const byType = new Map<string, Set<string>>();
  for (const cls of surroundings.classesOf(trees)) {
    const type = surroundings.typeOf?.([cls], trees) ?? null;
    if (type === null) continue;
    if (!byType.has(type)) byType.set(type, new Set());
    byType.get(type)!.add(cls);
  }
  return [...byType].map(([type, classes]) => ({ key: `${groupOf(surroundings)}:${type}`, classes }));
}

/** The candidates of the kind's classes the cut admits, with the notes they clear it by. */
function survivorsOf<Trees>(
  surroundings: SurroundingsKind<Trees, unknown>, trees: Trees, worldAdmitted: ReadonlySet<string>, pool: SurroundingsPool,
  held: ReadonlySet<string>, cut: SurroundingsCut,
): { survivors: string[]; notes: Map<string, string>; fell: Map<string, string>; candidates: number } {
  const classes = surroundings.classesOf(trees);
  const survivors: string[] = [];
  const notes = new Map<string, string>();
  const fell = new Map<string, string>();
  let candidates = 0;
  for (const row of pool.rows.values()) {
    if (worldAdmitted.has(row.qid) || !row.classes.some((c) => classes.has(c))) continue;
    const key = surroundingsGroupKey(surroundings, trees, row.classes, cut);
    // A row this tier held that has no surroundings any more (under the cut's
    // languages, under the readers a held place stays at, or of no type where
    // types decide) still meets the cut, so it
    // falls with the cut's reason rather than the sweep's generic one.
    const near = (key === null ? undefined : pool.around.get(key)?.get(row.qid))
      ?? (held.has(row.qid) ? { groupSize: 0, topEditions: [], topGuideEditions: [], topReaders: [] } : undefined);
    if (!near) continue;
    candidates += 1;
    const verdict = surroundingsVerdict(
      { editions: row.editions, guideEditions: row.guideEditions, readers: row.readers }, near, cut, held.has(row.qid),
    );
    if (verdict.in) { survivors.push(row.qid); notes.set(row.qid, verdict.note); }
    // A row this tier admitted before that no longer clears the cut falls with
    // the cut's own reason, rather than the sweep's generic one.
    else if (held.has(row.qid)) fell.set(row.qid, verdict.reason);
  }
  return { survivors, notes, fell, candidates };
}

/**
 * The kind's surroundings-tier arrivals this run: every candidate of the kind's classes
 * the cut admits that the world tier did not (`worldAdmitted`), the kind's
 * rule passed, as rows of the surroundings tier with the cut's note for the
 * curator. `pool` is the pass's surroundings pool, or null where the run read the
 * live service and none could be read.
 */
export async function surroundingsArrivals<Trees, Context, T>(
  run: SubjectRunner,
  sparql: SparqlFn,
  surroundings: SurroundingsKind<Trees, Context>,
  trees: Trees,
  worldAdmitted: ReadonlySet<string>,
  build: SurroundingsBuilder<T>,
  pool: SurroundingsPool | null,
  held: ReadonlySet<string>,
  cut: SurroundingsCut = SURROUNDINGS_CUT,
): Promise<SurroundingsArrivals<T>> {
  const { logPrefix } = surroundings;
  if (!cut.enabled) {
    const skipped = 'The surroundings tier is switched off (SURROUNDINGS_CUT.enabled)';
    console.log(`${logPrefix} ${skipped}`);
    return { ...none<T>(), skipped };
  }
  if (!pool) {
    const skipped = 'The surroundings tier is read from the local subset alone (ADR-0171); this run read the live service, so none was read';
    console.log(`${logPrefix} ${skipped}`);
    return { ...none<T>(), skipped };
  }
  if (pool.unread) {
    console.log(`${logPrefix} ${pool.unread}`);
    return { ...none<T>(), skipped: pool.unread };
  }
  const { survivors, notes, fell, candidates } = survivorsOf(
    surroundings as SurroundingsKind<Trees, unknown>, trees, worldAdmitted, pool, held, cut,
  );
  console.log(`${logPrefix} Surroundings tier: ${candidates.toLocaleString('en')} candidates of the kind's classes at ${cut.minLanguages}+ editions `
    + `and ${(cut.stayReadersShare * cut.minReaders).toLocaleString('en')}+ readers, `
    + `${survivors.length.toLocaleString('en')} clear the cut within ${cut.radiusKm} km, ${fell.size} it held fell`);
  if (!survivors.length && !fell.size) return none<T>();

  // The survivors asked about by id, with everything the kind's rule reads of a
  // candidate: a kind with no pool question of its own, so the gather reads them alone.
  const byId: PlaceKind<Trees> = { ...surroundings.kind, poolClasses: () => ({ broad: [], narrow: [] }), admissionPool: false, entrance: undefined, editions: undefined };
  run.phase(`Asking about the ${survivors.length} places the surroundings cut admits...`);
  const gathered = await gatherPlaces(run, [{ kind: byId, admitted: new Set([...survivors, ...fell.keys()]) }]);
  const share = shareOf(gathered, byId);
  const asked = survivors.flatMap((qid) => share.pool.get(qid) ?? []);
  const context = (surroundings.context ? await surroundings.context(asked, share) : undefined) as Context;
  const items: T[] = [];
  const filtered: FilteredEntity[] = [];
  for (const qid of survivors) {
    const entity = share.pool.get(qid);
    if (!entity) continue;
    const verdict = surroundings.verdict(entity, share, context);
    if (!verdict.pass) {
      filtered.push({ externalId: qid, name: entity.label, reason: verdict.reason });
      continue;
    }
    // A tunnel, a dam or a lock the cut admits by its readers or editions is
    // still no sight until a guide says people go to see it (ADR-0175).
    const unguided = needsAGuide(verdict.type, pool.rows.get(qid)?.guideEditions ?? 0, cut);
    if (unguided) {
      filtered.push({ externalId: qid, name: entity.label, reason: unguided });
      continue;
    }
    items.push(build(entity, share.facts.get(qid)?.classes ?? [], verdict, notes.get(qid) ?? ''));
  }
  for (const [qid, reason] of fell) {
    filtered.push({ externalId: qid, name: share.pool.get(qid)?.label ?? qid, reason });
  }
  console.log(`${logPrefix} Surroundings tier: ${items.length} admitted by the kind's rule, ${filtered.length} refused`);
  return { items, filtered };
}
