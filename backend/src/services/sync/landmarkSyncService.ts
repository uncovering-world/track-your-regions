/**
 * Landmark Sync Service — the Public art and the Monuments & memorials sources.
 *
 * Collects the outdoor art and monuments the world knows, in stages
 * (`publicArt/pipeline.ts`), admits what each kind's rule admits and refuses
 * what it refuses with the reason on the row (ADR-0024), keeps Wikidata's
 * answers between runs (ADR-0030), and writes each landmark as one experience
 * with one point. No grouping, and no treasures but a street-art place's
 * murals (#2055, `publicArt/streetArtWorks.ts`) — simpler than museums, and
 * since #754 the same shape.
 *
 * Each source is a member of the place pass (ADR-0132, `places/placePass.ts`):
 * the places are gathered once for every source of `PLACE_PASS`, and each of
 * these two decides from its kind's share by its kind's rule
 * (`publicArt/kindRules.ts`) and writes its own kind.
 */

import { readsSubset } from './subset/reader.js';
import { unreadOnSubset } from './subset/runDoor.js';
import { upsertExperienceRecord, upsertSingleLocation } from './syncUtils.js';
import { writeExperienceLocations } from './locationWriter.js';
import { medoidOf } from './anchorPoint.js';
import type { SyncProgress, WikidataLandmark, LandmarkCast, ContentsByKind } from './types.js';
import { getSyncStatus, cancelSync } from './syncOrchestrator.js';
import type { FetchResult, FilteredEntity, ProcessItemResult, SyncRunContext, SyncServiceConfig } from './syncContract.js';
import { admittedExternalIds } from './admission.js';
import { placesOtherSourcesOffer } from './shownElsewhere.js';
import {
  classifyPublicArt, monumentCategoryCandidates, noClassAdmits, PUBLIC_ART_KIND, publicArtVerdictOf, streetArtCandidates,
  type GatheredPublicArt,
} from './publicArt/pipeline.js';
import { categoryNote, filedAsMonument, readMonumentCategories } from './publicArt/monumentCategories.js';
import type { FiledAsMonument } from './publicArt/publicArtTest.js';
import { mergeSurroundings, surroundingsReader, type SurroundingsKind, type SurroundingsReader } from './places/surroundingsTier.js';
import { goneWorkReason, refuseGone, type StandingFacts } from './places/gone.js';
import { commemorationWiki, readCommemorates } from './places/commemorates.js';
import { worldHistory, type WorldHistory } from './places/worldMemory.js';
import { readStreetArt } from './publicArt/streetArtPlaces.js';
import { streetArtContents, type PlaceContents } from './publicArt/streetArtWorks.js';
import { shareOf, type GatheredPlaces, type PlaceGather } from './places/gather.js';
import { PUBLIC_CLOCK_CLASSES, STREET_ART_CLASSES, type PublicArtTrees } from './publicArt/classes.js';
import type { SparqlFn } from './wikidataQueries.js';
import { MONUMENTS_RULE, PUBLIC_ART_RULE, typeByDepicted, type KindRule } from './publicArt/kindRules.js';
import { PUBLIC_ART_SOURCES } from './passes.js';
import { SUBJECT_LINE_SOURCE_IDS } from '@tyr/shared/commemorates';
import { withCache, type CacheDescriptor } from './wikidataCache.js';
import {
  delay,
  WaitBudget,
  SPARQL_DELAY_MS,
  SPARQL_WAIT_BUDGET_MS,
  WIKIDATA_USER_AGENT,
  wikidataDoor,
  waitMessage,
} from './wikidataUtils.js';
import type { SparqlBinding } from './wikidataUtils.js';
import {
  fetchCommonsCredits,
  readStoredCredits,
  creditToWrite,
  type ImageCredit,
  type StoredCredit,
} from './imageCredit.js';

const LANDMARK_SOURCE_ID = 3;
const LOG_PREFIX = '[Landmark Sync]';

/**
 * What a source of the place pass decides by: its classifier over the gather,
 * the type vocabulary it files places under, and the tag its places carry
 * beside their type. A place with one point, written the same way whatever
 * its kind: Public art's and Monuments & memorials' here, every other place
 * kind's in its own `kind.ts`.
 */
