/**
 * Types for experience sync services
 */

import type { MonumentType, PublicArtType } from './publicArt/kindRules.js';
import type { TowerType } from './towers/classes.js';
import type { BridgeType } from './bridges/classes.js';
import type { SquareType } from './squares/classes.js';
import type { Operation } from '../operationProgress.js';
import type { FieldChange } from './changeSet.js';

/**
 * Progress tracking for background sync operations
 */
export interface SyncProgress {
  cancel: boolean;
  /**
   * What is running: a sync, a repair of the stored pictures, or a search for
   * the Wikidata items of World Heritage components (#1272), all started from
   * the same card. Sent with the status so the panel says which it is following
   * after a reload, rather than remembering what button was pressed — a repair
   * ends with its own count, a sync with what happens next.
   */
  kind: 'sync' | 'repair' | 'components';
  // 'partial' is terminal like 'complete': the run finished, but placing what
  // it moved did not, so the log row says partial and this must agree — a
  // poller reading 'complete' here would report success over it.
  status: 'fetching' | 'processing' | 'assigning' | 'complete' | 'partial' | 'failed' | 'cancelled';
  statusMessage: string;
  progress: number;
  total: number;
  created: number;
  updated: number;
  /** Rows the run touched that turned out identical — counted, never stored. */
  unchanged: number;
  /** Rows still present that this run did not see. */
  missing: number;
  /** Field-level divergences the curated_fields guard refused to apply. */
  curatedConflicts: number;
  /**
   * Rows a reader can already see whose every proposed change the source's
   * gate kept out, so a verdict is waiting on each (#523). A subset of
   * `unchanged` — nothing was written — counted again so a gated run stops
   * reading as one that touched nothing.
   */
  held: number;
  /** Entities the source offered that this source does not hold. Not errors. */
  filtered: number;
  errors: number;
  currentItem: string;
  logId: number | null;  // ID of the sync log entry in DB
  /** A preview run: the changeset is computed, experiences are not written. */
  dryRun: boolean;
  /**
   * What the run said of the curators' pins on admission (#1370), once it has:
   * how many it asked about again, how many it agrees with, and how many it
   * disagrees with in the very words the curator answered, left standing.
   */
  pins?: PinTally;
  /**
   * What the run asked of the places its source offers (#1770), once it has:
   * how many it read, how many fewer than two visit witnesses vouch for, and
   * how many it asked a curator about.
   */
  visitQuestions?: VisitQuestionTally;
  /**
   * Whether the run is asking about its offered places (#1770): its last step,
   * after the items, which a Cancel stops on its own (`isCancellable`).
   */
  askingVisitQuestions?: boolean;
  /**
   * The step the run is on, of how many, and how far through it (#1356), for
   * a run that reports through the shared shape: the component item finder
   * and the picture repairs so far.
   */
  operation?: Operation;
  /**
   * The sources of the pass this run is part of, in the order they run
   * (ADR-0132): a Cancel on any of them stops the pass. Absent on a run that
   * shares no gather.
   */
  passSources?: number[];
}

/** What a run asked of the places its source offers (#1770). */
export interface VisitQuestionTally {
  read: number;
  short: number;
  asked: number;
  /** A Cancel stopped the asking: the places not read are read by the next run. */
  stopped?: boolean;
  /** Places the map or their article's lead could not be read for, left for the next run. */
  unread?: number;
  /** The asking failed (a source not answering, a write refused): nothing was asked, and the next run asks. */
  failed?: boolean;
}

/** What a run said of the source's pins on admission (#1370). */
export interface PinTally {
  asked: number;
  agreed: number;
  standing: number;
}

/**
 * How a run of a source is started from the admin panel: a preview, a full
 * collection that uses nothing kept, and whether to ask again about every pin
 * it disagrees with (#1370), not only the ones whose reason has changed.
 */
export interface SyncRunOptions {
  dryRun?: boolean;
  refreshCache?: boolean;
  askAboutPins?: boolean;
}

/**
 * Store for tracking running syncs by sourceId
 */
export const runningSyncs = new Map<number, SyncProgress>();

/**
 * UNESCO API record structure
 */
