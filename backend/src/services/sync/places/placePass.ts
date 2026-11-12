/**
 * The place pass (#1820, ADR-0132): every Wikidata place kind filled from one
 * gather of places, one source after another.
 *
 * The gather reads the candidates of every kind once (`gather.ts`) and each
 * source of `PLACE_PASS` classifies its own share: Public art and Monuments &
 * memorials by their kinds' rules, Places of worship by its door one,
 * Archaeology by its site door, Towers, Bridges & engineering marvels and
 * Squares & streets by their rules, each then by the world bars over its own
 * pool (ADR-0175, ADR-0179, `worldBars.ts`). Art Museums runs last, with no
 * place of its own: the works of Art Museums, Places of worship and
 * Archaeology are one gather of works the pass reads when the first of them
 * asks (#1821, `passWorks.ts`), each kind taking its own share. What a kind
 * reads beyond that — the venue-side read of what a venue holds,
 * Archaeology's museums and the finds under its floor, and the map and the
 * Wikipedias its site door asks — stays in its own run, through its own doors.
 */

import type { SyncProgress, SyncRunOptions } from '../types.js';
import { admittedExternalIds } from '../admission.js';
import { wikidataRunDoor } from '../subset/runDoor.js';
import { passMember, runSyncPass, sharedGather, type PassMember } from '../syncPass.js';
import { ART_MUSEUMS_SOURCE_ID, PLACE_PASS, PUBLIC_ART_SOURCES } from '../passes.js';
import { collectingSparql, liveSparql, placeSource, publicArtSource } from '../landmarkSyncService.js';
import { TOWERS_CLASSIFIER, TOWERS_KIND, TOWERS_SOURCE_ID } from '../towers/kind.js';
import { BRIDGES_CLASSIFIER, BRIDGES_KIND, BRIDGES_SOURCE_ID } from '../bridges/kind.js';
import { SQUARES_CLASSIFIER, SQUARES_KIND, SQUARES_SOURCE_ID } from '../squares/kind.js';
import { worshipSource, WORSHIP_SURROUNDINGS, WORSHIP_SOURCE_ID } from '../worshipSyncService.js';
import { archaeologySource } from '../archaeologySyncService.js';
import { ARCHAEOLOGY_SOURCE_ID } from '../archaeology/runDoors.js';
import { ARCHAEOLOGY_SITE_KIND } from '../archaeology/sites.js';
import { PUBLIC_ART_KIND } from '../publicArt/pipeline.js';
import { WORSHIP_KIND } from '../worship/places.js';
import { delay, SPARQL_DELAY_MS } from '../wikidataUtils.js';
import { readsSubset } from '../subset/reader.js';
import { fetchClassTree, MUSEUM_ROOT, type QueryRunner, type SparqlFn } from '../wikidataQueries.js';
import type { GatheredPlaces, GatherRequest, PlaceGather, PlaceKind } from './gather.js';
import type { GatheredWorks } from '../museum/worksGather.js';
import { gatherPassWorks, readMuseumClasses } from './passWorks.js';
import { fetchTreasureClasses } from '../worship/queries.js';
import { museumSource } from '../museumSyncService.js';
import { surroundingsReader, type SurroundingsReader } from './surroundingsTier.js';
import { publicArtSurroundings, type PlaceClassifier } from '../landmarkSyncService.js';
import { MONUMENTS_RULE, PUBLIC_ART_RULE } from '../publicArt/kindRules.js';
import type { SurroundingsPool } from './surroundingsPool.js';
import { SURROUNDINGS_CUT } from './surroundingsCut.js';
import { gatherKey, placesOf, poolOf, type PassKeep } from './keptGather.js';
import type { SubjectRunner } from '../publicArt/subjects.js';
import { keepVenueFigures, type VenueSource } from './venueFigures.js';

/** One kind of the pass: its request of the gather, its part of the surroundings pool and the sources it runs as. */
interface PassKind {
  /** The sources it fills, in the pass's order (`PLACE_PASS`). */
  sourceIds: readonly number[];
  /**
   * The share it reads: the place kind whose classes name its candidates, and the rows its
   * world tier admits before the run, asked for by id. None for a kind with no place of its
   * own (Art Museums).
   */
  share?: { kind: PlaceKind<unknown>; admitted(): Promise<ReadonlySet<string>> };
  /**
   * Its neighbourhoods in the surroundings pool; none where the kind has no surroundings tier.
   * Read when the pool is built, so a run that builds none reads none.
   */
  surroundings(): readonly SurroundingsReader[];
  /** The pass's members it runs as, one per source. */
  members(gather: (progress: SyncProgress) => Promise<PlaceGather>, options: SyncRunOptions): PassMember[];
}