export interface PlaceClassifier {
  /**
   * Decide from the gather; `admitted` is what the source holds as admitted
   * before the run, `sparql` the door the gather was read through, for what a
   * classifier asks beyond it, and `history` what the source's world tier last
   * read, for what this run cannot (ADR-0175 decision 6).
   */
  classify(gathered: GatheredPlaces, admitted: ReadonlySet<string>, sparql: SparqlFn, history?: WorldHistory): Promise<{
    items: WikidataLandmark[]; fetched: number; filtered: FilteredEntity[]; handOvers?: FilteredEntity[];
  }>;
  types: readonly string[];
  tag: string;
  /** The kind's surroundings tier (ADR-0171, #2178), read after the world tier's decision; absent for a kind without one. */
  surroundings?: SurroundingsReader;
  /** What the kind's places hold, where its places hold works: Public art's street-art places (#2055). */
  contents?: PlaceContents;
  /** How the kind reads a place Wikidata says is gone: a place's (`goneReason`, #2259) unless it names its own. */
  gone?: (facts: StandingFacts) => string | null;
  /**
   * A type read from more than the classes, once the tiers and the gone refusal have
   * decided: Towers files a broadcast mast as a mast from OpenStreetMap's layer (#2275).
   */
  retype?: (items: WikidataLandmark[], sparql: SparqlFn) => Promise<unknown>;
}

/** What a kind of the pass reads beside its rule and the world bars. */
interface ClassifierOptions {
  /**
   * The kind holds the street-art places its entrance names (#2035), reads
   * what their rule asks, and writes the works they hold (#2055).
   */
  streetArt?: boolean;
  /**
   * The kind decides what English Wikipedia's monuments categories alone name
   * (#2171), by its own frame with the category in place of a class.
   */
  monumentCategories?: boolean;
}

/** What Public art's or Monuments & memorials' rule reads in the surroundings tier beside a survivor's own facts. */
interface SurroundingsContext {
  /** The places a kind outside the two offers a reader (#1444). */
  offered: ReadonlySet<string>;
  /** The survivors the monuments categories alone name, with what the verdict reads of them (#2171). */
  filed: ReadonlyMap<string, FiledAsMonument>;
}

/**
 * Public art or Monuments & memorials in the surroundings tier (ADR-0171, #2178):
 * every item of the kind's classes measured against its surroundings, then the
 * kind's own rule over the survivors, with what holds them and what they
 * depict read by id, as the pool's candidates are judged.
 */
export function publicArtSurroundings(rule: KindRule): SurroundingsKind<PublicArtTrees, SurroundingsContext> {
  const categories = rule === MONUMENTS_RULE;
  return {
    kind: PUBLIC_ART_KIND,
    // Each rule's neighbourhood under its own key: both read one gather kind.
    group: rule.noun,
    // The kind's own classes: Public art's are the sculptural and fountain trees,
    // the public clocks and street art — not the heritage senses of "monument",
    // which its rule refuses by name; Monuments' are every admitting class,
    // since a statue raised to a person is a monument. A victory column that
    // is a statue only below its preferred class enters Public art by the world
    // tier alone, such as the Column of Marcus Aurelius, which is world-tier.
    classesOf: (trees) => (rule === PUBLIC_ART_RULE
      ? new Set([...trees.sculptural, ...trees.fountain, ...Object.keys(PUBLIC_CLOCK_CLASSES), ...Object.keys(STREET_ART_CLASSES)])
      : trees.admitting),
    // What Monuments & memorials measures beside its classes: what the
    // monuments categories named that no class of the kind admits (#2171).
    ...(categories ? { named: (share) => new Set(monumentCategoryCandidates(share as GatheredPublicArt, rule)) } : {}),
    // The type the rule itself files a place under, from its classes alone.
    typeOf: (classes, trees) => rule.type({ classes: [...classes], commemorates: [], genres: [], subjects: [] }, trees),
    context: async (survivors, share, sparql, named) => {
      const offered = await placesOtherSourcesOffer(PUBLIC_ART_SOURCES);
      // A survivor the categories named is decided by them only where no class
      // of the kind admits it now, as in the world tier.
      const byCategory = survivors.map((entity) => entity.qid)
        .filter((qid) => named.has(qid) && noClassAdmits(share as GatheredPublicArt, rule, qid));
      const reading = byCategory.length ? await readMonumentCategories(sparql, byCategory, share.facts) : null;
      const filed = new Map(reading ? byCategory.map((qid) => [qid, filedAsMonument(qid, share.facts.get(qid)?.classes ?? [], reading)]) : []);
      return { offered, filed };
    },
    verdict: (entity, share, { offered, filed }) => {
      const asFiled = filed.get(entity.qid);
      const verdict = publicArtVerdictOf(entity, share as GatheredPublicArt, rule, offered, asFiled);
      return verdict.pass
        ? {
          pass: true, type: verdict.type, artwork: verdict.artwork, creators: share.facts.get(entity.qid)?.creators ?? [],
          ...(asFiled ? { note: categoryNote(asFiled), wikipediaCategories: asFiled.categories } : {}),
        }
        : verdict;
    },
    logPrefix: LOG_PREFIX,
  };
}

