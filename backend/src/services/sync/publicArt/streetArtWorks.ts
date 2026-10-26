/**
 * What an admitted street-art place holds (#2055): the murals Wikidata links
 * to the wall, shown on its card as a museum's works are on a museum's.
 *
 * The East Side Gallery is walked for its murals — Dmitri Vrubel's kiss, *Es
 * geschah im November* — and a card showing the wall alone misses what a
 * traveller goes there for. So a street-art place holds the works Wikidata
 * links to it by a standing statement (`fetchStreetArtHoldings`): works of art
 * only, so a district's streets and houses stay out; with a picture, since a
 * work on a card is shown; and still there (`P576`). Their order is their fame,
 * and there is no fame floor: a mural is written up in one or two languages and
 * is still what the wall is visited for.
 *
 * They are written by the treasure writer and placed by Public art's own
 * membership (ADR-0084), so the coverage floor (ADR-0044), the curator gate and
 * the picture credits are the ones every kind that holds works goes through.
 * The must-see mark is the art museums' line (`ICONIC_SITELINKS`, the writer's
 * own when a run states none) or the readership door over these works
 * (ADR-0056): on the East Side Gallery, Vrubel's kiss alone.
 */

import { readPreviousPlacements } from '../museumSyncService.js';
import { upsertVenueTreasures } from '../museum/treasureWriter.js';
import { measureWorksCoverage, worksCoverageSkipReason } from '../museum/worksCoverage.js';
import { fetchWorksByIds, type WorkDetails } from '../museum/venueSideQueries.js';
import { withEnglishArticles } from '../museum/worksCollector.js';
import { ICONIC_SITELINKS } from '../museum/tier1.js';
import { readContent, readershipDoorFor, type ReadershipDoor } from '../readershipDoor.js';
import { readStoredTreasureCredits, type ImageCredit, type StoredCredit } from '../imageCredit.js';
import { unique, type QueryRunner, type SparqlFn } from '../wikidataQueries.js';
import { delay, SPARQL_DELAY_MS } from '../wikidataUtils.js';
import { readsSubset } from '../subset/reader.js';
import type { ContentsDelta, ProcessedContent, SyncProgress, WikidataLandmark } from '../types.js';
import type { SyncRunContext } from '../syncContract.js';
import { fetchRootsOfClasses, fetchStreetArtHoldings, fetchStreetArtMarks, type StreetArtHolding } from './streetArtQueries.js';

/** What a held work must be a kind of: a work of art (`Q838948`). */
const WORK_OF_ART = 'Q838948';

/** The places of a source's run that hold works, read before the first is written and written one by one. */
export interface PlaceContents {
  /**
   * Read what the run's admitted places hold. Answers the coverage floor's
   * verdict (ADR-0044) and the pictures the credit pass is to ask about.
   */
  read(items: readonly WikidataLandmark[], sparql: SparqlFn, progress: SyncProgress): Promise<{
    withdrawalSkippedReason: string | null;
    imageUrls: (string | null)[];
  }>;
  /** Write what one admitted place holds; undefined for a place that holds nothing and held nothing. */
  write(
    experienceId: number, qid: string, context: SyncRunContext, fetched: Map<string, ImageCredit>,
  ): Promise<ContentsDelta | undefined>;
}

/**
 * Which holdings a card shows, by place, the most famous first and by name
 * among equals: those of `shown`, the works the read kept.
 */
export function worksByPlace(
  holdings: readonly StreetArtHolding[],
  shown: ReadonlyMap<string, ProcessedContent>,
): Map<string, ProcessedContent[]> {
  const out = new Map<string, ProcessedContent[]>();
  for (const { place, work } of holdings) {
    const content = shown.get(work);
    if (!content) continue;
    const works = out.get(place) ?? [];
    if (!works.includes(content)) works.push(content);
    out.set(place, works);
  }
  for (const works of out.values()) {
    works.sort((a, b) => b.sitelinksCount - a.sitelinksCount || a.name.localeCompare(b.name));
  }
  return out;
}

/** Whether a work the read asked about is one a card shows: a work of art, with a picture, still there. */
export function isShownWork(details: WorkDetails, artClasses: ReadonlySet<string>, ended: boolean): boolean {
  return details.work.imageUrl !== null && !ended && [...details.classes.keys()].some((cls) => artClasses.has(cls));
}

