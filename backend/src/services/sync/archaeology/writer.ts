/**
 * Writing what one archaeology run decided: the museum with its finds, the site
 * with the outline OpenStreetMap drew around it, and the one dispatch between
 * them.
 *
 * A file of its own because `archaeologySyncService.ts` is the run — the doors,
 * the lines, the collection, the coverage floor — and this is what happens to
 * one row once all of that has been decided. The service was past the length
 * anybody reads at once, and the seam is the obvious one: everything here takes
 * an item and a run context and touches the database; everything there answers
 * "what did this run learn".
 *
 * **What the collection learned lives here too** (`rememberRun`), for the
 * reason it was module state in the first place: the orchestrator hands one
 * item at a time to `processItem`, and the credits, the placements and the
 * finds' line were all read once for the whole run. The fetch step hands them
 * over before the first write, and a writer that reads one before it has been
 * handed over says so rather than guessing (`theFindsLine`).
 */

import { upsertExperienceRecord, upsertSingleLocation } from '../syncUtils.js';
import type { ProcessItemResult, SyncRunContext } from '../syncContract.js';
import type { SyncProgress, ContentsDelta } from '../types.js';
import type { LinePair } from '../sourceLine.js';
import { upsertVenueTreasures } from '../museum/treasureWriter.js';
import { creditToWrite, type ImageCredit, type StoredCredit } from '../imageCredit.js';
import type { CollectedArchaeologyItem, CollectedArchaeologyMuseum } from './pipeline.js';
import type { CollectedArchaeologySite } from './proposal.js';

const ARCHAEOLOGY_SOURCE_ID = 5;

const LOG_PREFIX = '[Archaeology Sync]';

/**
 * Credits for every photograph this run shows, keyed by image URL: the museums'
 * and their finds' alike, filled by one call in `fetchArchaeologyItems`.
 *
 * Both in one map deliberately — it is what stops the Rosetta Stone and the
 * British Museum crediting the same file differently — which is why
 * `processMuseum` hands this same map to `upsertVenueTreasures`.
 *
 * Module state for the reason the museum run keeps its credits that way: the
 * orchestrator hands `processItem` one museum at a time, and asking Commons per
 * museum would be one request each where a handful covers them all.
 */
let imageCredits = new Map<string, ImageCredit>();

/** What each museum's row already says about who took its picture, by external id. */
let storedCredits = new Map<string, StoredCredit>();

/**
 * The same for what stands inside it, by the find's own id.
 *
 * Separate from the museums' map and not merged into it: both are keyed by a
 * Wikidata QID, and a museum and a find are different rows in different tables
 * that can hold different pictures.
 */
let storedTreasureCredits = new Map<string, StoredCredit>();

/**
 * Where this run places each find, by the find's id: the admitted museums
 * holding it in the proposal. Built once in `fetchArchaeologyItems` and read
 * per museum in `processMuseum`, for the hold on a moved find's old link
 * (ADR-0044 decision 5): the museum it moved to may be written after the one it
 * left, so the writer cannot learn from the table alone that a new museum is
 * coming.
 */
let placedThisRun = new Map<string, Set<string>>();

/**
 * The line this run's finds are judged by, read off the source row with the
 * museums' own and handed to the treasure writer.
 *
 * Module state for the reason the credits are: the orchestrator hands
 * `processItem` one museum at a time, and the row is read once at the start of
 * the run (`fetchArchaeologyItems`) rather than per museum. Carried at all
 * because the museum's badge is read at this line, so the find's own must-see
 * flag has to be read at it too (ADR-0023 decision 2).
 */
let findsLine: LinePair | undefined;

/**
 * That line, or the run's own mistake said out loud.
 *
 * Never a default: the art museums' 22/18 is a *different* catalogue's line,
 * and a run that fell back to it would badge this kind's museums at 18 and
 * their finds at 22 — silently, on rows nothing later re-reads. The
 * orchestrator always fetches before it writes, so this cannot happen to a real
 * run; it names the miss rather than papering over it for the one caller that
 * could get the order wrong.
 */
function theFindsLine(): LinePair {
  if (!findsLine) {
    throw new Error(`${LOG_PREFIX} the finds line was never read: fetchItems runs before any write`);
  }
  return findsLine;
}

/**
 * The finds this run places at another admitted museum and not at this one.
 * What the writer holds a visible link for while the new museum is unread.
 */
function placedElsewhereFor(museumQid: string): string[] {
  const elsewhere: string[] = [];
  for (const [find, venues] of placedThisRun) {
    if (!venues.has(museumQid) && venues.size > 0) elsewhere.push(find);
  }
  return elsewhere;
}