/** A kind whose places have one point, one source deciding by its classifier: Towers, Bridges & engineering marvels, Squares & streets. */
function pointKind<Trees>(sourceId: number, kind: PlaceKind<Trees>, classifier: PlaceClassifier): PassKind {
  return {
    sourceIds: [sourceId],
    share: { kind: kind as PlaceKind<unknown>, admitted: () => admittedBy([sourceId]) },
    surroundings: () => (classifier.surroundings ? [classifier.surroundings] : []),
    members: (gather) => [passMember(placeSource(sourceId, gather, classifier))],
  };
}

let kinds: readonly PassKind[] | undefined;

/**
 * The kinds of the pass, in the order it runs them: the one list the gather's
 * requests, the surroundings pool's neighbourhoods and the pass's members are
 * built from (#2320), so a kind joins the pass, or a dry run of a proposed one
 * joins its pool, by one entry. `PLACE_PASS` names the same sources for the
 * routes, and `placePass.test.ts` holds the two alike. Built when the pass first
 * asks, so importing the pass reads no kind's module.
 */
export function passKinds(): readonly PassKind[] {
  kinds ??= [
    {
      // Public art and Monuments & memorials: one share, each kind's own rule (#1807).
      sourceIds: PUBLIC_ART_SOURCES,
      share: { kind: PUBLIC_ART_KIND as PlaceKind<unknown>, admitted: () => admittedBy(PUBLIC_ART_SOURCES) },
      surroundings: () => [surroundingsReader(publicArtSurroundings(PUBLIC_ART_RULE)), surroundingsReader(publicArtSurroundings(MONUMENTS_RULE))],
      members: (gather) => PUBLIC_ART_SOURCES.map((sourceId) => passMember(publicArtSource(sourceId, gather))),
    },
    {
      sourceIds: [WORSHIP_SOURCE_ID],
      share: { kind: WORSHIP_KIND as PlaceKind<unknown>, admitted: () => admittedBy([WORSHIP_SOURCE_ID]) },
      surroundings: () => [surroundingsReader(WORSHIP_SURROUNDINGS)],
      members: (gather, options) => [passMember(worshipSource(gather, options))],
    },
    {
      // The sites Archaeology's world tier admits, not its museums, which its own
      // museum door asks after (`ArchaeologyPipelineDeps.admittedSites`). Its
      // surroundings tier asks the map for a ruin (ADR-0179), not this pool.
      sourceIds: [ARCHAEOLOGY_SOURCE_ID],
      share: {
        kind: ARCHAEOLOGY_SITE_KIND as PlaceKind<unknown>,
        admitted: () => admittedExternalIds(ARCHAEOLOGY_SOURCE_ID, 'site', 'world'),
      },
      surroundings: () => [],
      members: (gather, options) => [passMember(archaeologySource(gather, options))],
    },
    pointKind(TOWERS_SOURCE_ID, TOWERS_KIND, TOWERS_CLASSIFIER),
    pointKind(BRIDGES_SOURCE_ID, BRIDGES_KIND, BRIDGES_CLASSIFIER),
    pointKind(SQUARES_SOURCE_ID, SQUARES_KIND, SQUARES_CLASSIFIER),
    {
      // Art Museums gathers no place: its museums are the venues its works lie
      // in, and its works are a share of the pass's one gather of works (#1821).
      sourceIds: [ART_MUSEUMS_SOURCE_ID],
      surroundings: () => [],
      members: (gather, options) => [passMember(museumSource(gather, options))],
    },
  ];
  return kinds;
}

/**
 * The place kinds the pass asks its candidates by class, each with the kinds of the catalogue
 * it fills: a source fills the `experience_kinds` row of its own id, and Public art and
 * Monuments & memorials share one. What the coverage report reads a top's class reach from
 * (#2146), so a kind that joins the pass is read there by the same entry.
 */
export function gatheredPlaceKinds(): { kindIds: readonly number[]; kind: PlaceKind<unknown> }[] {
  return passKinds().flatMap(({ sourceIds, share }) => (share ? [{ kindIds: sourceIds, kind: share.kind }] : []));
}

