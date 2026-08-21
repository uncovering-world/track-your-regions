/**
 * Museum Sync Service
 *
 * Collects the works the world knows, then admits the museums that hold them. The selection
 * itself lives in `museum/` — one tested module per rule, composed by `museum/pipeline.ts`;
 * this file is the run around it: read what the last run left, hand the proposal to the
 * orchestrator, and write museums as experiences and their works as treasures.
 *
 * The rule it replaced asked which Wikidata entity owns famous paintings and called the answer
 * a museum, which is how the catalogue came to hold four Louvre departments and no Louvre.
 */

import { pool } from '../../db/index.js';
import { upsertExperienceRecord, upsertSingleLocation } from './syncUtils.js';
import { retirePassAfterNewContent } from './curationDecay.js';
import { orchestrateSync, getSyncStatus, cancelSync, type FilteredEntity } from './syncOrchestrator.js';
import type { ProcessItemResult, SyncRunContext } from './syncOrchestrator.js';
import type { ChangeSetResult } from './changeSet.js';
import type {
  SyncProgress,
  ProcessedContent,
  CollectedMuseum,
  ContentItem,
  ContentItemChange,
  ContentsDelta,
} from './types.js';
import { workChanges } from './contentsChangeSet.js';
import { withCache, type CacheDescriptor } from './wikidataCache.js';
import { isTerminalSyncStatus, runningSyncs } from './types.js';
import { collectTier1Museums } from './museum/pipeline.js';
import { fetchEntityDetails, isQid, type SparqlFn } from './museum/queries.js';
import { ICONIC_SITELINKS, ICONIC_RELEASE } from './museum/tier1.js';
import {
  delay,
  WaitBudget,
  SPARQL_DELAY_MS,
  SPARQL_WAIT_BUDGET_MS,
  waitMessage,
  WIKIDATA_USER_AGENT,
  wikidataDoor,
  type SparqlBinding,
} from './wikidataUtils.js';
import {
  fetchCommonsCredits,
  readStoredCredits,
  creditToWrite,
  type ImageCredit,
  type StoredCredit,
} from './imageCredit.js';
// Museums use remote Wikimedia URLs, no local image storage

const MUSEUM_CATEGORY_ID = 2;
const ENTITY_BATCH = 50;

const LOG_PREFIX = '[Museum Sync]';

/**
 * The same door, but it tells the screen when it is waiting for Wikidata.
 *
 * The collection phase has no denominator — nothing knows how many museums there
 * are until the pool comes back — so the bar sits at zero for all of it, and a
 * run waiting out a bad quarter-hour is indistinguishable from a run that has
 * hung. Run 61 was exactly that: over a minute of backoff, visible only in a
 * container log, and then a failure.
 *
 * The sentence is written for the person watching rather than for the log: what
 * the service said, which attempt this is, how long until the next one, and how
 * much of the budget is gone — so "it is stuck" becomes "it is waiting, and it
 * will stop waiting at some point I can predict".
 */
function pacedSparql(progress: SyncProgress): (query: string) => Promise<SparqlBinding[]> {
  // One budget for the whole run, spent by whichever queries need it. Per query
  // it would be arithmetic nobody meant: a collection sends a few hundred, and a
  // quarter of an hour of patience each is hours of a run nobody is watching.
  return wikidataDoor(progress, new WaitBudget(SPARQL_WAIT_BUDGET_MS), LOG_PREFIX);
}

/**
 * The same door again, with the answers kept.
 *
 * Two reasons, and the second is the one that matters today. Their front end
 * caches nothing we send, because we POST — so a class closure that has not
 * moved in months is recomputed by their cluster on every run. And a collection
 * that fails in its third phase currently starts the next attempt at the first:
 * run 61 threw away 1166 artwork classes it had already paid for.
 *
 * `refreshCache` turns it off for one run, which is the point of the button: a
 * cache nobody can bypass is a fork of reality. A hit says so on screen, because
 * an admin who cannot tell a cached phase from a fetched one will eventually
 * debug an answer from last week.
 */