/**
 * Public art's and Monuments & memorials' classifier: their kind's rule over
 * the public-art share, then the world bars over the kind's own pool
 * (ADR-0175), with the street-art places where the kind holds them.
 */
function publicArtClassifier(rule: KindRule, { streetArt = false, monumentCategories = false }: ClassifierOptions = {}): PlaceClassifier {
  return {
    // The places a kind outside these two offers a reader, so a work outdoors
    // on a venue no such kind offers stays public art rather than being
    // refused onto no card (#1444).
    classify: async (gathered, admitted, sparql, history) => {
      const share = shareOf(gathered, PUBLIC_ART_KIND);
      const offered = await placesOtherSourcesOffer(PUBLIC_ART_SOURCES);
      const streetArtRead = streetArt
        ? await readStreetArt(sparql, streetArtCandidates(share, rule), share.facts, history?.memory)
        : null;
      const monumentsRead = monumentCategories
        ? await readMonumentCategories(sparql, monumentCategoryCandidates(share, rule), share.facts)
        : null;
      return classifyPublicArt(share, rule, admitted, sparql, offered, { streetArt: streetArtRead, monuments: monumentsRead }, { history });
    },
    types: rule.types,
    tag: 'outdoor',
    // The surroundings tier (ADR-0171): the cut first over every item of the
    // kind's classes, then the kind's own rule over the few it admits, with
    // what holds them and what they depict read by id.
    surroundings: surroundingsReader(publicArtSurroundings(rule)),
    // A statue or a column houses nothing: its end of existence is its removal
    // unless the item says it stands again (#2280).
    gone: goneWorkReason,
    ...(streetArt ? { contents: streetArtContents(LANDMARK_SOURCE_ID, LOG_PREFIX) } : {}),
  };
}

/** The classifier each public-art source decides by: Public art alone holds the street-art places. */
const PUBLIC_ART_CLASSIFIERS: Readonly<Record<number, PlaceClassifier>> = {
  [LANDMARK_SOURCE_ID]: publicArtClassifier(PUBLIC_ART_RULE, { streetArt: true }),
  6: publicArtClassifier(MONUMENTS_RULE, { monumentCategories: true }),
};

/**
 * A source's credits for its run's photographs, keyed by image URL, and what
 * each of its landmarks' rows already says, so a failed credit pass erases
 * nothing.
 *
 * Held for the run, like the UNESCO run's Wikipedia links: the orchestrator
 * hands `processItem` one landmark at a time, and asking Commons per landmark
 * would be 200 requests where four will do.
 */
interface RunCredits {
  fetched: Map<string, ImageCredit>;
  stored: Map<string, StoredCredit>;
}