/**
 * The pass's surroundings pool: every place kind's classes, what a kind
 * measures beside them (`SurroundingsReader.named`), and the museum tree
 * beside them. Museums are no kind of the pass, but ADR-0171's measurement
 * counted them among a place's neighbours, and they set the references: the
 * Tretyakov Gallery, used by seven Wikivoyage editions, lifts Moscow's guide
 * median from 4 to 4.5, and a church with one listing then stays under a
 * quarter of it rather than exactly on it.
 */
async function surroundingsPoolOf(gathered: GatheredPlaces, sparql: SparqlFn, run: SubjectRunner, keep: PassKeep): Promise<SurroundingsPool> {
  const museums = await fetchClassTree(sparql, MUSEUM_ROOT, 'museum classes');
  const readers = passKinds().flatMap((kind) => kind.surroundings());
  const groups = SURROUNDINGS_CUT.neighbours === 'all' ? [{ key: 'all', classes: null }]
    : readers.flatMap((reader) => reader.groups(gathered, SURROUNDINGS_CUT));
  // What a kind measures beside its classes joins the pool too: the monuments
  // English Wikipedia files and Wikidata types as something else (#2171).
  const items = new Set(readers.flatMap((reader) => [...reader.named(gathered)]));
  // The kinds that read the venues around their places have them counted (ADR-0192).
  const venues = new Set(readers.flatMap((reader) => [...reader.venueClasses(gathered)]));
  const lines = readers.map((reader) => reader.venueLine(gathered));
  const venueLine = (classes: readonly string[]) => lines.some((line) => line(classes));
  const members = { classes: new Set([...gathered.classes, ...museums]), items, venues, venueLine };
  return poolOf(keep, members, SURROUNDINGS_CUT, groups, run);
}

/** The sources whose kinds read the venues around their places, with the classes those places are of. */
function venueSources(gathered: GatheredPlaces): VenueSource[] {
  return passKinds().flatMap((kind) => {
    const classes = new Set(kind.surroundings().flatMap((reader) => [...reader.venueClasses(gathered)]));
    return classes.size === 0 ? [] : kind.sourceIds.map((sourceId) => ({ sourceId, classes }));
  });
}

/**
 * The pool, once a real pass has kept the venues it counted for the curator
 * (`venueFigures.ts`, #2454). A dry run keeps none, and a failure to keep them
 * is logged rather than stopping the pass: no verdict reads them back.
 */
async function keepVenues(read: SurroundingsPool, gathered: GatheredPlaces, dryRun: boolean): Promise<SurroundingsPool> {
  if (dryRun) return read;
  await keepVenueFigures(read, venueSources(gathered), SURROUNDINGS_CUT)
    .catch((error: unknown) => { console.error('[Places] Keeping the venues the pass counted failed:', error); });
  return read;
}

/**
 * The modules the pass's kinds are declared in: a kind's classes, entrances
 * and editions are code the gather runs, so they are part of the code a kept
 * gather is read again by. A kind that joins `passKinds` joins this list
 * (`placePass.test.ts` holds the two together).
 */
export const PASS_KIND_MODULES: readonly URL[] = [
  new URL('../publicArt/pipeline.js', import.meta.url),
  new URL('../worship/places.js', import.meta.url),
  new URL('../archaeology/sites.js', import.meta.url),
  new URL('../towers/kind.js', import.meta.url),
  new URL('../bridges/kind.js', import.meta.url),
  new URL('../squares/kind.js', import.meta.url),
];

/**
 * The code the shared steps are made and kept by: the gather, the surroundings
 * pool, the kinds' declarations, and the format a step is kept in.
 */
export const SHARED_STEPS_CODE: readonly URL[] = [
  new URL('./gather.js', import.meta.url),
  new URL('./surroundingsPool.js', import.meta.url),
  new URL('./keptGather.js', import.meta.url),
  ...PASS_KIND_MODULES,
];

/** Every row a set of sources' world tier admits before the run: the surroundings tier's rows are its own step's (#2178). */
async function admittedBy(sourceIds: readonly number[]): Promise<Set<string>> {
  const admitted = new Set<string>();
  for (const id of sourceIds) for (const qid of await admittedExternalIds(id, undefined, 'world')) admitted.add(qid);
  return admitted;
}

