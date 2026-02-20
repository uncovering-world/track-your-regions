/**
 * Types for Wikivoyage extraction service
 */

/** Progress for the full extraction → import → matching pipeline */
export interface ExtractionProgress {
  cancel: boolean;
  status:
    | 'extracting'
    | 'enriching'
    | 'importing'
    | 'matching'
    | 'complete'
    | 'failed'
    | 'cancelled';
  statusMessage: string;
  regionsFetched: number;
  estimatedTotal: number; // ~4500
  currentPage: string;
  apiRequests: number;
  cacheHits: number;
  startedAt: number;
  // Forwarded from ImportProgress during import/matching phases
  createdRegions: number;
  totalRegions: number;
  countriesMatched: number;
  totalCountries: number;
  subdivisionsDrilled: number;
  noCandidates: number;
  worldViewId: number | null;
}

/** Configuration for a Wikivoyage extraction run */
export interface ExtractionConfig {
  name: string; // WorldView name, default "Wikivoyage Regions"
  maxDepth: number; // Default 10
  cachePath: string; // Default 'data/cache/wikivoyage-cache.json' (persistent)
}

export function createInitialExtractionProgress(): ExtractionProgress {
  return {
    cancel: false,
    status: 'extracting',
    statusMessage: 'Starting extraction...',
    regionsFetched: 0,
    estimatedTotal: 4500,
    currentPage: '',
    apiRequests: 0,
    cacheHits: 0,
    startedAt: Date.now(),
    createdRegions: 0,
    totalRegions: 0,
    countriesMatched: 0,
    totalCountries: 0,
    subdivisionsDrilled: 0,
    noCandidates: 0,
    worldViewId: null,
  };
}

/** A node in the extraction tree (same shape as ImportTreeNode for compatibility) */
export interface TreeNode {
  name: string;
  regionMapUrl?: string;
  mapImageCandidates?: string[];
  wikidataId?: string;
  sourceUrl?: string;
  children: TreeNode[];
}

/** Result from get_page_data: parsed page information */
export interface PageData {
  resolved: string;
  exists: boolean;
  mapImage: string | null;
  mapImageCandidates: string[];
  regions: RegionEntry[];
}

/** A single region entry from a Regionlist template */
export interface RegionEntry {
  name: string;
  items: string[];
  hasLink: boolean;
}

/** Section info from the MediaWiki parse API */
export interface WikiSection {
  index: string;
  line: string;
}

/** MediaWiki API cache entry key-value store */
export type CacheStore = Record<string, unknown>;