/** This run's credit, or the one already stored. The rule lives in `imageCredit.ts`. */
function creditPatch(
  credits: RunCredits, externalId: string, imageUrl: string | null,
): { imageCredit?: ImageCredit | null } {
  return creditToWrite(
    imageUrl ? credits.fetched.get(imageUrl) : undefined,
    credits.stored.get(externalId),
    imageUrl,
  );
}

/**
 * The live service with nothing kept: what a run on the subset asks about
 * what the subset in place does not hold (`publicArt/subjects.ts`). An
 * answer kept here would be read back into a later run on the subset, which
 * no run may mix in (ADR-0119).
 */
export function liveSparql(progress: SyncProgress): (query: string, descriptor?: CacheDescriptor) => Promise<SparqlBinding[]> {
  const door = wikidataDoor(progress, new WaitBudget(SPARQL_WAIT_BUDGET_MS), LOG_PREFIX);
  // The descriptor names a cache entry, and there is none to name.
  return (query) => door(query);
}

/**
 * The run's door to Wikidata, with the answers kept.
 *
 * The museum collector's shape (ADR-0030): one wait budget for the whole
 * collection, a cache keyed by the question, and `refreshCache` turning the
 * cache off for one run in both directions — a cache nobody can bypass is a
 * fork of reality. A hit says so on screen, because an admin who cannot tell
 * a cached phase from a fetched one will eventually debug an answer from last
 * week.
 *
 * The pass's gather asks it and keeps its answers under its first source
 * (ADR-0132 decision 5).
 */
export function collectingSparql(
  sourceId: number, progress: SyncProgress, refreshCache: boolean,
): (query: string, descriptor?: CacheDescriptor) => Promise<SparqlBinding[]> {
  return withCache(wikidataDoor(progress, new WaitBudget(SPARQL_WAIT_BUDGET_MS), LOG_PREFIX), {
    sourceId,
    enabled: !refreshCache,
    onHit: (descriptor, rows) => {
      progress.statusMessage = `${descriptor.label}: ${rows} rows, from cache`;
    },
  });
}

/**
 * The countries a landmark is in: for an edition every cast's, the anchor's
 * first — a reader that shows one country shows the first (ADR-0145) — else
 * the one the kept point is in.
 */
function countriesOf(landmark: WikidataLandmark, casts: readonly LandmarkCast[] | null, anchor: LandmarkCast | WikidataLandmark): string[] {
  if (!casts) return landmark.countryLabel ? [landmark.countryLabel] : [];
  const named = [anchor, ...casts].map(cast => cast.countryLabel).filter((c): c is string => c !== null);
  return [...new Set(named)];
}

/**
 * Whom or what the place commemorates, and the holy figure a religious work
 * depicts, each the place's own and shown on its card (#2144, #2404). Each is
 * absent where the reading names nobody, which on Public art's and Monuments &
 * memorials' runs proposes removing a value the place held; every other run
 * keeps it (`WRITTEN_BY_SOURCES`).
 */
function readingFields(landmark: WikidataLandmark): Pick<WikidataLandmark, 'commemorates' | 'depicts'> {
  return {
    ...(landmark.commemorates ? { commemorates: landmark.commemorates } : {}),
    ...(landmark.depicts ? { depicts: landmark.depicts } : {}),
  };
}

/**
 * Upsert a landmark as an experience + experience_location, in the kind
 * `sourceId` fills.
 */
