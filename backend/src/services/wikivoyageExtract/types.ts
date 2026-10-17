/**
 * Types for Wikivoyage extraction service
 */

import type { Operation } from '../operationProgress.js';
import type { InterviewQuestion, RegionPreview } from '../../api/responses/wikivoyageExtract.js';

// A region preview and an interview question are what the extraction's status
// and answers send the admin, so their types are those answers' schemas (ADR-0066).
export type { InterviewQuestion, RegionPreview };

/** A queued AI question — extraction continues, admin reviews at their pace */
export interface PendingAIQuestion {
  id: number;
  pageTitle: string;
  sourceUrl: string;
  /** Raw AI questions (kept for context in interview) */
  rawQuestions: string[];
  /** Structured interview question with options (null if interview not yet started) */
  currentQuestion: InterviewQuestion | null;
  extractedRegions: RegionPreview[];
  /** The regions the page was extracted with when the question was queued, which the tree was built from */
  queuedRegions: RegionPreview[];
  resolved: boolean;
  /**
   * Internal: every node built for this page, with the rebuild that refills it
   * from a region set under the depth, ancestors and country context it was built
   * under (#368). `buildTree` adds one per node it builds for the page — a page can
   * sit under more than one parent, and a parent's rebuild builds it again — and
   * `fromAnswer` says the node was built from the answered regions already. Empty
   * where the page ended before any node was built (not serialized).
   */
  nodes: Array<{ node: TreeNode; fromAnswer: boolean; rebuild: (regions: RegionPreview[]) => Promise<void> }>;
  /** Internal: re-run AI with admin feedback, returns updated preview (not serialized) */
  reExtract: (feedback: string) => Promise<{ regions: RegionPreview[]; questions: string[] }>;
  /** Internal: formulate next interview question or auto-resolve (not serialized) */
  formulateNextQuestion: () => Promise<InterviewQuestion | 'auto_resolved'>;
  /** Internal: process answer and get rule + guidance (not serialized) */
  processAnswer: (question: InterviewQuestion, answer: string) => Promise<{
    rule: string | null;
    reExtractGuidance: string | null;
  }>;
}

/** Who made an extraction decision (for decision logging summary) */
export type DecisionMaker =
  | 'city_districts'    // hardcoded Parent/District shortcut
  | 'dead_end_filter'   // dropped dead-ends resolved ambiguity
  | 'plain_text_linked' // all plain-text entries had real pages
  | 'ai_empty'          // AI returned empty regions
  | 'ai_confident'      // AI extracted regions with no questions
  | 'coverage_gate'     // <50% coverage hard gate cleared regions
  | 'interview_auto'    // interview auto-resolved by learned rule
  | 'admin_answer'      // admin answered the question
  | 'no_ai'             // AI unavailable, used parser output as-is
  | 'country_depth';    // country-aware depth limit applied

/** A logged extraction decision for the Phase 1 summary */
export interface DecisionEntry {
  page: string;
  decision: 'leaf' | 'split' | 'drop_children';
  decidedBy: DecisionMaker;
  detail: string;
}

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
  estimatedTotal: number;
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
  // AI extraction stats
  aiApiCalls: number;
  aiPromptTokens: number;
  aiCompletionTokens: number;
  aiTotalCost: number;
  // Stacked AI questions (non-blocking — extraction continues)
  pendingQuestions: PendingAIQuestion[];
  /** Auto-incrementing question ID */
  nextQuestionId: number;
  /**
   * The regions the model settled for a page in this run, by resolved title, so a
   * page reached again — under a second parent, or by a rebuild from an answer
   * (#368) — is built from what was decided rather than asked about again.
   */
  modelRegions: Map<string, RegionEntry[]>;
  /** Decision log for Phase 1 summary */
  decisions: DecisionEntry[];
  /** The step the extraction is on, of the six, and how far through it (#1356). */
  operation?: Operation;
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
    estimatedTotal: 5700,
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
    aiApiCalls: 0,
    aiPromptTokens: 0,
    aiCompletionTokens: 0,
    aiTotalCost: 0,
    pendingQuestions: [],
    nextQuestionId: 1,
    modelRegions: new Map(),
    decisions: [],
  };
}

/** A node in the extraction tree (same shape as ImportTreeNode for compatibility) */
export interface TreeNode {
  name: string;
  regionMapUrl?: string;
  mapImageCandidates?: string[];
  wikidataId?: string;
  sourceUrl?: string;
  warnings?: string[];
  children: TreeNode[];
}

/** Country context for depth-aware extraction */
export interface CountryContext {
  /** Country name (for logging) */
  name: string;
  /** Country area in km² (from AI classification) */
  area: number;
  /** Maximum allowed depth below this country */
  maxSubDepth: number;
  /** Current depth within the country (0 = direct children) */
  currentSubDepth: number;
}

/** Result from get_page_data: parsed page information */
export interface PageData {
  resolved: string;
  exists: boolean;
  mapImage: string | null;
  mapImageCandidates: string[];
  regions: RegionEntry[];
  /** True when regions have ambiguity that AI should resolve */
  needsAI?: boolean;
  /** Raw Regions section wikitext for AI fallback */
  rawWikitext?: string;
}

/** A single region entry from a Regionlist template */
export interface RegionEntry {
  name: string;
  items: string[];
  hasLink: boolean;
}

/** A mapshape entry from {{mapshape}} template (Kartographer region overlay) */
export interface MapshapeEntry {
  title: string;
  color: string;
  wikidataIds: string[];
  /** Wikimedia Commons map data file (e.g. "North_Sea_Coast_region.map") — alternative to wikidata */
  commonsFile?: string;
}

/** Section info from the MediaWiki parse API */
export interface WikiSection {
  index: string;
  line: string;
}

/** MediaWiki API cache entry key-value store */
export type CacheStore = Record<string, unknown>;