export interface UnescoApiRecord {
  id_no: string;
  name_en: string;
  name_fr?: string;
  name_es?: string;
  name_ru?: string;
  name_ar?: string;
  name_zh?: string;
  short_description_en?: string;
  short_description_fr?: string;
  /** The portal's own word for the site's type: `"Cultural"`, `"Natural"` or `"Mixed"`. */
  category: string;
  /**
   * The site's point, `{lon, lat}`. Not `coordinates`, which the dataset writes as
   * a GeoJSON MultiPoint of every component since 2026-10-20 (#1803).
   */
  geo_point_2d?: {
    lat: number;
    lon: number;
  };
  iso_codes?: string | string[];
  states_names?: string | string[];
  /** The year, as a string: `"2003"`. Every scalar this portal sends is one. */
  date_inscribed?: string | number;
  /** `"True"` / `"False"` — the portal's booleans are strings. See `isSet`. */
  danger?: string | number | boolean;
  /**
   * The dated listing: `"Y 2013"` for a site on the List of World Heritage in
   * Danger, and an explicit `null` for one that is not — including a site taken
   * off the list, whose entry the portal empties rather than negating.
   */
  danger_list?: string | null;
  /**
   * The inscription criteria, as "(i)(ii)(iii)(iv)".
   *
   * `criteria_txt` and not `criteria`: the latter is what this importer asked
   * for until 2026-08-21 and is a field the whc001 dataset does not have, so
   * every one of the 1272 imported sites carried no criterion tag at all.
   */
  criteria_txt?: string;
  region?: string;
  area_hectares?: number;
  /** `"True"` / `"False"`, like `danger`. See `isSet`. */
  transboundary?: string | number | boolean;
  // Multi-location support for serial nominations
  components_list?: string; // JSON: [{"name": "Hanklit", "ref": "1758-001", "latitude": 56.895649, "longitude": 8.751962}]
}

/**
 * Parsed location from UNESCO components_list
 */
export interface ParsedLocation {
  name: string;
  externalRef: string;
  lat: number;
  lon: number;
}

// =============================================================================
// Wikidata Museum Types
// =============================================================================

/**
 * Raw museum details from Wikidata SPARQL query
 */
export interface WikidataMuseum {
  museumQid: string;
  museumLabel: string;
  description: string | null;
  lat: number | null;
  lon: number | null;
  countryLabel: string | null;
  imageUrl: string | null;
  /** Every picture the item carries at its best rank, `imageUrl` among them (#1778). */
  itemPictures: readonly string[];
  website: string | null;
  articleUrl: string | null;
}

/**
 * Artwork processed and ready for treasures insertion
 */
export interface ProcessedContent {
  externalId: string;       // Wikidata QID
  name: string;
  /**
   * The class the work was collected under, as a reader sees it: `painting`, `fresco`, `icon`.
   * Open rather than an enum since the bounded class closure replaced the hand-picked type list.
   */
  treasureType: string;
  /** Every maker the source names, in no asserted order. Empty where none is recorded (#720). */
  artists: string[];
  year: number | null;
  imageUrl: string | null;
  sitelinksCount: number;
  /**
   * Where a find was dug up (`P189`), stored in the treasure's metadata so the
   * card can say "found at Mycenae" (ADR-0058 decision 3).
   *
   * Three states, and a treasure is global by `external_id`, so the difference
   * between the first two is what keeps one kind from erasing the other's answer
   * (`metadataWithFindSpot` in `museum/treasureWriter.ts`, and `INSERTED_METADATA`
   * on a first write): **absent** is a kind
   * whose works were made where they hang, and keeps whatever is stored;
   * **`null`** is this kind having read the item and found no discovery place,
   * and removes it; an object replaces it.
   */
  foundAt?: { qid: string; label: string } | null;
  /** The kind that handed the work to this venue, and its reason (ADR-0102); absent on a work the kind kept itself. */
  handedBy?: string;
  /**
   * The work's English Wikipedia article (#1608), which the card links instead
   * of Wikidata's redirect. **Absent** where the run did not ask, and the row
   * keeps what it holds; **`null`** where the run asked and the work has none;
   * a URL otherwise (`treasures.wikipedia_url`, `wikipedia_read_at`).
   */
  wikipediaUrl?: string | null;
  /**
   * Whether the readership door opened for the work this run (ADR-0056): it is
   * Iconic below the sitelinks line. Absent on a run with no door.
   */
  readIconic?: boolean;
}