async function upsertLandmarkExperience(
  sourceId: number,
  classifier: PlaceClassifier,
  credits: RunCredits,
  landmark: WikidataLandmark,
  context: SyncRunContext,
): Promise<ProcessItemResult> {
  const imageUrl = landmark.imageUrl || null;

  const metadata = {
    wikidataQid: landmark.qid,
    // Every class the rule read, and whether an artwork class answered it, for
    // the check that asks what an admitted row is typed as, and the monument's
    // year and makers: the kind's own, on its membership (`kindFacts.ts`).
    wikidataClasses: landmark.classes,
    wikidataArtwork: landmark.artwork,
    creators: landmark.creators,
    year: landmark.year,
    sitelinksCount: landmark.sitelinks,
    // Not `type` here: the column is the type, and storing it twice made every
    // run propose the same change twice — 124 of 1,685 public-art proposals on
    // the development catalogue carried both (#814). Migration 044 cleared the
    // key from the stored rows.
    wikipediaUrl: landmark.articleUrl || null,
    website: landmark.website || null,
    // The source's question to a curator, where it asks one. The kind's facts
    // are written whole every pass (`kindFacts.ts`), so a note the door no
    // longer asks leaves with the pass that stops sending it.
    ...(landmark.readershipNote ? { admissionNote: landmark.readershipNote } : {}),
    // The monuments categories that named a place no class of the kind does
    // (#2171): what the entrance keeps it in place by on a run that cannot
    // read them (`heldByCategory`).
    ...(landmark.wikipediaCategories ? { wikipediaCategories: landmark.wikipediaCategories } : {}),
    // The tier that admitted it, where it is not the world's (ADR-0171).
    ...(landmark.tier ? { tier: landmark.tier } : {}),
    ...readingFields(landmark),
    // `creator` is who made the sculpture; this is who photographed it. Two
    // different people, and only one of them has ever been named on the card.
    //
    // What this run fetched, or the row's own credit where the picture has not
    // changed. Resent rather than omitted, because the upsert replaces the whole
    // metadata object — a key left out is a key dropped. See `creditToWrite`.
    ...creditPatch(credits, landmark.qid, imageUrl),
  };

  // An edition is one place with a point at every cast (#880, ADR-0145): the
  // place is told to be at the cast nearest the casts' centroid, the way a
  // serial site is at its most central component (ADR-0095), and that anchor
  // is written past the gate — it is derived from the points, not a move of
  // the work. Its countries are every cast's, the anchor's first. A work
  // standing in one place keeps its one point unless the source explicitly
  // names that point as a cast; one remaining cast still carries its own name.
  const casts = landmark.casts && landmark.casts.length > 0 ? landmark.casts : null;
  const anchor = casts ? medoidOf(casts) : landmark;
  const countryNames = countriesOf(landmark, casts, anchor);

  const { experienceId, changeSet, nameSnapshot, returnedFromMissing } = await upsertExperienceRecord({
    sourceId,
    externalId: landmark.qid,
    name: landmark.label,
    nameLocal: { en: landmark.label },
    subtitle: landmark.description,
    description: null,
    type: landmark.type,
    // The kind's own words, so a type the split left outside them is rewritten
    // past the gate rather than asked about (#1807).
    typeVocabulary: classifier.types,
    tags: [classifier.tag, landmark.type],
    lon: anchor.lon,
    lat: anchor.lat,
    ...(casts ? { locationIsAnchor: true } : {}),
    // A visit to any cast marks the work seen (ADR-0145 decision 5); a work in
    // one place says it is not an edition, so a former one is set back.
    castPoints: casts !== null,
    countryCodes: [],
    countryNames,
    imageUrl,
    itemPictures: landmark.itemPictures,
    metadata,
  }, { dryRun: context.dryRun, syncLogId: context.syncLogId });

  let contents: ContentsByKind | undefined;
  if (!context.dryRun) {
    const run = { syncLogId: context.syncLogId, sourceId };
    // Every cast carries the work's own reference, as the one point did: identity
    // is the reference together with the point (ADR-0022, ADR-0027), so the casts
    // are told apart by where they stand, and a cast already written as the work's
    // one point is the same row with a name now.
    const written = casts
      ? await writeExperienceLocations(
        experienceId, casts.map(cast => ({ name: cast.name, externalRef: landmark.qid, lon: cast.lon, lat: cast.lat })), run,
      )
      : await upsertSingleLocation(experienceId, landmark.qid, landmark.lon, landmark.lat, run);
    if (written.needsAssignment.length > 0 || written.unoffered > 0) {
      context.onLocationsChanged(experienceId);
    }
    // What a street-art place holds, after its point (#2055); the floor's
    // verdict goes with the run's id, as a museum's does.
    const treasures = await classifier.contents?.write(experienceId, landmark.qid, context, credits.fetched);
    // One point per landmark, so this reports a source that moved it — a withdrawal
    // and an arrival, since identity is the point together with the source's reference
    // (ADR-0022), and a coordinate rewritten more than ten metres away is a different
    // point (ADR-0027). Inside that the writer reads it as the same place and nothing
    // is reported at all. For an edition it reports a cast that arrived or left.
    // Worth recording even where the object's own `lon`/`lat` diff says the same:
    // the row was replaced, and a reader's tick did not follow it.
    contents = { locations: written.delta, ...(treasures ? { treasures } : {}) };
  }

  return {
    outcome: changeSet.changeType,
    // 0 is previewUpsert's stand-in for a row that does not exist yet and would
    // violate the FK; a real id is worth keeping even in a preview.
    experienceId: experienceId || null,
    nameSnapshot,
    changeSet,
    returnedFromMissing,
    contents,
  };
}