/** The works the street-art places of `sourceId`'s run hold. */
export function streetArtContents(sourceId: number, logPrefix: string): PlaceContents {
  let byPlace = new Map<string, ProcessedContent[]>();
  let stored = new Map<string, StoredCredit>();
  // Where the previous run left each work, so a place that holds nothing now is
  // still written, and its links reconciled.
  let heldBefore = new Set<string>();

  /** The works this run places at another place and not at `qid`, whose old link the writer holds. */
  const placedElsewhere = (qid: string): string[] => unique(
    [...byPlace].filter(([place]) => place !== qid).flatMap(([, works]) => works.map((w) => w.externalId))
      .filter((work) => !(byPlace.get(qid) ?? []).some((w) => w.externalId === work)),
  );

  return {
    async read(items, sparql, progress) {
      const run: QueryRunner = {
        sparql,
        phase: (message) => { progress.statusMessage = message; },
        step: async () => {
          if (progress.cancel) throw new Error('Sync cancelled');
          // The pause spares the query service; the subset is our own database.
          if (!readsSubset(sparql)) await delay(SPARQL_DELAY_MS);
        },
      };
      const previous = await readPreviousPlacements(sourceId);
      heldBefore = new Set(Object.values(previous).flat());
      stored = await readStoredTreasureCredits();

      run.phase('Reading what the street-art places hold...');
      const places = items.filter((item) => item.type === 'street-art').map((item) => item.qid);
      // A mural the run also admits as a place of its own is still on its
      // wall's card: the wall is what a traveller walks, the mural what they
      // stop at, and how a wall and its panels make one visit is #1992's.
      await run.step();
      const holdings = await fetchStreetArtHoldings(sparql, places);
      const asked = unique(holdings.map((h) => h.work));
      await run.step();
      const details = await fetchWorksByIds(run, asked);
      const classes = unique([...details.values()].flatMap((d) => [...d.classes.keys()]));
      await run.step();
      const artClasses = new Set((await fetchRootsOfClasses(sparql, classes, [WORK_OF_ART])).keys());
      await run.step();
      const marks = await fetchStreetArtMarks(sparql, asked);
      const kept = [...details.values()].filter((d) => isShownWork(d, artClasses, marks.get(d.work.qid)?.ended ?? false));

      const openDoor = await readershipDoorFor(sourceId, ICONIC_SITELINKS, logPrefix);
      const door: ReadershipDoor | null = openDoor
        ? await openDoor(kept.map((d) => ({ qid: d.work.qid, sitelinks: d.work.sitelinks })))
        : null;
      const shown = new Map(kept.map((d) => [d.work.qid, readContent(d.work, door)]));
      await withEnglishArticles(run, [...shown.values()]);
      byPlace = worksByPlace(holdings, shown);

      const labelOf = new Map(items.map((item) => [item.qid, item.label]));
      console.log(`${logPrefix} What the street-art places hold: ${[...byPlace]
        .map(([place, works]) => `${labelOf.get(place) ?? place} ${works.length} (${works[0].name} first)`)
        .join(', ') || 'nothing'}`);

      const coverage = {
        stored: previous,
        admitted: items.map((item) => ({ qid: item.qid, works: (byPlace.get(item.qid) ?? []).map((w) => w.externalId) })),
      };
      const measured = measureWorksCoverage(coverage);
      console.log(`${logPrefix} Street-art works coverage: ${measured.seen} of ${measured.stored} works offered at `
        + `the admitted places placed again`);
      return {
        withdrawalSkippedReason: worksCoverageSkipReason(coverage, 'places'),
        imageUrls: [...shown.values()].map((content) => content.imageUrl),
      };
    },

    async write(experienceId, qid, context, fetched) {
      const works = byPlace.get(qid);
      if (!works && !heldBefore.has(qid)) return undefined;
      return upsertVenueTreasures(
        experienceId,
        works ?? [],
        { fetched, stored },
        { syncLogId: context.syncLogId, withdrawalSkippedReason: context.withdrawalSkippedReason, sourceId },
        placedElsewhere(qid),
      );
    },
  };
}