/** This run's credit, or the one already stored. The rule lives in `imageCredit.ts`. */
function creditPatch(externalId: string, imageUrl: string | null): { imageCredit?: ImageCredit | null } {
  return creditToWrite(
    imageUrl ? imageCredits.get(imageUrl) : undefined,
    storedCredits.get(externalId),
    imageUrl,
  );
}

/**
 * What the collection learned, handed to the writers once per run.
 *
 * One call rather than five exported setters: these five facts are read
 * together, in one place, at one moment — after the collection and before the
 * first write — and a writer that saw four of them updated and the fifth stale
 * would badge a find at the wrong line or credit a photograph to the wrong
 * photographer.
 */
export function rememberRun(facts: {
  imageCredits: Map<string, ImageCredit>;
  storedCredits: Map<string, StoredCredit>;
  storedTreasureCredits: Map<string, StoredCredit>;
  placedThisRun: Map<string, Set<string>>;
  findsLine: LinePair;
}): void {
  imageCredits = facts.imageCredits;
  storedCredits = facts.storedCredits;
  storedTreasureCredits = facts.storedTreasureCredits;
  placedThisRun = facts.placedThisRun;
  findsLine = facts.findsLine;
}

/**
 * Write one archaeology museum: the experience, its point, and what it holds.
 *
 * The type is a word a reader filters the kind by, and for this door it is
 * always `museum` — the kind's other type is the site (ADR-0058 decision 1),
 * which arrives through another door. The tag beside `archaeology` is the same
 * word rather than a second copy of it in metadata (#814).
 *
 * The signal the nature was read off (`natureWhy`) is not stored: on a held row
 * the sentence a curator reads carries it already (`admissionNote`), and on an
 * admitted one it is the run's own bookkeeping, re-derived every pass.
 */
async function processMuseum(
  item: CollectedArchaeologyMuseum,
  _progress: SyncProgress,
  context: SyncRunContext,
): Promise<ProcessItemResult> {
  const metadata = {
    wikidataQid: item.qid,
    // Every class the rule read, what English Wikipedia files the article
    // under, the nature those two answered with, and the question a held row
    // asks: the run's own notes about its pass, so they go past the gate and
    // past a claim and no card is ever raised about them
    // (`SYNC_OWNED_METADATA_KEYS`, #571). Wikipedia's editors re-file articles
    // constantly, and a curator asked to approve each re-filing would be
    // answering for the rule rather than about the museum.
    wikidataClasses: item.classes,
    wikipediaCategories: item.categories,
    archaeologyNature: item.nature,
    admissionNote: item.admissionNote,
    sitelinksCount: item.sitelinks,
    artworkCount: item.treasures.length,
    totalArtworkSitelinks: item.treasures.reduce((sum, t) => sum + t.sitelinksCount, 0),
    website: item.website,
    wikipediaUrl: item.articleUrl || null,
    // The picture comes from Commons and was taken by somebody, usually under a
    // licence that asks for them to be named. What goes here is what this run
    // fetched, or the row's own credit where the picture has not changed —
    // never the one from a different photograph. See `creditToWrite`.
    ...creditPatch(item.qid, item.imageUrl),
  };

  const { experienceId, changeSet, nameSnapshot, returnedFromMissing } = await upsertExperienceRecord({
    sourceId: ARCHAEOLOGY_SOURCE_ID,
    externalId: item.qid,
    name: item.label,
    nameLocal: { en: item.label },
    description: item.description,
    shortDescription: null,
    type: item.type,
    tags: ['archaeology', item.type],
    lon: item.lon,
    lat: item.lat,
    countryCodes: [],
    countryNames: item.countryLabel ? [item.countryLabel] : [],
    imageUrl: item.imageUrl,
    metadata,
    // The reason this membership exists, nameable: the most famous find the
    // museum holds, where a find is what carried it over the line. A museum
    // known in its own right is admitted for its own fame and names nothing.
    admittedFor: item.admittedFor ?? null,
  }, { dryRun: context.dryRun, syncLogId: context.syncLogId });

  // Undefined on a preview, which writes no point and so has none to report — as
  // against an empty delta, which says the question was asked (ADR-0026).
  let locations: ContentsDelta | undefined;
  let treasures: ContentsDelta | undefined;

  if (!context.dryRun) {
    // The must-see flag is not written here. It is a property of the find the
    // museum holds rather than a field the source proposes — the collector
    // counted them (`findsAboveLine`) and the orchestrator asks that count once
    // admission is settled, after the run's restore step (`markIconic`,
    // admission.ts), so a cancelled run never badges a row it did not re-admit
    // (#760).
    const written = await upsertSingleLocation(
      experienceId, item.qid, item.lon, item.lat, { syncLogId: context.syncLogId },
    );
    // Registered here rather than returned: `upsertVenueTreasures` runs after
    // this and can throw, and a returned field would be lost with it while the
    // point had already moved on disk.
    if (written.needsAssignment.length > 0 || written.unoffered > 0) {
      context.onLocationsChanged(experienceId);
    }
    locations = written.delta;

    // The floor's verdict goes with the run's id: the writer marks a link only
    // where the collector, up in `fetchArchaeologyItems`, saw enough of the
    // finds to vouch for what left. Each find carries where it was dug up, and
    // the writer stores that beside its picture credit (ADR-0058 decision 3).
    treasures = await upsertVenueTreasures(
      experienceId,
      item.treasures,
      { fetched: imageCredits, stored: storedTreasureCredits },
      {
        syncLogId: context.syncLogId,
        withdrawalSkippedReason: context.withdrawalSkippedReason,
        sourceId: ARCHAEOLOGY_SOURCE_ID,
        // The line the museum's own badge was read at, so the find's must-see
        // flag cannot disagree with it about the same find (ADR-0023 decision 2).
        iconicLine: theFindsLine(),
      },
      placedElsewhereFor(item.qid),
    );
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
    // recorder drops whichever did nothing, so a museum that only gained a find
    // carries no points key at all.
    contents: { locations, treasures },
  };
}

