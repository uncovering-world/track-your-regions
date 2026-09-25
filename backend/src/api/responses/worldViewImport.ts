/**
 * What the world-view import's review answers (ADR-0066): the success bodies of
 * the endpoints `frontend/src/api/admin/worldViewImport.ts` calls, declared
 * once. That is an import started, followed and cancelled, the match review's
 * statistics and its tree, the matchers that find candidates for one region,
 * a reviewer's decisions on a region's suggestions, a division moved from the
 * region that held it, a Wikidata item's shape, and a re-match.
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 */

import { MATCH_STATUSES } from '@tyr/shared/runStatuses';
import { z } from 'zod/v4';
import { AreaGeometry } from './regions.js';
import { ImportedWorldView } from './wikivoyageExtract.js';

// ---------------------------------------------------------------------------
// An import, started and followed
// ---------------------------------------------------------------------------

export const ImportStarted = z.strictObject({
  started: z.literal(true),
  operationId: z.string(),
}).describe('An import, started in the background.');
export type ImportStarted = z.infer<typeof ImportStarted>;

export const ImportStatus = z.strictObject({
  running: z.boolean(),
  operationId: z.string().optional(),
  status: z.enum(['importing', 'matching', 'complete', 'failed', 'cancelled']).optional(),
  statusMessage: z.string().optional(),
  createdRegions: z.number().int().optional(),
  totalRegions: z.number().int().optional(),
  matchedRegions: z.number().int().optional(),
  totalCountries: z.number().int().optional(),
  countriesMatched: z.number().int().optional(),
  subdivisionsDrilled: z.number().int().optional(),
  noCandidates: z.number().int().optional(),
  worldViewId: z.number().int().nullable().optional().describe('The world view the import creates, once it exists.'),
  importedWorldViews: z.array(ImportedWorldView).describe('Every imported world view, newest first, finished ones included.'),
}).describe('The latest import as it stands, and the imported world views. Only `running` and the list are sent while no import is known since the server started.');
export type ImportStatus = z.infer<typeof ImportStatus>;

export const ImportCancelled = z.strictObject({
  cancelled: z.boolean().describe('False when no import was running.'),
}).describe('A stop asked of the import.');
export type ImportCancelled = z.infer<typeof ImportCancelled>;

// ---------------------------------------------------------------------------
// The match review
// ---------------------------------------------------------------------------

const count = z.number().int();

export const MatchStats = z.strictObject({
  auto_matched: count,
  children_matched: count,
  needs_review: count,
  needs_review_blocking: count.describe('Regions needing review that no ancestor\'s match already covers.'),
  no_candidates: count,
  no_candidates_blocking: count.describe('Regions with no candidates that no ancestor covers and that still have an unresolved leaf below.'),
  manual_matched: count,
  suggested: count,
  total_matched: count.describe('Regions with any match status.'),
  total_leaves: count,
  total_regions: count,
  hierarchy_warnings_count: count.describe('Regions whose hierarchy review surfaced warnings nobody has dismissed.'),
}).describe('How far a world view\'s match review has come.');
export type MatchStats = z.infer<typeof MatchStats>;

export const MatchStatus = z.enum(MATCH_STATUSES)
  .describe('Where a region\'s match stands: matched by the matcher, through its children, or by hand; candidates to review; none found. `suggested` is an older matcher\'s word for a parent with candidates.');
export type MatchStatus = z.infer<typeof MatchStatus>;

export const SuggestionConflict = z.strictObject({
  type: z.enum(['direct', 'split']).describe('`direct`: the donor holds the division itself. `split`: it holds one of the division\'s ancestors.'),
  donorRegionId: z.number().int(),
  donorRegionName: z.string(),
  donorDivisionId: z.number().int(),
  donorDivisionName: z.string(),
}).describe('The sibling region already holding a suggested division, or its parent: accepting it moves the division from there (ADR-0012).');
export type SuggestionConflict = z.infer<typeof SuggestionConflict>;

export const MatchSuggestion = z.strictObject({
  divisionId: z.number().int(),
  name: z.string(),
  path: z.string().nullable().describe('The division\'s administrative path, country first.'),
  score: z.number().nullable(),
  geoSimilarity: z.number().nullable().describe('How much of the region\'s shape the division covers, where a shape was compared.'),
  conflict: SuggestionConflict.nullable(),
}).describe('A division offered as a region\'s match.');
export type MatchSuggestion = z.infer<typeof MatchSuggestion>;

export const AssignedDivision = z.strictObject({
  divisionId: z.number().int(),
  name: z.string(),
  path: z.string().describe('The division\'s administrative path, root first.'),
  hasCustomGeom: z.boolean().describe('The region holds only a part of the division.'),
}).describe('A division a region holds.');
export type AssignedDivision = z.infer<typeof AssignedDivision>;