/**
 * Museum with its collected artworks, ready for processing
 */
export interface CollectedMuseum {
  qid: string;
  label: string;
  artworks: ProcessedContent[];
  details?: WikidataMuseum;
  /**
   * The most famous iconic work this museum holds — the reason it is in the catalogue at all,
   * and what makes that reason nameable on the curation screen.
   */
  admittedFor?: { qid: string; label: string };
  /**
   * The curator's question on a museum only the readership door admitted
   * (ADR-0056): the work, its year, the bar and its burst flag.
   */
  readershipNote?: string;
}

// =============================================================================
// Wikidata Landmark Types (the place kinds with one point)
// =============================================================================

/**
 * Raw landmark record from Wikidata SPARQL query
 */
export interface WikidataLandmark {
  qid: string;              // e.g., "Q189764" (Statue of Liberty)
  label: string;
  description: string | null;
  lat: number;
  lon: number;
  imageUrl: string | null;
  /** Every picture the item carries at its best rank, `imageUrl` among them (#1778). */
  itemPictures: readonly string[];
  /**
   * Every maker the source names, in no asserted order. Empty where none is recorded.
   *
   * A list for the reason a work's is (#720): 19 of the 83 stored monuments with
   * a creator have more than one, and Christ the Redeemer is Landowski's statue
   * on Oswald's design.
   */
  creators: string[];
  year: number | null;
  sitelinks: number;
  countryLabel: string | null;
  /** The type within the kind the run fills, in that kind's own vocabulary. */
  type: PublicArtType | MonumentType | TowerType | BridgeType | SquareType;
  /**
   * Every `P31` the entity carries, as the rule read them. Stored with the row
   * (`metadata.wikidataClasses`) so that Catalogue Checks can ask, of what is
   * admitted, whether a class the rule refuses is among them.
   */
  classes: string[];
  /**
   * Whether an artwork class answered the rule — the sculptural and fountain
   * closures or a pinned structure, what lifts a building's veto. Stored as
   * `metadata.wikidataArtwork`, so the check reads the rule's own answer.
   */
  artwork: boolean;
  articleUrl: string | null;
  website: string | null;
}

/**
 * Processed experience data ready for DB insertion
 */
export interface ProcessedExperience {
  sourceId: number;
  externalId: string;
  name: string;
  nameLocal: Record<string, string>;
  subtitle: string | null;
  description: string | null;
  /** The type within the kind; `null` for a museum (ADR-0045, #814). */
  type: string | null;
  tags: string[];
  lat: number;
  lon: number;
  /** `lat`/`lon` is the anchor of a place of several components, not its own coordinate (ADR-0095). */
  locationIsAnchor?: boolean;
  countryCodes: string[];
  countryNames: string[];
  imageUrl: string | null;
  /** Every picture the item that gave `imageUrl` carries at its best rank (#1778); absent with no item. */
  itemPictures?: readonly string[];
  metadata: Record<string, unknown>;
  // Multi-location support
  locations: ParsedLocation[];
}

/**
 * Has this run stopped?
 *
 * One predicate rather than a list repeated at each call site. The list had
 * four copies when `'partial'` was added, and only the one beside the change
 * learned about it — the others would have read a finished run as still
 * running, blocking a retry with 409 and spinning a poller against nothing.
 */
export function isTerminalSyncStatus(status: string): boolean {
  return status === 'complete' || status === 'partial'
    || status === 'failed' || status === 'cancelled';
}

/**
 * How a run ended. Lives here rather than in the orchestrator so the modules
 * that report a verdict do not have to import the module that runs the loop —
 * that direction is a cycle.
 */
export type RunVerdict = 'complete' | 'failed' | 'cancelled';

/** One entry in a run's `error_details`. */
export interface ErrorDetail {
  externalId: string;
  error?: string;
  [key: string]: unknown;
}