function collectingSparql(
  progress: SyncProgress, refreshCache: boolean,
): (query: string, descriptor?: CacheDescriptor) => Promise<SparqlBinding[]> {
  return withCache(pacedSparql(progress), {
    categoryId: MUSEUM_CATEGORY_ID,
    enabled: !refreshCache,
    onHit: (descriptor, rows) => {
      progress.statusMessage = `${descriptor.label}: ${rows} rows, from cache`;
    },
  });
}

// =============================================================================
// Fetch
// =============================================================================

/**
 * Where the last run left each work.
 *
 * Read from what is actually stored rather than from a record of the previous proposal, because
 * that is what the placement diff has to be measured against: a work the database holds under a
 * museum this run no longer names is the thing worth printing.
 */
async function readPreviousPlacements(): Promise<Record<string, string[]>> {
  const result = await pool.query(
    `SELECT t.external_id AS work, e.external_id AS venue
       FROM experience_treasures et
       JOIN treasures t ON t.id = et.treasure_id
       JOIN experiences e ON e.id = et.experience_id
      WHERE e.category_id = $1`,
    [MUSEUM_CATEGORY_ID],
  );
  const placements: Record<string, string[]> = {};
  for (const row of result.rows as { work: string; venue: string }[]) {
    const held = placements[row.work] ?? [];
    held.push(row.venue);
    placements[row.work] = held;
  }
  return placements;
}

/**
 * Credits for this run's venue photographs, keyed by image URL.
 *
 * Module state for the same reason the UNESCO run keeps its Wikipedia links that
 * way: the orchestrator hands `processItem` one museum at a time, and asking
 * Commons per museum would be 128 requests where three will do.
 */
let imageCredits = new Map<string, ImageCredit>();

/** What each museum's row already says about who took its picture, by external id. */
let storedCredits = new Map<string, StoredCredit>();

/** This run's credit, or the one already stored. The rule lives in `imageCredit.ts`. */
function creditPatch(externalId: string, imageUrl: string | null): { imageCredit?: ImageCredit | null } {
  return creditToWrite(
    imageUrl ? imageCredits.get(imageUrl) : undefined,
    storedCredits.get(externalId),
    imageUrl,
  );
}


async function fetchMuseumItems(
  progress: SyncProgress,
  refreshCache: boolean,
): Promise<{ items: CollectedMuseum[]; fetchedCount: number; filtered: FilteredEntity[] }> {
  const previousPlacements = await readPreviousPlacements();
  imageCredits = new Map();
  storedCredits = await readStoredCredits(MUSEUM_CATEGORY_ID);

  const { items, fetched, filtered } = await collectTier1Museums({
    // The reporting door for the long half: everything in `collectTier1Museums`
    // runs before the first museum is written, which is where a wait is
    // invisible — and where an answer is worth keeping, since a collection that
    // fails late otherwise starts the next attempt at its first phase.
    sparql: collectingSparql(progress, refreshCache),
    previousPlacements,
    onPhase: (message) => { progress.statusMessage = message; },
    checkCancel: () => {
      if (progress.cancel) throw new Error('Sync cancelled');
    },
    pause: () => delay(SPARQL_DELAY_MS),
  });

  // Whose photographs these are. Asked after the collection rather than during
  // it: only the admitted venues are worth crediting, which is 128 files in
  // three requests instead of one per candidate the pool ever named.
  progress.statusMessage = 'Asking Commons who took the pictures...';
  const creditBudget = new WaitBudget(SPARQL_WAIT_BUDGET_MS);
  imageCredits = await fetchCommonsCredits(items.map((m) => m.details?.imageUrl), {
    userAgent: WIKIDATA_USER_AGENT,
    // Its own patience: the collection's is spent by the time this runs.
    budget: creditBudget,
    isCancelled: () => progress.cancel,
    onWait: (wait) => {
      progress.statusMessage = waitMessage('Commons', wait, creditBudget);
    },
    pause: () => delay(SPARQL_DELAY_MS),
  });

  return { items, fetchedCount: fetched, filtered };
}

