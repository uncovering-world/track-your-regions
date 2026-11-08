/**
 * A place kind's world tier over its share of the gather (ADR-0175): the rule
 * over every candidate, the bars over the candidates the rule passes, then
 * each candidate against the bars. `openWorldTier` is what every kind of the
 * frame opens — Towers, Bridges & engineering marvels and Squares & streets
 * through `classifyByWorldBars` here, Public art, Monuments & memorials and
 * Places of worship through their own classifiers, which read more than a
 * rule and a type.
 */

import type { FilteredEntity } from '../syncContract.js';
import type { WikidataLandmark } from '../types.js';
import type { SparqlFn } from '../wikidataQueries.js';
import type { KindShare } from './gather.js';
import { placeLandmark } from './candidates.js';
import { POOL_MIN_SITELINKS } from '../publicArt/queries.js';
import {
  barsLine, barsToAdmitBy, guidedBarNote, keptNote, reachesABar, readAtlas, readWorld, worldBars, worldStanding,
  type WorldBars, type WorldCandidate, type WorldRead, type WorldStanding,
} from './worldBars.js';
import type { WorldHistory } from './worldMemory.js';

/** The bars a kind opened this run, and how a candidate stands against them. */
export interface WorldTier {
  bars: WorldBars | null;
  read: WorldRead;
  /** Where a candidate the rule passed stands; `held` is whether the last run admitted it. */
  standing(c: WorldCandidate, held: boolean): WorldStanding;
  /** Whether a candidate reaches a bar to enter, so that the rule's refusal of it is named. */
  reaches(c: WorldCandidate): boolean;
  /** The note a row in by `standing` carries, where one is asked: the guide's mark, or why a held place was kept. */
  noteOf(c: WorldCandidate, standing: Exclude<WorldStanding, 'out' | { fell: string }>): string | undefined;
}

/**
 * Whether a candidate of the share is a member of the kind's pool, given that
 * the rule passed it: a point, and named by one of the kind's class questions
 * at a pool's floor (`KindShare.admissionPool`) — not a row asked for by id,
 * which vouches for nothing but its id, nor one only an entrance brought.
 */
export function inPool(
  share: { admissionPool: ReadonlySet<string> | null }, qid: string, entity: { lat: number | null; lon: number | null },
): boolean {
  return entity.lat !== null && entity.lon !== null && share.admissionPool !== null && share.admissionPool.has(qid);
}

/**
 * Whether the rule's refusal of a candidate is named on the run: one the kind
 * holds, one the shared pool named at its floor as before the frame, or one a
 * bar would admit. The rest of the pool the rule refuses is its long tail,
 * and naming it would bury the refusals a curator reads.
 */
export function namesRefusal(c: WorldCandidate, held: boolean, tier: WorldTier): boolean {
  return held || c.editions >= POOL_MIN_SITELINKS || tier.reaches(c);
}

/**
 * What a classifier hands the world tier beside its pool: for a run, the
 * source's history (`worldMemory.ts`); for a test, the signals and the bars,
 * where the test is not about the pool they come from.
 */
export interface WorldOptions {
  read?: WorldRead;
  bars?: WorldBars;
  history?: WorldHistory;
}

/**
 * Open the world tier: read the signals of every candidate in `qids` (or take
 * `read` handed in, for a test), compute the bars over `pool` — none where the
 * kind's admission pool was not read — and read the Atlas Obscura listings
 * of the candidates they could decide. What the run cannot read it takes from
 * the source's history (ADR-0175 decision 6): the readers' bars of the last
 * run that read a year, and each place's readers and guide's mark as last
 * read; the bars it admits by are then kept on the run's log. The run's line
 * names the bars and what it kept.
 */