/**
 * One thing an experience holds, as the record names it (ADR-0026 decision 4).
 *
 * Never a database id: the record has to stay legible after the row it names is
 * renamed, which is the same reason the changeset keeps `name_snapshot` per
 * object. Both halves are nullable because both are nullable in the tables —
 * most UNESCO components carry a reference and no name of their own.
 */
export interface ContentItem {
  name: string | null;
  ref: string | null;
  /** Who handed a work to its venue, and why (ADR-0102): only on a work the venue gained that way. */
  handed_by?: string;
}

/**
 * What a run did to one kind of contents of one experience.
 *
 * `returned` is separate from `added` because the row, its id, and the visit
 * record on it are the same ones as before (ADR-0022) — reported as an arrival
 * it would read as a component the object never had.
 *
 * A writer reports only what it actually performed. A withdrawal the gate is
 * holding until its replacement is published is absent: the point is still on
 * the map, and saying it had gone would be telling a curator the opposite of
 * what a reader sees.
 */
export interface ContentsDelta {
  added: ContentItem[];
  withdrawn: ContentItem[];
  returned: ContentItem[];
  /**
   * Rows the run kept and rewrote — a point that moved, a component renamed.
   *
   * Separate from the three above because it is a different question: those say
   * what a container holds now, and this says that something it already held is
   * not what it was. A queue reading only membership shows a site nothing has
   * happened to on the fortnight its coordinates were re-surveyed.
   *
   * Each carries the item as the record names it (never an id — see
   * `ContentItem`) and the fields `contentsChangeSet` found, in the object's own
   * `FieldChange` vocabulary.
   */
  changed: ContentItemChange[];
}

/** One item a run rewrote, and what it rewrote about it. */
export interface ContentItemChange {
  item: ContentItem;
  fields: FieldChange[];
}

/**
 * The kinds of contents an experience holds.
 *
 * The same two the curation gate already spans — `pending_locations` and
 * `pending_treasures` in the queue's `contents` kind. A list as well as a type,
 * because the response schemas enumerate it for the web (`ContentKind` in
 * `api/responses/curation.ts`).
 */
export const CONTENT_KINDS = ['locations', 'treasures'] as const;

export type ContentKind = (typeof CONTENT_KINDS)[number];

/**
 * What a run did to an object's contents, by kind (ADR-0026 decision 1).
 *
 * Keyed rather than one field per kind so a third kind of contents costs no
 * migration, and partial because a kind the run did nothing to is absent rather
 * than present and empty.
 */
export type ContentsByKind = Partial<Record<ContentKind, ContentsDelta>>;

/** Whether a delta says anything happened. */
function moved(delta: ContentsDelta | undefined): boolean {
  if (!delta) return false;
  return delta.added.length > 0 || delta.withdrawn.length > 0
    || delta.returned.length > 0 || delta.changed.length > 0;
}

/**
 * The contents record for a run's row, or `null` where the run moved nothing.
 *
 * Both halves matter. Dropping the kinds that did nothing keeps a museum's row
 * from claiming a points delta it never computed; returning `null` for the whole
 * thing is what keeps 1235 quiet objects of a UNESCO run out of the changeset,
 * which is the noise ADR-0020 refused to store.
 */
export function recordedContents(byKind: ContentsByKind): ContentsByKind | null {
  const kinds = Object.keys(byKind) as ContentKind[];
  const moving = kinds.filter(kind => moved(byKind[kind]));
  if (moving.length === 0) return null;
  return Object.fromEntries(moving.map(kind => [kind, byKind[kind]]));
}

/**
 * Whether the record carries a field of a part the gate held (ADR-0037).
 *
 * The one predicate behind the run's `held` counter and the changeset row's
 * word, for the part-level half of what `wasHeld` answers about the object's
 * own fields: a visible row the run proposed a change to and kept whole is held
 * whichever level the proposal sits at.
 */
export function contentsHeld(byKind: ContentsByKind | null): boolean {
  if (!byKind) return false;
  return Object.values(byKind).some(delta => delta?.changed.some(
    entry => entry.fields.some(field => field.held),
  ));
}