/**
 * Write one archaeological site: the experience, its point, and the outline
 * OpenStreetMap drew around it.
 *
 * No treasures. What was dug up here is in a museum somewhere else, and the
 * link from a find's `foundAt` to the site row it names is its own ticket — a
 * site's card lists nothing today, and says so by having nothing to list rather
 * than by an empty heading.
 *
 * The OSM reading rides on `metadata.osm`, which the change set owns: it is the
 * run's own measurement, stamped with the date it was read, and it is what
 * makes the OSM-derived part of this row nameable and extractable (ADR-0059
 * decision 2).
 */
async function processSite(
  item: CollectedArchaeologySite,
  _progress: SyncProgress,
  context: SyncRunContext,
): Promise<ProcessItemResult> {
  const metadata = {
    wikidataQid: item.qid,
    wikidataClasses: item.classes,
    sitelinksCount: item.sitelinks,
    website: item.website,
    wikipediaUrl: item.articleUrl || null,
    // Kept separable, with the object, the tag and the date beside the value
    // (ADR-0059 decision 2). Nothing else on this row comes from OSM.
    osm: item.osm,
    // The question a row the tree did not vouch for asks a curator (#895),
    // under the museum row's key so the card reads both the same way — and
    // null, never absent, on a row with none: the upsert's held arm merges
    // only the keys the run sent, so a key dropped would leave the last
    // run's note standing on a site whose item has since gained a class.
    admissionNote: item.admissionNote ?? null,
    ...creditPatch(item.qid, item.imageUrl),
  };

  const { experienceId, changeSet, nameSnapshot, returnedFromMissing } = await upsertExperienceRecord({
    sourceId: ARCHAEOLOGY_SOURCE_ID,
    externalId: item.qid,
    name: item.label,
    nameLocal: { en: item.label },
    description: item.description,
    shortDescription: null,
    type: item.type,
    tags: ['archaeology', item.type],
    lon: item.lon,
    lat: item.lat,
    countryCodes: [],
    countryNames: item.countryLabel ? [item.countryLabel] : [],
    imageUrl: item.imageUrl,
    metadata,
    // The shape a reader sees drawn around the place, where OSM has one. Null
    // for a site mapped as a point, which is most of them.
    boundaryWkt: item.extentWkt,
    // A site enters on its own fame and is admitted for nothing else
    // (ADR-0058 decision 4).
    admittedFor: null,
  }, { dryRun: context.dryRun, syncLogId: context.syncLogId });

  // Undefined on a preview, which writes no point and so has none to report.
  let locations: ContentsDelta | undefined;
  if (!context.dryRun) {
    const written = await upsertSingleLocation(
      experienceId, item.qid, item.lon, item.lat, { syncLogId: context.syncLogId },
    );
    if (written.needsAssignment.length > 0 || written.unoffered > 0) {
      context.onLocationsChanged(experienceId);
    }
    locations = written.delta;
  }

  return {
    outcome: changeSet.changeType,
    experienceId: experienceId || null,
    nameSnapshot,
    changeSet,
    returnedFromMissing,
    contents: { locations },
  };
}

/** The kind's two types, each written by the door that admitted it. */
export function processItem(
  item: CollectedArchaeologyItem,
  progress: SyncProgress,
  context: SyncRunContext,
): Promise<ProcessItemResult> {
  return item.type === 'site'
    ? processSite(item, progress, context)
    : processMuseum(item, progress, context);
}