// =============================================================================
// Write
// =============================================================================

/**
 * Upsert a museum as an experience.
 *
 * `category` is the venue type, not UNESCO's triple: this category holds art museums and says
 * so. `country` is deliberately absent from the metadata — `country_names` already carries it,
 * and when both existed they disagreed.
 */
async function upsertMuseumExperience(
  museum: CollectedMuseum,
  context: SyncRunContext,
): Promise<{ experienceId: number; changeSet: ChangeSetResult; nameSnapshot: string;
             returnedFromMissing: boolean; locations?: ContentsDelta }> {
  const details = museum.details!;

  // Total sitelinks across all artworks as a ranking metric
  const totalSitelinks = museum.artworks.reduce((sum, a) => sum + a.sitelinksCount, 0);

  const metadata = {
    wikidataQid: museum.qid,
    website: details.website,
    wikipediaUrl: details.articleUrl || null,
    artworkCount: museum.artworks.length,
    totalArtworkSitelinks: totalSitelinks,
    // The reason this row exists, nameable: the most famous iconic work it holds.
    admittedFor: museum.admittedFor ?? null,
    // The picture is served from Commons and taken by somebody, usually under a
    // licence whose one condition is that they are named. What goes here is what
    // this run fetched, or the row's own credit where the picture has not
    // changed — never the one from a different photograph. See `creditToWrite`.
    ...creditPatch(museum.qid, details.imageUrl),
  };

  // Store remote Wikimedia URL directly (thumbnailing handled by frontend)
  const imageUrl = details.imageUrl || null;

  const { experienceId, changeSet, nameSnapshot, returnedFromMissing } = await upsertExperienceRecord({
    categoryId: MUSEUM_CATEGORY_ID,
    externalId: museum.qid,
    name: details.museumLabel,
    nameLocal: { en: details.museumLabel },
    description: details.description,
    shortDescription: null,
    category: 'art',
    tags: ['museum'],
    lon: details.lon!,
    lat: details.lat!,
    countryCodes: [],
    countryNames: details.countryLabel ? [details.countryLabel] : [],
    imageUrl,
    metadata,
  }, { dryRun: context.dryRun, syncLogId: context.syncLogId });

  // Undefined on a preview, which writes no point and so has none to report — as
  // against an empty delta, which says the question was asked (ADR-0026).
  let locations: ContentsDelta | undefined;

  if (!context.dryRun) {
    // Every museum admitted here holds a work above the iconic threshold, so the flag is a
    // property of belonging to this category rather than a field the source proposes — which is
    // why it is written here and not through the curated_fields-aware upsert.
    //
    // It still honours the same guard by hand. Nothing sets `is_iconic` by hand today, so there
    // is nothing to overwrite yet; the moment a curation surface exists, a run without this
    // would restore `true` over a curator's `false` every time, and since the write is outside
    // the changeset the run's own record would not show the flip. COALESCE because the column
    // is nullable and `NULL ? 'x'` is NULL, which would skip the row rather than write it.
    await pool.query(
      `UPDATE experiences SET is_iconic = true
        WHERE id = $1 AND NOT is_iconic
          AND NOT COALESCE(curated_fields ? 'is_iconic', false)`,
      [experienceId],
    );

    const written = await upsertSingleLocation(experienceId, museum.qid, details.lon!, details.lat!);
    // Registered here rather than returned: `upsertMuseumTreasures` runs after
    // this and can throw, and a returned field would be lost with it while the
    // point had already moved on disk.
    if (written.needsAssignment.length > 0 || written.unoffered > 0) {
      context.onLocationsChanged(experienceId);
    }
    locations = written.delta;
  }

  return { experienceId, changeSet, nameSnapshot, returnedFromMissing, locations };
}