export const MarkerPoint = z.strictObject({
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
}).describe('A place the region\'s Wikivoyage article marks on its map.');
export type MarkerPoint = z.infer<typeof MarkerPoint>;

export const MatchTreeNode = z.strictObject({
  id: z.number().int(),
  name: z.string(),
  isLeaf: z.boolean(),
  matchStatus: MatchStatus.nullable(),
  suggestions: z.array(MatchSuggestion).describe('Open suggestions, best first.'),
  sourceUrl: z.string().nullable(),
  regionMapUrl: z.string().nullable(),
  mapImageCandidates: z.array(z.string()),
  mapImageReviewed: z.boolean(),
  needsManualFix: z.boolean(),
  fixNote: z.string().nullable(),
  wikidataId: z.string().nullable(),
  memberCount: z.number().int(),
  assignedDivisions: z.array(AssignedDivision),
  geoAvailable: z.boolean().nullable().describe('Whether Wikidata has a shape for the region, or null where nobody has asked.'),
  markerPoints: z.array(MarkerPoint).nullable(),
  hierarchyWarnings: z.array(z.string()),
  hierarchyReviewed: z.boolean(),
  get children(): z.ZodArray<typeof MatchTreeNode> {
    return z.array(MatchTreeNode);
  },
}).describe('A region of the imported tree, with its match and its children.');
export type MatchTreeNode = z.infer<typeof MatchTreeNode>;

export const MatchTree = z.array(MatchTreeNode).describe('The imported tree\'s roots, by name.');
export type MatchTree = z.infer<typeof MatchTree>;

// ---------------------------------------------------------------------------
// The matchers: finding candidates for one region
// ---------------------------------------------------------------------------

export const FoundSuggestion = z.strictObject({
  divisionId: z.number().int(),
  name: z.string(),
  path: z.string().describe('The division\'s administrative path, country first.'),
  score: z.number(),
  conflict: SuggestionConflict.optional().describe('Sent where a sibling already holds the division or its parent.'),
}).describe('A division a matcher just offered as a region\'s match; the tree carries it from now on.');
export type FoundSuggestion = z.infer<typeof FoundSuggestion>;

export const DbSearchResult = z.strictObject({
  found: z.number().int().describe('New suggestions written.'),
  suggestions: z.array(FoundSuggestion),
}).describe('Divisions whose names are like the region\'s, found by trigram similarity.');
export type DbSearchResult = z.infer<typeof DbSearchResult>;

export const GeocodeMatchResult = z.strictObject({
  found: z.number().int(),
  suggestions: z.array(FoundSuggestion),
  geocodedName: z.string().optional().describe('The place Nominatim resolved the region\'s name to.'),
  searchRadiusKm: z.number().optional().describe('How far from that place the divisions were looked for.'),
}).describe('Divisions containing the place the region\'s name geocodes to.');
export type GeocodeMatchResult = z.infer<typeof GeocodeMatchResult>;

const nextScope = z.strictObject({
  ancestorId: z.number().int(),
  ancestorName: z.string(),
}).optional().describe('Where a wider search would look, offered when this one found nothing.');

export const CoveringMatchResult = z.strictObject({
  found: z.number().int(),
  suggestions: z.array(FoundSuggestion),
  totalCoverage: z.number().optional().describe('How much of the region\'s shape the covering set covers, from 0 to 1.'),
  scopeAncestorName: z.string().optional().describe('The ancestor whose divisions the search was held to.'),
  nextScope,
}).describe('Divisions matched from the region\'s Wikidata shape, or from the places its Wikivoyage article marks.');
export type CoveringMatchResult = z.infer<typeof CoveringMatchResult>;

export const AIMatchOneResult = z.strictObject({
  improved: z.boolean().describe('The model found a better match than the region had.'),
  suggestion: FoundSuggestion.optional(),
  reasoning: z.string().optional(),
  cost: z.number().describe('US dollars.'),
}).describe('A model\'s match for one region.');
export type AIMatchOneResult = z.infer<typeof AIMatchOneResult>;

export const Geoshape = z.strictObject({
  type: z.literal('FeatureCollection'),
  features: z.array(z.strictObject({
    type: z.literal('Feature'),
    properties: z.strictObject({ id: z.string().describe('The Wikidata item.') }),
    geometry: AreaGeometry,
  })),
}).describe('A Wikidata item\'s shape, from the local cache or from Wikimedia\'s map service; no feature where it has none.');
export type Geoshape = z.infer<typeof Geoshape>;

