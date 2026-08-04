/**
 * Types for experience sync services
 */

/**
 * Progress tracking for background sync operations
 */
export interface SyncProgress {
  cancel: boolean;
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
  /** Entities the source offered that this category does not hold. Not errors. */
  filtered: number;
  errors: number;
  currentItem: string;
  logId: number | null;  // ID of the sync log entry in DB
  /** A preview run: the changeset is computed, experiences are not written. */
  dryRun: boolean;
}

/**
 * Store for tracking running syncs by categoryId
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
  category: string;
  coordinates?: {
    lat: number;
    lon: number;
  };
  iso_codes?: string | string[];
  states_names?: string | string[];
  main_image_url?: string | { url?: string };
  date_inscribed?: number;
  danger?: number;
  danger_list?: string;
  criteria?: string;
  region?: string;
  area_hectares?: number;
  transboundary?: number;
  // Multi-location support for serial nominations
  components_list?: string; // Format: "{name: Fort Name, ref: 1739-005, latitude: 18.236, longitude: 73.444}"
}

/**
 * UNESCO API response structure
 */
export interface UnescoApiResponse {
  total_count: number;
  results: UnescoApiRecord[];
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
 * Raw artwork record from Wikidata SPARQL query
 */
export interface WikidataArtwork {
  artworkQid: string;       // e.g., "Q12418" (Mona Lisa)
  artworkLabel: string;
  collectionQid: string;    // e.g., "Q19675" (Louvre)
  collectionLabel: string;
  imageUrl: string | null;  // Wikimedia Commons URL
  creatorLabel: string | null;
  year: number | null;
  sitelinks: number;
  artworkType: 'painting' | 'sculpture';
}

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
  website: string | null;
  articleUrl: string | null;
}

/**
 * Artwork processed and ready for treasures insertion
 */
export interface ProcessedContent {
  externalId: string;       // Wikidata QID
  name: string;
  treasureType: 'painting' | 'sculpture';
  artist: string | null;
  year: number | null;
  imageUrl: string | null;
  sitelinksCount: number;
}

/**
 * Museum with its collected artworks, ready for processing
 */
export interface CollectedMuseum {
  qid: string;
  label: string;
  artworks: ProcessedContent[];
  details?: WikidataMuseum;
}

// =============================================================================
// Wikidata Landmark Types (Public Art & Monuments)
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
  creatorLabel: string | null;
  year: number | null;
  sitelinks: number;
  countryLabel: string | null;
  type: 'sculpture' | 'monument';
  articleUrl: string | null;
  website: string | null;
}

/**
 * Processed experience data ready for DB insertion
 */
export interface ProcessedExperience {
  categoryId: number;
  externalId: string;
  name: string;
  nameLocal: Record<string, string>;
  description: string | null;
  shortDescription: string | null;
  category: string | null;
  tags: string[];
  lat: number;
  lon: number;
  countryCodes: string[];
  countryNames: string[];
  imageUrl: string | null;
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