/**
 * Upsert artworks as treasures and link to experience via junction table.
 *
 * `is_iconic` is sticky on the way down: a work joins the highlights at `ICONIC_SITELINKS` and
 * only leaves below `ICONIC_RELEASE`, so the badge does not flicker on and off as Wikipedia
 * grows. Selection upstream uses the single threshold; only the stored flag has hysteresis.
 *
 * Returns what the museum gained and what the run rewrote about what it already
 * held, named (ADR-0026). `withdrawn` and `returned` are always empty and that is
 * the decision, not an omission: nothing unlinks a work, because no contents
 * coverage floor exists for treasures and a run that under-fetched would take
 * real works off the walls and report success.
 *
 * `changed` is the one arm computed per work, and its contract is the part a
 * caller cannot see: the "after" side is the **source's offer**, not the row the
 * upsert wrote. That is what makes `curatedConflict` reachable for a work at all
 * — the upsert's own `CASE` writes a claimed value back over itself, so against
 * the written row a claimed field equals itself and the refusal disappears. The
 * comparison is argued where it happens, in the loop below.
 *
 * Exported for its test as well as for the sync: one of its promises lives in a
 * parameter number, which no caller can observe.
 */
export async function upsertMuseumTreasures(
  experienceId: number,
  artworks: ProcessedContent[]
): Promise<ContentsDelta> {
  const added: ContentItem[] = [];
  const changed: ContentItemChange[] = [];

  // What the run is about to write over, read once for the whole museum rather
  // than once per work. The upsert cannot answer this itself — it is a single
  // `INSERT … ON CONFLICT` and `RETURNING` gives back the new values — and
  // without a "before" there is nothing to compare, so a source rewriting a
  // title or an attribution would land silently on a work a curator has already
  // passed. The claim set comes with it, because a field the source proposed and
  // the guard above refused is the *reason* to report rather than a case to skip.
  const refs = artworks.map(a => a.externalId);
  const before = new Map<string, {
    name: string | null; artist: string | null; year: number | null;
    imageUrl: string | null; curatedFields: string[];
  }>();
  if (refs.length > 0) {
    const stored = await pool.query(
      `SELECT external_id, name, artist, year, image_url, curated_fields
         FROM treasures WHERE external_id = ANY($1::text[])`,
      [refs],
    );
    for (const row of stored.rows) {
      before.set(row.external_id, {
        name: row.name, artist: row.artist, year: row.year,
        imageUrl: row.image_url, curatedFields: row.curated_fields ?? [],
      });
    }
  }

  for (const artwork of artworks) {
    // Step 1: Upsert into treasures (globally unique by external_id)
    //
    // `curation_state` is bound to `MUSEUM_CATEGORY_ID` directly rather than
    // reached through an experience: a treasure is globally shared and is not
    // owned by any one of them. It is set on insert only — absent from
    // `DO UPDATE SET` — because a work already stored may already have been
    // passed by a curator, and this run must not reset that (ADR-0025).
    const treasureResult = await pool.query(
      `INSERT INTO treasures (
        external_id, name, treasure_type, artist, year,
        image_url, sitelinks_count, is_iconic, metadata, curation_state, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
        CASE WHEN (SELECT requires_curation FROM experience_categories WHERE id = $12)
             THEN 'pending' ELSE 'auto' END,
        NOW(), NOW())
      ON CONFLICT (external_id) DO UPDATE SET
        -- Four of these are things a curator can be right about, and the guard is
        -- the one an experience's columns have carried since #488: a claimed field
        -- keeps what was decided, and everything else still follows the source.
        -- sitelinks_count and is_iconic are outside it deliberately -- a count and a
        -- threshold on that count are a measurement, not a judgement -- and so is
        -- external_id, which is identity and is the conflict target above.
        name = CASE WHEN treasures.curated_fields ? 'name' THEN treasures.name ELSE EXCLUDED.name END,
        treasure_type = EXCLUDED.treasure_type,
        artist = CASE WHEN treasures.curated_fields ? 'artist' THEN treasures.artist ELSE EXCLUDED.artist END,
        year = CASE WHEN treasures.curated_fields ? 'year' THEN treasures.year ELSE EXCLUDED.year END,
        image_url = CASE WHEN treasures.curated_fields ? 'image_url'
                         THEN treasures.image_url ELSE EXCLUDED.image_url END,
        sitelinks_count = EXCLUDED.sitelinks_count,
        is_iconic = CASE
          WHEN EXCLUDED.sitelinks_count >= $10 THEN true
          WHEN treasures.is_iconic THEN EXCLUDED.sitelinks_count >= $11
          ELSE false
        END,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      -- The name beside the id because a link is named by what the catalogue
      -- calls the work, which on a claimed field is not what the source sent.
      -- Nothing else off this row: the comparison that reports a rewrite reads
      -- the pre-run snapshot instead, and taking its claim set from here would be
      -- taking it from the statement that already honoured it.
      RETURNING id, name`,
      [
        artwork.externalId,
        artwork.name,
        artwork.treasureType,
        artwork.artist,
        artwork.year,
        artwork.imageUrl,
        artwork.sitelinksCount,
        artwork.sitelinksCount >= ICONIC_SITELINKS,
        null, // metadata
        ICONIC_SITELINKS,
        ICONIC_RELEASE,
        MUSEUM_CATEGORY_ID,
      ]
    );

    const stored = treasureResult.rows[0];
    const treasureId = stored.id;

    // What this run did to a work it already held, or tried to.
    //
    // **The "after" is the source's offer, not the row the statement wrote** —
    // the same pair `keptChanges` compares for a point, and for the same reason.
    // The upsert's own `CASE` keeps the stored value wherever a claim holds, so a
    // claimed field written back over itself compares equal: read from the
    // written row, exactly the refusals worth reporting are the ones that
    // disappear, and `curatedConflict` could never be true for a work. Read from
    // the offer, a claim marks the entry rather than erasing it.
    //
    // A work the run has just inserted has no "before" and is an arrival, which
    // `added` below carries.
    const was = before.get(artwork.externalId);
    if (was) {
      const fields = workChanges(was, {
        name: artwork.name, artist: artwork.artist, year: artwork.year, imageUrl: artwork.imageUrl,
      }, was.curatedFields);
      if (fields.length > 0) {
        changed.push({ item: { name: was.name, ref: artwork.externalId }, fields });
      }
    }

    // Step 2: Link treasure to experience via junction table. Unlike the
    // treasure above, a link does have an experience to read the gate through,
    // so it is reached the same way the location insert reaches it. Links are
    // never deleted (ADR-0023), so a link a curator already passed must keep
    // that state when a later run finds it again — insert-only, same as above.
    const link = await pool.query(
      `INSERT INTO experience_treasures (experience_id, treasure_id, curation_state)
       VALUES ($1, $2,
         CASE WHEN (SELECT c.requires_curation
                      FROM experiences e JOIN experience_categories c ON c.id = e.category_id
                     WHERE e.id = $1)
              THEN 'pending' ELSE 'auto' END)
       ON CONFLICT (experience_id, treasure_id) DO NOTHING
       RETURNING treasure_id`,
      [experienceId, treasureId]
    );
    // `DO NOTHING` returns no row when the link was already there, so this is
    // "the museum gained a work", not "the run mentioned one".
    //
    // Named from the row the statement wrote, not from the artwork in hand: on a
    // work whose name a curator has claimed those are different strings, and the
    // one a reader will see is the stored one. Reporting the source's title for a
    // link to a work the catalogue calls something else names a work nobody can
    // find.
    if (link.rows.length > 0) added.push({ name: stored.name, ref: artwork.externalId });
  }

  // Once for the museum rather than once per painting: the fact is that a
  // curator's pass no longer covers everything on show, and it is the same fact
  // whether one work arrived or twelve.
  if (added.length > 0) await retirePassAfterNewContent(pool, experienceId);

  // `changed` is expected to be empty most runs and is still computed: 120 works
  // re-asked of Wikidata on 2026-08-20, eleven days after import, differed in
  // name, artist, year and image exactly zero times. That measurement says how
  // often a card will appear, not whether the run should be able to raise one —
  // the axis that moves for a work is which venue holds it, and the day a source
  // does rewrite an attribution is the day a curator needs to hear about it
  // rather than the day we discover the run could not say.
  return { added, withdrawn: [], returned: [], changed };
}

