/**
 * Types for experience sync services
 */

/**
 * Progress tracking for background sync operations
 */
export interface SyncProgress {
  cancel: boolean;
  status: 'fetching' | 'processing' | 'assigning' | 'complete' | 'failed' | 'cancelled';
  statusMessage: string;
  progress: number;
  total: number;
  created: number;
  updated: number;
  errors: number;
  currentItem: string;
  logId: number | null;  // ID of the sync log entry in DB
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