export const RematchStarted = z.strictObject({
  started: z.literal(true),
  matchingPolicy: z.enum(['country-based', 'hierarchical', 'none']).describe('The policy the world view\'s source implies, or the one the request named.'),
}).describe('A re-match of the whole world view, started in the background.');
export type RematchStarted = z.infer<typeof RematchStarted>;

export const RematchStatus = z.strictObject({
  status: z.enum(['importing', 'matching', 'complete', 'failed', 'cancelled', 'idle']).describe('`idle` while no re-match of this world view is known since the server started.'),
  statusMessage: z.string().optional(),
  countriesMatched: z.number().int().optional(),
  totalCountries: z.number().int().optional(),
  noCandidates: z.number().int().optional(),
}).describe('A world view\'s re-match as it stands.');
export type RematchStatus = z.infer<typeof RematchStatus>;

export const AIMatchStatus = z.strictObject({
  status: z.enum(['running', 'complete', 'failed', 'cancelled', 'idle']).describe('`idle` while no AI re-match of this world view is known since the server started.'),
  statusMessage: z.string().optional(),
  totalLeaves: z.number().int().optional(),
  processedLeaves: z.number().int().optional(),
  improved: z.number().int().optional(),
  totalCost: z.number().optional().describe('What the model calls have cost so far, in US dollars.'),
}).describe('A world view\'s AI re-match of its unresolved leaves as it stands.');
export type AIMatchStatus = z.infer<typeof AIMatchStatus>;

export const AIMatchStarted = AIMatchStatus.extend({
  started: z.literal(true),
}).describe('An AI re-match of the world view\'s unresolved leaves, started in the background.');
export type AIMatchStarted = z.infer<typeof AIMatchStarted>;

export const AIMatchCancelled = z.strictObject({
  cancelled: z.boolean().describe('False when no AI re-match of this world view was running.'),
}).describe('A stop asked of a world view\'s AI re-match.');
export type AIMatchCancelled = z.infer<typeof AIMatchCancelled>;

// ---------------------------------------------------------------------------
// A reviewer's decisions
// ---------------------------------------------------------------------------

export const MatchAccepted = z.strictObject({
  accepted: z.literal(true),
}).describe('One suggestion accepted; the region\'s other suggestions stay open.');
export type MatchAccepted = z.infer<typeof MatchAccepted>;

export const SuggestionRejected = z.strictObject({
  rejected: z.literal(true),
}).describe('One suggestion rejected, and taken out of the region\'s members.');
export type SuggestionRejected = z.infer<typeof SuggestionRejected>;

export const MatchAcceptedRestRejected = z.strictObject({
  accepted: z.literal(true),
  rejected: z.literal(true),
}).describe('One suggestion accepted and the region\'s other open ones rejected.');
export type MatchAcceptedRestRejected = z.infer<typeof MatchAcceptedRestRejected>;

export const MatchesAccepted = z.strictObject({
  accepted: z.number().int().describe('Assignments written.'),
}).describe('A batch of region and division pairs accepted.');
export type MatchesAccepted = z.infer<typeof MatchesAccepted>;

export const RemainingRejected = z.strictObject({
  rejected: z.number().int(),
}).describe('A region\'s remaining open suggestions rejected.');
export type RemainingRejected = z.infer<typeof RemainingRejected>;

export const MatchReset = z.strictObject({
  reset: z.literal(true),
}).describe('A region\'s suggestions, rejections and members cleared.');
export type MatchReset = z.infer<typeof MatchReset>;

export const InstancesSynced = z.strictObject({
  synced: z.number().int().describe('Other instances of the same region the decisions were copied to.'),
}).describe('A region\'s match decisions copied to its other instances in the tree.');
export type InstancesSynced = z.infer<typeof InstancesSynced>;

// ---------------------------------------------------------------------------
// A division moved from the region that held it
// ---------------------------------------------------------------------------

export const TransferAccepted = z.strictObject({
  transferred: z.number().int(),
  transferType: z.enum(['direct', 'split']),
}).describe('Divisions moved from their donor region to the target, in one transaction (ADR-0012).');
export type TransferAccepted = z.infer<typeof TransferAccepted>;

export const TransferPreview = z.strictObject({
  type: z.literal('FeatureCollection'),
  features: z.array(z.strictObject({
    type: z.literal('Feature'),
    properties: z.strictObject({
      role: z.enum(['donor', 'moving', 'target_outline']),
      name: z.string(),
    }),
    geometry: AreaGeometry,
  })),
}).describe('What a transfer would do, drawn: the donor\'s division, the divisions that would move, and the target\'s outline (ADR-0012).');
export type TransferPreview = z.infer<typeof TransferPreview>;