/**
 * Process a single museum: upsert experience + treasures
 */
async function processMuseum(
  museum: CollectedMuseum,
  _progress: SyncProgress,
  context: SyncRunContext,
): Promise<ProcessItemResult> {
  const { experienceId, changeSet, nameSnapshot, returnedFromMissing, locations } =
    await upsertMuseumExperience(museum, context);

  // Treasures hang off a row a preview never wrote.
  let treasures: ContentsDelta | undefined;
  if (!context.dryRun) {
    treasures = await upsertMuseumTreasures(experienceId, museum.artworks);
  }

  return {
    outcome: changeSet.changeType,
    // 0 is previewUpsert's stand-in for a row that does not exist yet and would
    // violate the FK; a real id is worth keeping even in a preview.
    experienceId: experienceId || null,
    nameSnapshot,
    changeSet,
    returnedFromMissing,
    // Both kinds a museum holds, from the two writers that touched them. The
    // recorder drops whichever did nothing, so a venue that only gained a
    // painting carries no points key at all.
    contents: { locations, treasures },
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Main sync function - fetches top museums from Wikidata and upserts to database
 */
export function syncMuseums(
  triggeredBy: number | null,
  options: { dryRun?: boolean; refreshCache?: boolean } = {},
): Promise<void> {
  return orchestrateSync<CollectedMuseum>({
    categoryId: MUSEUM_CATEGORY_ID,
    logPrefix: LOG_PREFIX,
    // The list length is a property of the data — the museums holding an iconic work — but it
    // is still a fame ranking: a museum absent from a run lost the work that admitted it, which
    // says nothing about whether it still exists.
    sourceCompleteness: 'ranked',
    // It does, however, say that the museum is not one of ours. Every run
    // recomputes the whole membership from the whole pool rather than fetching a
    // published list, so absence from the admitted set is this category's own
    // decision and belongs on the admission axis (ADR-0024) — which is a
    // different question from whether the place still exists, and is why both
    // lines stand together.
    recomputesMembership: true,
    // The one place the run's options reach the collection: everything else the
    // orchestrator threads for us, but the cache is a property of *this* run
    // rather than of the category.
    fetchItems: (progress) => fetchMuseumItems(progress, options.refreshCache === true),
    processItem: processMuseum,
    getItemName: (m) => m.details?.museumLabel || m.label,
    getItemId: (m) => m.qid,
  }, triggeredBy, options);
}

/**
 * Get current museum sync status
 */
export function getMuseumSyncStatus() {
  return getSyncStatus(MUSEUM_CATEGORY_ID);
}

/**
 * Cancel running museum sync
 */
export function cancelMuseumSync() {
  return cancelSync(MUSEUM_CATEGORY_ID);
}

/** Wikimedia image URLs for a set of museum QIDs, batched. */
async function fetchMuseumImages(
  qids: string[],
  progress: SyncProgress,
): Promise<Map<string, string>> {
  const images = new Map<string, string>();
  // The same door as every other query this service sends. It used to be a bare
  // `sparqlQuery` with none of the three: no cancel check, no reporter, and no
  // shared budget — so `sparqlQuery` minted a fresh fifteen minutes *per batch*.
  // At `ENTITY_BATCH = 50` that is hours for a few hundred museums, none of it
  // interruptible, while `runningSyncs` shows the card as running with a Cancel
  // button on it. Raising the retry ceiling is what made the arithmetic bite.
  const door = wikidataDoor(progress, new WaitBudget(SPARQL_WAIT_BUDGET_MS), LOG_PREFIX);
  // `SparqlFn`'s second parameter is a cache descriptor and the door's is a
  // retry count, so the two signatures cannot be passed for each other. This
  // pass describes no question and caches nothing, which is why the descriptor
  // is dropped rather than forwarded.
  const sparql: SparqlFn = (query) => door(query);
  for (let i = 0; i < qids.length; i += ENTITY_BATCH) {
    if (progress.cancel) throw new Error('Sync cancelled');
    progress.statusMessage =
      `Fetching image URLs from Wikidata (${Math.min(i + ENTITY_BATCH, qids.length)}/${qids.length})...`;
    const details = await fetchEntityDetails(sparql, qids.slice(i, i + ENTITY_BATCH));
    for (const [qid, row] of details) {
      if (row.imageUrl) images.set(qid, row.imageUrl);
    }
    if (i + ENTITY_BATCH < qids.length) await delay(SPARQL_DELAY_MS);
  }
  return images;
}

/**
 * Fix missing museum images - re-download images for museums that have a
 * Wikidata image URL but no local image file.
 */
/**
 * Write every picture this action found, and report what happened to each row.
 *
 * Three outcomes rather than two, because they have different causes and only
 * one of them is a problem: `fixed` is a picture written, `failed` is a museum
 * Wikidata offered none for, and `kept` is a row whose picture a curator owns.
 * Folding the last into either of the others would blame the source for a
 * person's decision, or claim a write that never happened.
 */
async function writeFixedImages(
  museums: { id: number; external_id: string; name: string }[],
  images: Map<string, string>,
  credits: Map<string, ImageCredit>,
  progress: SyncProgress,
): Promise<{ fixed: number; failed: number; kept: number }> {
  let fixed = 0;
  let failed = 0;
  let kept = 0;

  for (let i = 0; i < museums.length; i++) {
    if (progress.cancel) throw new Error('Sync cancelled');

    const museum = museums[i];
    const imageUrl = images.get(museum.external_id);
    progress.currentItem = museum.name;
    progress.statusMessage = `Fixing ${i + 1}/${museums.length}: ${museum.name}`;
    progress.progress = i + 1;

    if (!imageUrl) {
      failed++;
      continue;
    }
    if (await writeFixedImage(museum.id, imageUrl, credits.get(imageUrl))) fixed++;
    else kept++;
  }

  return { fixed, failed, kept };
}

/**
 * Who took the pictures this action is about to put on cards.
 *
 * Asked before the write loop rather than per row: it is one batch of up to
 * fifty files per request either way, and a card must never appear with a
 * photograph and no name — the standing rule is that anything displaying an
 * experience picture shows the credit with it.
 */
async function creditsForFixedImages(
  imageUrls: string[],
  progress: SyncProgress,
): Promise<Map<string, ImageCredit>> {
  progress.statusMessage = 'Asking Commons who took the pictures...';
  const budget = new WaitBudget(SPARQL_WAIT_BUDGET_MS);
  return fetchCommonsCredits(imageUrls, {
    userAgent: WIKIDATA_USER_AGENT,
    budget,
    isCancelled: () => progress.cancel,
    // Nothing else writes the status between the SPARQL pass and the write
    // loop, so without this a bad day at Commons is a sentence frozen on the
    // panel for as long as the budget lasts — the hung-looking run this whole
    // change set exists to stop showing.
    onWait: (wait) => { progress.statusMessage = waitMessage('Commons', wait, budget); },
    pause: () => delay(SPARQL_DELAY_MS),
  });
}

/**
 * Write one museum's picture and its credit, unless a curator owns the picture.
 *
 * Answers whether the row was written. Guarded the way the `is_iconic` write is,
 * and for the same reason: a curator can clear a wrong photograph (`imageUrl: ''`
 * is an accepted edit), which claims `image_url` and leaves a row this action's
 * own WHERE selects — so without the clause, the next click puts Wikidata's
 * picture back over that decision. `COALESCE` because `curated_fields` is
 * nullable and `NULL ? 'x'` is NULL, which would skip every unclaimed row
 * rather than write it.
 *
 * The credit goes in the same statement, so no moment exists in which the card
 * shows a photograph nobody is named for — and it is **omitted** rather than
 * written as `null` where Commons could not answer, because a stored null is
 * what the next run's catch-all diff reports as a change, for the removal of a
 * nothing.
 */
async function writeFixedImage(
  experienceId: number,
  imageUrl: string,
  credit: ImageCredit | undefined,
): Promise<boolean> {
  const written = await pool.query(
    `UPDATE experiences
        SET image_url = $1,
            metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
            updated_at = NOW()
      WHERE id = $3
        AND NOT COALESCE(curated_fields ? 'image_url', false)`,
    [imageUrl, JSON.stringify(credit ? { imageCredit: credit } : {}), experienceId],
  );
  return (written.rowCount ?? 0) > 0;
}

export async function fixMuseumImages(_triggeredBy: number | null): Promise<void> {
  // Check if already running
  const existing = runningSyncs.get(MUSEUM_CATEGORY_ID);
  if (existing && !isTerminalSyncStatus(existing.status)) {
    throw new Error('Museum sync already in progress');
  }

  const progress: SyncProgress = {
    cancel: false,
    status: 'processing',
    statusMessage: 'Fixing missing museum images...',
    progress: 0,
    total: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    missing: 0,
    curatedConflicts: 0,
    filtered: 0,
    errors: 0,
    currentItem: '',
    logId: null,
    dryRun: false,
  };
  runningSyncs.set(MUSEUM_CATEGORY_ID, progress);

  try {
    // Find museums missing images or with old local paths
    const result = await pool.query(`
      SELECT id, external_id, name, metadata
      FROM experiences
      WHERE category_id = $1
        AND (image_url IS NULL OR image_url = '' OR image_url LIKE '/images/%')
        AND metadata IS NOT NULL
    `, [MUSEUM_CATEGORY_ID]);

    const museums = result.rows;
    progress.total = museums.length;
    progress.statusMessage = `Found ${museums.length} museums without images`;
    console.log(`[Museum Sync] Fix images: ${museums.length} museums missing images`);

    if (museums.length === 0) {
      progress.status = 'complete';
      progress.statusMessage = 'All museums already have images';
      return;
    }

    // Re-fetch image URLs from Wikidata for these museums.
    //
    // Filtered to real QIDs: a curator can create a museum by hand, and its key
    // is `curator-<id>-<ts>`, which interpolates into the VALUES clause as
    // `wd:curator-5-1754…` and makes Wikidata reject the whole batch — so one
    // hand-made row would cost every other museum on the page its image.
    const qids = museums
      .map((m: { external_id: string }) => m.external_id)
      .filter(isQid);
    progress.statusMessage = 'Fetching image URLs from Wikidata...';
    const images = await fetchMuseumImages(qids, progress);

    const credits = await creditsForFixedImages([...images.values()], progress);

    const { fixed, failed, kept } = await writeFixedImages(museums, images, credits, progress);

    progress.status = 'complete';
    progress.created = fixed;
    progress.errors = failed;
    const curated = kept > 0 ? `, ${kept} left as the curator set them` : '';
    progress.statusMessage = `Fixed images: ${fixed} updated, ${failed} no image found${curated}`;
    console.log(`[Museum Sync] Fix images complete: ${fixed} updated, ${failed} no image found${curated}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    progress.status = progress.cancel ? 'cancelled' : 'failed';
    progress.statusMessage = errorMsg;
    console.error(`[Museum Sync] Fix images failed:`, errorMsg);
    throw err;
  } finally {
    const thisProgress = progress;
    setTimeout(() => {
      if (runningSyncs.get(MUSEUM_CATEGORY_ID) === thisProgress) {
        runningSyncs.delete(MUSEUM_CATEGORY_ID);
      }
    }, 30000);
  }
}