/**
 * Whom or what each admitted place commemorates and the holy figure a
 * religious work depicts, onto its item, and Public art's plain sculpture that
 * shows one made a religious statue (#2279, `typeByDepicted`).
 */
async function readWhatEachCommemorates(items: WikidataLandmark[], sourceId: number, sparql: SparqlFn, progress: SyncProgress): Promise<void> {
  progress.statusMessage = 'Reading whom or what each place commemorates...';
  const readings = await readCommemorates(items, sparql, await commemorationWiki(progress));
  for (const item of items) {
    const reading = readings.get(item.qid);
    if (reading?.commemorates) item.commemorates = reading.commemorates;
    if (reading?.depicts) item.depicts = reading.depicts;
    if (sourceId === LANDMARK_SOURCE_ID) item.type = typeByDepicted(item.type, Boolean(reading?.religious)) as typeof item.type;
  }
}

/**
 * Decide from the gather, and ask Commons about the pictures of what was
 * admitted.
 *
 * The refusals come back as the run's `filtered`, which is what the
 * orchestrator marks on the rows (ADR-0024); what the source already admits
 * is read first, so the collection's stay line has something to hold.
 */
async function fetchLandmarkItems(
  sourceId: number,
  classifier: PlaceClassifier,
  credits: RunCredits,
  gather: (progress: SyncProgress) => Promise<PlaceGather>,
  progress: SyncProgress,
): Promise<FetchResult<WikidataLandmark>> {
  credits.fetched = new Map();
  credits.stored = await readStoredCredits(sourceId);
  // The world tier's rows alone, so the bars' stay share never holds a row
  // the surroundings tier admitted (#2178); the surroundings tier's are its own step's.
  const admitted = await admittedExternalIds(sourceId, undefined, 'world');

  const { gathered, sparql, run, surroundings: surroundingsPool } = await gather(progress);
  // What the source's world tier last read, for what this run cannot (ADR-0175 decision 6).
  const history = await worldHistory(sourceId, progress.logId);
  const { items, fetched, filtered, handOvers } = await classifier.classify(gathered, admitted, sparql, history);
  // The surroundings tier after the world tier has decided (ADR-0171, #2178): what
  // the world bars left out, measured against its surroundings.
  let spareTier: 'surroundings' | undefined;
  if (classifier.surroundings) {
    const surroundingsHeld = await admittedExternalIds(sourceId, undefined, 'surroundings');
    const surroundings = await classifier.surroundings.arrivals(
      run, sparql, gathered, new Set(items.map((item) => item.qid)), await surroundingsPool(), surroundingsHeld, history.memory,
    );
    mergeSurroundings(items, filtered, surroundings, (item) => item.qid, surroundingsHeld);
    // Not read this run (`surroundings.skipped`): its rows stay as they are.
    if (surroundings.skipped) spareTier = 'surroundings';
  }
  // A place Wikidata says is gone is refused whichever tier admitted it (#2259).
  // A work removed, destroyed or taken down is refused too, where the kind holds works (#2280).
  await refuseGone(items, filtered, sparql, { id: (item) => item.qid, name: (item) => item.label, type: (item) => item.type }, LOG_PREFIX,
    classifier.gone);
  await classifier.retype?.(items, sparql);
  // Whom or what each admitted place commemorates, and the holy figure a
  // religious work depicts, once the kinds have decided (#2144, #2404): Public
  // art's and Monuments & memorials' alone, whose writers `WRITTEN_BY_SOURCES`
  // names. Every other kind keeps what the place holds.
  if (SUBJECT_LINE_SOURCE_IDS.includes(sourceId)) await readWhatEachCommemorates(items, sourceId, sparql, progress);
  // What the admitted places hold, read before the first is written, so the
  // coverage floor is measured over the whole run (ADR-0044).
  const held = await classifier.contents?.read(items, sparql, progress);

  // After the decision, so the credit pass asks about the rows that will exist
  // rather than every candidate the pool named. Its own patience: the
  // collection's is spent by the time this runs.
  progress.statusMessage = 'Asking Commons who took the pictures...';
  const creditBudget = new WaitBudget(SPARQL_WAIT_BUDGET_MS);
  credits.fetched = await fetchCommonsCredits([...items.map((l) => l.imageUrl), ...(held?.imageUrls ?? [])], {
    userAgent: WIKIDATA_USER_AGENT,
    budget: creditBudget,
    isCancelled: () => progress.cancel,
    onWait: (wait) => {
      progress.statusMessage = waitMessage('Commons', wait, creditBudget);
    },
    pause: () => delay(SPARQL_DELAY_MS),
  });

  // What the subset cannot read is left as it is, not read as gone.
  const unread = readsSubset(sparql) ? await unreadOnSubset(sourceId) : undefined;
  return {
    items, fetchedCount: fetched, filtered, handOvers, unread, typeVocabulary: classifier.types,
    ...(spareTier ? { spareTier } : {}),
    ...(held ? { withdrawalSkippedReason: held.withdrawalSkippedReason } : {}),
  };
}