export async function openWorldTier(
  { pool, qids, poolRead, sparql, logPrefix, read, bars: given, history, listed }: {
    pool: readonly WorldCandidate[];
    qids: readonly string[];
    poolRead: boolean;
    sparql: SparqlFn;
    logPrefix: string;
    /** The candidates whose World Heritage listing the kind reads as a guide's mark (Archaeology, ADR-0185). */
    listed?: ReadonlySet<string>;
  } & WorldOptions,
): Promise<WorldTier> {
  const fresh = read ?? await readWorld(qids, logPrefix);
  const base = history ? { ...fresh, memory: history.memory } : fresh;
  const bars = given ?? barsToAdmitBy(poolRead ? worldBars(pool, base.readers) : null, base);
  const read_: WorldRead = read ? base as WorldRead : { ...base, atlas: await readAtlas(sparql, qids, base, bars) };
  const signals: WorldRead = listed ? { ...read_, listed } : read_;
  console.log(barsLine(logPrefix, bars, base));
  if (bars) await history?.keep(bars);
  return {
    bars,
    read: signals,
    standing: (c, held) => worldStanding(c, signals, bars, held),
    reaches: (c) => reachesABar(c, signals, bars),
    noteOf: (c, stands) => {
      if (stands.kept) return keptNote(c, stands.kept);
      return stands.by === 'guided' && bars ? guidedBarNote(c, signals, bars) : undefined;
    },
  };
}

/** A kind's verdict on one candidate: the type it is filed under, or why it is refused. */
export type PlaceVerdict<Type extends WikidataLandmark['type']> = { pass: true; type: Type } | { pass: false; reason: string };

/** What a kind with one rule and one type decides by. */
export interface WorldKind<Trees, Type extends WikidataLandmark['type']> {
  verdict(facts: { classes: readonly string[]; onEarth: boolean; lat: number | null; lon: number | null }, trees: Trees): PlaceVerdict<Type>;
  /** Names the kind in the run's log, `[Bridges]`. */
  logPrefix: string;
}

/**
 * Decide from a kind's share: the rule, then the world bars. Items come back
 * most famous first. A refusal by the rule is named as `namesRefusal` says.
 * `read` hands the signals in, for a test; a run reads them, with what the
 * source last read (`history`) for what it cannot.
 */
export async function classifyByWorldBars<Trees, Type extends WikidataLandmark['type']>(
  share: KindShare<Trees>,
  admitted: ReadonlySet<string>,
  kind: WorldKind<Trees, Type>,
  sparql: SparqlFn,
  read?: WorldRead,
  history?: WorldHistory,
): Promise<{ items: WikidataLandmark[]; fetched: number; filtered: FilteredEntity[] }> {
  const { trees, pool, facts } = share;
  const entities = [...pool.values()].sort((a, b) => b.sitelinks - a.sitelinks);
  const verdicts = new Map(entities.map((entity) => {
    const classes = facts.get(entity.qid)?.classes ?? [];
    return [entity.qid, { classes, verdict: kind.verdict({ classes, onEarth: entity.onEarth, lat: entity.lat, lon: entity.lon }, trees) }];
  }));
  const candidate = (entity: { qid: string; sitelinks: number }): WorldCandidate => ({ qid: entity.qid, editions: entity.sitelinks });
  const tier = await openWorldTier({
    pool: entities.filter((e) => verdicts.get(e.qid)!.verdict.pass && inPool(share, e.qid, e)).map(candidate),
    qids: entities.map((e) => e.qid),
    poolRead: share.admissionPool !== null,
    sparql,
    logPrefix: kind.logPrefix,
    read,
    history,
  });
  const items: WikidataLandmark[] = [];
  const filtered: FilteredEntity[] = [];
  for (const entity of entities) {
    const { classes, verdict } = verdicts.get(entity.qid)!;
    const c = candidate(entity);
    const held = admitted.has(entity.qid);
    if (!verdict.pass) {
      if (namesRefusal(c, held, tier)) filtered.push({ externalId: entity.qid, name: entity.label, reason: verdict.reason });
      continue;
    }
    const stands = tier.standing(c, held);
    if (stands === 'out') continue;
    if ('fell' in stands) {
      filtered.push({ externalId: entity.qid, name: entity.label, reason: stands.fell, type: verdict.type });
      continue;
    }
    const note = tier.noteOf(c, stands);
    items.push({ ...placeLandmark(entity, classes, verdict.type), ...(note ? { readershipNote: note } : {}) });
  }
  console.log(`${kind.logPrefix} Pool of ${pool.size}: ${items.length} admitted, ${filtered.length} refused`);
  return { items, fetched: pool.size, filtered };
}
