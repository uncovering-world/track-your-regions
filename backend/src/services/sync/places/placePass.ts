/**
 * The place pass (#1820, ADR-0132): every Wikidata place kind filled from one
 * gather of places, one source after another.
 *
 * The gather reads the candidates of every kind once (`gather.ts`) and each
 * source of `PLACE_PASS` classifies its own share: Public art and Monuments &
 * memorials by their kinds' rules, Places of worship by its door one,
 * Archaeology by its site door, Towers, Bridges & engineering marvels and
 * Squares & streets by their rules and lines. What a kind
 * reads beyond its places — worship's
 * works and the second door they open, Archaeology's museums and finds, and the
 * map, the Wikipedias and the witnesses its site door asks — stays in its own
 * run, through its own doors.
 */

import type { SyncProgress, SyncRunOptions } from '../types.js';
import { admittedExternalIds } from '../admission.js';
import { wikidataRunDoor } from '../subset/runDoor.js';
import { passMember, runSyncPass, sharedGather } from '../syncPass.js';
import { PLACE_PASS, PUBLIC_ART_SOURCES } from '../passes.js';
import { collectingSparql, liveSparql, placeSource, publicArtSource } from '../landmarkSyncService.js';
import { TOWERS_CLASSIFIER, TOWERS_KIND, TOWERS_SOURCE_ID } from '../towers/kind.js';
import { BRIDGES_CLASSIFIER, BRIDGES_KIND, BRIDGES_SOURCE_ID } from '../bridges/kind.js';
import { SQUARES_CLASSIFIER, SQUARES_KIND, SQUARES_SOURCE_ID } from '../squares/kind.js';
import { worshipSource, WORSHIP_REGIONAL, WORSHIP_SOURCE_ID } from '../worshipSyncService.js';
import { archaeologySource } from '../archaeologySyncService.js';
import { ARCHAEOLOGY_SOURCE_ID } from '../archaeology/runDoors.js';
import { ARCHAEOLOGY_SITE_KIND } from '../archaeology/sites.js';
import { PUBLIC_ART_KIND } from '../publicArt/pipeline.js';
import { WORSHIP_KIND } from '../worship/places.js';
import { delay, SPARQL_DELAY_MS } from '../wikidataUtils.js';
import { readsSubset } from '../subset/reader.js';
import { fetchClassTree, MUSEUM_ROOT, type SparqlFn } from '../wikidataQueries.js';
import { gatherPlaces, shareOf, type GatheredPlaces, type PlaceGather } from './gather.js';
import { regionalGroups } from './regionalTier.js';
import { publicArtRegional } from '../landmarkSyncService.js';
import { MONUMENTS_RULE, PUBLIC_ART_RULE } from '../publicArt/kindRules.js';
import { readRegionalPool, type RegionalPool } from './regionalPool.js';
import { REGIONAL_CUT } from './regionalCut.js';
import type { SubjectRunner } from '../publicArt/subjects.js';

/**
 * The pass's regional pool: every place kind's classes, and the museum tree
 * beside them. Museums are no kind of the pass, but ADR-0171's measurement
 * counted them among a place's neighbours, and they set the references: the
 * Tretyakov Gallery, used by seven Wikivoyage editions, lifts Moscow's guide
 * median from 4 to 4.5, and a church with one listing then stays under a
 * quarter of it rather than exactly on it.
 */
async function regionalPoolOf(gathered: GatheredPlaces, sparql: SparqlFn, run: SubjectRunner): Promise<RegionalPool> {
  const museums = await fetchClassTree(sparql, MUSEUM_ROOT, 'museum classes');
  const groups = REGIONAL_CUT.neighbours === 'all' ? [{ key: 'all', classes: null }] : [
    ...TOWERS_CLASSIFIER.regional!.groups(gathered, REGIONAL_CUT),
    ...BRIDGES_CLASSIFIER.regional!.groups(gathered, REGIONAL_CUT),
    ...SQUARES_CLASSIFIER.regional!.groups(gathered, REGIONAL_CUT),
    ...regionalGroups(publicArtRegional(PUBLIC_ART_RULE), shareOf(gathered, PUBLIC_ART_KIND).trees, REGIONAL_CUT),
    ...regionalGroups(publicArtRegional(MONUMENTS_RULE), shareOf(gathered, PUBLIC_ART_KIND).trees, REGIONAL_CUT),
    ...regionalGroups(WORSHIP_REGIONAL, shareOf(gathered, WORSHIP_KIND).trees, REGIONAL_CUT),
  ];
  return readRegionalPool(new Set([...gathered.classes, ...museums]), REGIONAL_CUT, groups, run);
}

/** Every row a set of sources' world tier admits before the run: the regional tier's rows are its own step's (#2178). */
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
function placeGather(refreshCache: boolean): (progress: SyncProgress) => Promise<PlaceGather> {
  const lead = PLACE_PASS[0];
  return sharedGather(async (progress) => {
    const sparql = await wikidataRunDoor(lead, progress, () => collectingSparql(lead, progress, refreshCache));
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
    const gathered = await gatherPlaces(run, [
      { kind: PUBLIC_ART_KIND, admitted: await admittedBy(PUBLIC_ART_SOURCES) },
      { kind: WORSHIP_KIND, admitted: await admittedBy([WORSHIP_SOURCE_ID]) },
      // The sites Archaeology admits, not its museums, which its own museum
      // door asks after (`ArchaeologyPipelineDeps.admittedSites`).
      { kind: ARCHAEOLOGY_SITE_KIND, admitted: await admittedExternalIds(ARCHAEOLOGY_SOURCE_ID, 'site') },
      { kind: TOWERS_KIND, admitted: await admittedBy([TOWERS_SOURCE_ID]) },
      { kind: BRIDGES_KIND, admitted: await admittedBy([BRIDGES_SOURCE_ID]) },
      { kind: SQUARES_KIND, admitted: await admittedBy([SQUARES_SOURCE_ID]) },
    ]);
    // The regional tier's pool (ADR-0171, #2178), read once for the pass over
    // every place kind's classes together — a church is measured against the
    // digs and towers around it, as the measurement measured it — and only
    // where the run reads the subset.
    let regional: Promise<RegionalPool | null> | undefined;
    return {
      gathered, sparql, run,
      regional: () => {
        regional ??= REGIONAL_CUT.enabled && readsSubset(sparql) ? regionalPoolOf(gathered, sparql, run) : Promise.resolve(null);
        return regional;
      },
    };
  });
}

/**
 * Collect the places every place kind offers from Wikidata, once, for every
 * source of the pass.
 */
export function syncPlacePass(
  triggeredBy: number | null,
  options: SyncRunOptions = {},
): Promise<void> {
  // The one place the run's options reach the gather: the cache is a property
  // of *this* run rather than of the source.
  const gather = placeGather(options.refreshCache === true);
  return runSyncPass(
    [
      ...PUBLIC_ART_SOURCES.map((sourceId) => passMember(publicArtSource(sourceId, gather))),
      passMember(worshipSource(gather, options)),
      passMember(archaeologySource(gather, options)),
      passMember(placeSource(TOWERS_SOURCE_ID, gather, TOWERS_CLASSIFIER)),
      passMember(placeSource(BRIDGES_SOURCE_ID, gather, BRIDGES_CLASSIFIER)),
      passMember(placeSource(SQUARES_SOURCE_ID, gather, SQUARES_CLASSIFIER)),
    ],
    triggeredBy,
    options,
  );
}