/** One public-art source of the pass: its kind's rule, writing the kind `sourceId` fills. */
export function publicArtSource(
  sourceId: number,
  gather: (progress: SyncProgress) => Promise<PlaceGather>,
): SyncServiceConfig<WikidataLandmark> {
  return placeSource(sourceId, gather, PUBLIC_ART_CLASSIFIERS[sourceId]);
}

/** One source of the pass whose places have one point: its classifier, writing the kind `sourceId` fills. */
export function placeSource(
  sourceId: number,
  gather: (progress: SyncProgress) => Promise<PlaceGather>,
  classifier: PlaceClassifier,
): SyncServiceConfig<WikidataLandmark> {
  const credits: RunCredits = { fetched: new Map(), stored: new Map() };
  return {
    sourceId,
    logPrefix: LOG_PREFIX,
    // A fame line over a pool, so absence from a run says the row fell below
    // it or stopped passing the rule — nothing about whether it still stands.
    sourceCompleteness: 'ranked',
    // Every run recomputes the whole membership from the whole pool rather than
    // fetching a published list, so absence from the admitted set is this
    // source's own decision and belongs on the admission axis (ADR-0024).
    recomputesMembership: true,
    // Belonging is the badge: the world tier is what clears the world bars, and
    // every row this run admits by it carries is_iconic for that (ADR-0045
    // decision 5) — written once admission is settled, not per landmark (#760).
    // A row the surroundings tier admits carries none (ADR-0048 decision 3).
    badgesAdmitted: (item) => item.tier !== 'surroundings',
    // Nothing appends to the orchestrator's error list any more: a collection
    // that fails throws, and fails the run.
    fetchItems: (progress) => fetchLandmarkItems(sourceId, classifier, credits, gather, progress),
    processItem: (landmark, _progress, context) => upsertLandmarkExperience(sourceId, classifier, credits, landmark, context),
    getItemName: (lm) => lm.label,
    getItemId: (lm) => lm.qid,
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get current landmark sync status
 */
export function getLandmarkSyncStatus() {
  return getSyncStatus(LANDMARK_SOURCE_ID);
}

/**
 * Cancel running landmark sync
 */
export function cancelLandmarkSync() {
  return cancelSync(LANDMARK_SOURCE_ID);
}
