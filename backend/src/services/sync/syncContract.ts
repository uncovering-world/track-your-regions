/**
 * What a sync service hands the orchestrator, and what the orchestrator hands
 * back: the config a service is run from, the result of its fetch and of each
 * item, and the context every item is processed in.
 *
 * A module of its own so that the orchestrator's parts — the item outcome, the
 * admission step, the run log — read these shapes without importing the module
 * that runs the loop, which would be a cycle.
 */

import type { ChangeSetResult } from './changeSet.js';
import type { SourceCompleteness } from './missingDetection.js';
import type { SyncProgress, ErrorDetail, ContentsByKind } from './types.js';

/**
 * An entity the source offered that is not of the kind this source holds —
 * a Wikidata collection answering a museum query, say. Nothing failed, so it is
 * counted apart from errors and leaves the run's status alone.
 */
export interface FilteredEntity {
  externalId: string;
  name: string;
  reason: string;
}

export interface FetchResult<T> {
  items: T[];
  fetchedCount: number;
  filtered?: FilteredEntity[];
  /**
   * Objects an admitted row holds that the kind's rule turned down — what the
   * venue-side read refused (#890, `museum/venueSide.ts`): the film in an art
   * museum's collection, the conclave a cathedral's `P276` names. Reported on
   * the run's changeset as `filtered` rows, so a person reads which classes
   * the pool never asked for, and **never marked**: `filtered` is matched
   * against the source's own rows by external id, and an object is not a row
   * of the source — a relic that is also a chapel of the same kind would have
   * its place refused for a verdict taken on the object.
   */
  refusedContents?: FilteredEntity[];
  /**
   * Why this run may not withdraw the contents it stopped seeing, or absent
   * when it may.
   *
   * A collector that measures what it fetched against a floor answers here —
   * the museum run does, over its works (ADR-0044) — and the answer goes three
   * places: onto the log row, so a run that marked nothing because it saw too
   * little is not read as one that found nothing to mark; into every
   * `processItem` call through the context, so the writer marks nothing behind
   * it; and into the run's status, which cannot be `success` while the source's
   * departures are unrecorded. A source whose contents need no floor — points
   * are paired per object — leaves it out.
   */
  withdrawalSkippedReason?: string | null;
}


/** What a run is doing, handed to every processItem call. */
export interface SyncRunContext {
  dryRun: boolean;
  syncLogId: number | null;
  /**
   * Register that an experience's locations were just written, so the run can
   * place it before it ends.
   *
   * Called at the write, not carried back on the result. A service can throw
   * *after* moving a point — the museum one does, since treasures are upserted
   * afterwards — and a returned field is lost when it does. The point has
   * already moved on disk by then, so the object would keep a stale assignment
   * naming the region it left, with nothing to signal it.
   */
  onLocationsChanged: (experienceId: number) => void;
  /**
   * The collector's own verdict on withdrawing contents, carried back to the
   * writer: `FetchResult.withdrawalSkippedReason`, or null where the run may
   * withdraw. Threaded rather than remembered in module state so the order —
   * floor first, withdrawal second, never the reverse — is visible in one place.
   */
  withdrawalSkippedReason: string | null;
}

export interface ProcessItemResult {
  outcome: 'created' | 'updated' | 'unchanged';
  experienceId: number | null;
  nameSnapshot: string;
  changeSet: ChangeSetResult;
  /** The row had been flagged missing and the source has produced it again. */
  returnedFromMissing: boolean;
  /**
   * What the run did to the object's contents, by kind (ADR-0026).
   *
   * Optional because a source with nothing to hold has nothing to report, and
   * absent is not the same as an empty delta: one says the question does not
   * apply, the other that it was asked and the answer was nothing.
   */
  contents?: ContentsByKind;
}

export interface SyncServiceConfig<T> {
  sourceId: number;
  logPrefix: string;
  /**
   * Whether the source hands over its whole collection. Only `authoritative`
   * sources can have absence read as a delisting — a top-N Wikidata query drops
   * objects for reasons that have nothing to do with them existing.
   */
  sourceCompleteness: SourceCompleteness;
  /**
   * Whether every run recomputes the whole membership from the whole pool,
   * rather than fetching a published list. Only such a source may sweep: for it
   * "absent from the admitted set" is a decision, and for the others it is the
   * ambiguous silence ADR-0020 was written about (ADR-0024).
   */
  recomputesMembership?: boolean;
  /**
   * Whether belonging to the source *is* the must-see badge: the source's
   * admission rule is a fame threshold, so every row it admits holds a work
   * above the line and carries `is_iconic` for that (works-first museums,
   * ADR-0023). A listing, or a source whose rule is not fame, badges nothing
   * however its membership is computed — the badge is a property of the rule,
   * not of recomputing (ADR-0045 decision 5). Read after the admission step,
   * once every row of the run has the admission it will keep (#760).
   *
   * A predicate where the world tier has a door that is not a masterpiece:
   * the kind admits a place for what it *is* as well as for what it holds, and
   * only the second is the badge. Archaeology is that shape — a museum enters
   * on its own fame or on a find above the finds' line (ADR-0058 decision 2) —
   * so it badges the museum holding the find and leaves the other in the kind
   * in full standing without one (ADR-0045 decision 5). The question is asked
   * of the item the collector judged, because the row on disk does not carry
   * the answer: `true` is the same rule with every admitted item passing.
   */
  badgesAdmitted?: boolean | ((item: T) => boolean);
  /** Fetch and prepare items for processing. Can append to errorDetails for pre-processing errors. */
  fetchItems: (progress: SyncProgress, errorDetails: ErrorDetail[]) => Promise<FetchResult<T>>;
  /** Process a single item and describe what happened to it. Throw to count as error. */
  processItem: (item: T, progress: SyncProgress, context: SyncRunContext) => Promise<ProcessItemResult>;
  /** Display name for progress messages. */
  getItemName: (item: T) => string;
  /** External ID for error reporting. */
  getItemId: (item: T) => string;
}