/**
 * The gather the sources of the pass share: read once, by the first source to
 * run, through the pass's first source's door and cache (ADR-0132 decision 5),
 * with every kind's admitted rows asked for by id.
 */
function placeGather({ refreshCache, dryRun }: Pick<SyncRunOptions, 'refreshCache' | 'dryRun'>): (progress: SyncProgress) => Promise<PlaceGather> {
  const lead = PLACE_PASS[0];
  const shared = sharedGather(async (progress: SyncProgress): Promise<PlaceGather> => {
    const sparql = await wikidataRunDoor(lead, progress, () => collectingSparql(lead, progress, refreshCache === true));
    const run: SubjectRunner = {
      sparql,
      // The bridge a subset run asks what the subset in place does not keep
      // (`publicArt/subjects.ts`), uncached: no cached live answer is read
      // into a run on the subset (ADR-0119).
      live: () => liveSparql(progress),
      cancelled: () => progress.cancel === true,
      phase: (message) => { progress.statusMessage = message; },
      step: async () => {
        if (progress.cancel) throw new Error('Sync cancelled');
        // The pause spares the query service; the subset is our own database.
        if (!readsSubset(sparql)) await delay(SPARQL_DELAY_MS);
      },
    };
    const requests: GatherRequest[] = [];
    for (const { share } of passKinds()) if (share) requests.push({ kind: share.kind, admitted: await share.admitted() });
    // Kept only from the subset: a live answer is no build's, and no key names it.
    const keep: PassKeep = {
      key: readsSubset(sparql) ? await gatherKey(requests, SHARED_STEPS_CODE) : null,
      read: dryRun === true && refreshCache !== true,
      note: {},
    };
    const gathered = await placesOf(keep, requests, run);
    // The surroundings tier's pool (ADR-0171, #2178), read once for the pass over
    // every place kind's classes together — a church is measured against the
    // digs and towers around it, as the measurement measured it — and only
    // where the run reads the subset.
    let surroundings: Promise<SurroundingsPool | null> | undefined;
    let works: Promise<GatheredWorks> | undefined;
    let museumClasses: Promise<ReadonlySet<string>> | undefined;
    let treasures: Promise<Record<string, string>> | undefined;
    // The gather of works is read when a works kind first asks, in that kind's
    // run, not in the run that made this gather: its phases go to the asking
    // run's section, and a Cancel of it stops the read.
    const runnerOf = (asking: SyncProgress): QueryRunner => ({
      sparql,
      phase: (message) => { asking.statusMessage = message; },
      step: async () => {
        if (asking.cancel) throw new Error('Sync cancelled');
        if (!readsSubset(sparql)) await delay(SPARQL_DELAY_MS);
      },
    });
    const treasureClasses = (asking: SyncProgress) => {
      treasures ??= fetchTreasureClasses(runnerOf(asking));
      return treasures;
    };
    return {
      gathered, sparql, run,
      surroundings: () => {
        surroundings ??= SURROUNDINGS_CUT.enabled && readsSubset(sparql)
          ? surroundingsPoolOf(gathered, sparql, run, keep).then((read) => keepVenues(read, gathered, dryRun === true))
          : Promise.resolve(null);
        return surroundings;
      },
      works: {
        gathered: (asking) => {
          works ??= treasureClasses(asking).then((classes) => gatherPassWorks(gathered, runnerOf(asking), classes));
          return works;
        },
        museumClasses: (asking) => {
          museumClasses ??= readMuseumClasses(runnerOf(asking));
          return museumClasses;
        },
        treasureClasses,
      },
      kept: keep.note,
    };
  });
  // Every source's closing line says what the pass read back, as far as it has by then.
  return async (progress) => {
    const gather = await shared(progress);
    progress.keptGather = gather.kept;
    return gather;
  };
}

/**
 * Collect the places every place kind offers from Wikidata, once, for every
 * source of the pass.
 */
export function syncPlacePass(
  triggeredBy: number | null,
  options: SyncRunOptions = {},
): Promise<void> {
  // The one place the run's options reach the gather: the cache, and whether a
  // kept gather is read back, are properties of *this* run rather than of the source.
  const gather = placeGather(options);
  return runSyncPass(
    passKinds().flatMap((kind) => kind.members(gather, options)),
    triggeredBy,
    options,
  );
}
