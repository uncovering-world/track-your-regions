/**
 * Admin WorldView Import — Tree Operations
 *
 * Hierarchy mutations: handle-as-grouping, dismiss children, simplify (hierarchy
 * + children), undo, add/remove/rename region, AI review children, mark manual
 * fix, select map image, smart simplify (detect + apply).
 */

import type {
  ChildMerged, ChildRegionAdded, ChildrenAutoResolved, ChildrenCollapsed, ChildrenDismissed, ChildrenGrouped,
  ChildrenReviewed, ChildrenSimplified, DescendantsPruned, DivisionOverlaps, FlattenPreviewResult, HierarchySimplified,
  HierarchyWarningsDismissed, ManualFixMarked, MapImageSelected, MembersCleared, OperationUndone, OverlapChildren,
  OverlapResolved, RegionRemoved, RegionRenamed, RegionReparented, SelectionAccepted, SelectionRejected,
  SmartFlattenResult, SmartSimplifyApplied, SmartSimplifyMoves,
} from '../client.generated';
import {
  postAdminWvImportMatchesByWorldViewIdAcceptBatchAndRejectRest,
  postAdminWvImportMatchesByWorldViewIdAddChildRegion, postAdminWvImportMatchesByWorldViewIdAiSuggestChildren,
  postAdminWvImportMatchesByWorldViewIdAutoResolveChildren, postAdminWvImportMatchesByWorldViewIdCheckOverlap,
  postAdminWvImportMatchesByWorldViewIdClearMembers, postAdminWvImportMatchesByWorldViewIdCollapseToParent,
  postAdminWvImportMatchesByWorldViewIdDismissChildren,
  postAdminWvImportMatchesByWorldViewIdDismissHierarchyWarnings,
  postAdminWvImportMatchesByWorldViewIdHandleAsGrouping, postAdminWvImportMatchesByWorldViewIdMarkManualFix,
  postAdminWvImportMatchesByWorldViewIdMergeChild, postAdminWvImportMatchesByWorldViewIdOverlapChildren,
  postAdminWvImportMatchesByWorldViewIdPruneToLeaves, postAdminWvImportMatchesByWorldViewIdRejectBatch,
  postAdminWvImportMatchesByWorldViewIdRemoveRegion, postAdminWvImportMatchesByWorldViewIdRenameRegion,
  postAdminWvImportMatchesByWorldViewIdReparentRegion, postAdminWvImportMatchesByWorldViewIdResolveOverlap,
  postAdminWvImportMatchesByWorldViewIdSelectMapImage, postAdminWvImportMatchesByWorldViewIdSimplifyChildren,
  postAdminWvImportMatchesByWorldViewIdSimplifyHierarchy, postAdminWvImportMatchesByWorldViewIdSmartFlatten,
  postAdminWvImportMatchesByWorldViewIdSmartFlattenPreview, postAdminWvImportMatchesByWorldViewIdSmartSimplify,
  postAdminWvImportMatchesByWorldViewIdSmartSimplifyApplyMove, postAdminWvImportMatchesByWorldViewIdUndo,
  type WvImportResolveOverlapBody,
} from '../client.generated';

// What this module's calls answer is declared once, as a backend schema
// (ADR-0066), and generated into `client.generated.ts`. Passed on from here, so a
// component imports a call's answer from the module of the call. A spatial
// anomaly is declared with the colour-match stream, which sends it too.
export type {
  ChildAction, ChildMerged, ChildRegionAdded, ChildrenAutoResolved, ChildrenCollapsed, ChildrenDismissed,
  ChildrenGrouped, ChildrenReviewed, ChildrenSimplified, DescendantsPruned, DivisionOverlap, DivisionOverlaps,
  FlattenBlocked, FlattenDone, FlattenPreview, FlattenPreviewResult, HierarchySimplified, HierarchyWarningsDismissed,
  ManualFixMarked, MapImageSelected, MembersCleared, OperationUndone, OverlapChildren, OverlapGadmChild, OverlapKept,
  OverlapResolved, OverlapSplit, RegionRemoved, RegionRemovedKeepingChildren, RegionRemovedWithBranch, RegionRenamed,
  RegionReparented, SelectionAccepted, SelectionRejected, SimplifyReplacement, SmartFlattenResult, SmartSimplifyApplied,
  SmartSimplifyMove, SmartSimplifyMoves, SpatialAnomaly, SpatialAnomalyDivision, UndoOperation,
} from '../client.generated';


// =============================================================================
// Handle-as-Grouping / Dismiss Children
// =============================================================================

export async function handleAsGrouping(
  worldViewId: number,
  regionId: number,
): Promise<ChildrenGrouped> {
  return postAdminWvImportMatchesByWorldViewIdHandleAsGrouping(worldViewId, { regionId });
}

export async function dismissChildren(
  worldViewId: number,
  regionId: number,
): Promise<ChildrenDismissed> {
  return postAdminWvImportMatchesByWorldViewIdDismissChildren(worldViewId, { regionId });
}

// =============================================================================
// Simplify Hierarchy
// =============================================================================

export async function simplifyHierarchy(
  worldViewId: number,
  regionId: number,
): Promise<HierarchySimplified> {
  return postAdminWvImportMatchesByWorldViewIdSimplifyHierarchy(worldViewId, { regionId });
}

// =============================================================================
// Simplify Children
// =============================================================================

export async function simplifyChildren(
  worldViewId: number,
  parentRegionId: number,
): Promise<ChildrenSimplified> {
  return postAdminWvImportMatchesByWorldViewIdSimplifyChildren(worldViewId, { regionId: parentRegionId });
}

// =============================================================================
// Undo
// =============================================================================

export async function undoLastOperation(
  worldViewId: number,
): Promise<OperationUndone> {
  return postAdminWvImportMatchesByWorldViewIdUndo(worldViewId);
}

// =============================================================================
// Add / Remove / Rename Region
// =============================================================================

export async function addChildRegion(
  worldViewId: number,
  parentRegionId: number,
  name: string,
  sourceUrl?: string,
  sourceExternalId?: string,
): Promise<ChildRegionAdded> {
  return postAdminWvImportMatchesByWorldViewIdAddChildRegion(worldViewId, { parentRegionId, name, sourceUrl, sourceExternalId });
}

export async function removeRegionFromImport(
  worldViewId: number,
  regionId: number,
  reparentChildren: boolean,
  reparentDivisions?: boolean,
): Promise<RegionRemoved> {
  return postAdminWvImportMatchesByWorldViewIdRemoveRegion(worldViewId, { regionId, reparentChildren, reparentDivisions });
}

export async function renameRegion(
  worldViewId: number,
  regionId: number,
  name: string,
  sourceUrl?: string,
  sourceExternalId?: string,
): Promise<RegionRenamed> {
  return postAdminWvImportMatchesByWorldViewIdRenameRegion(worldViewId, { regionId, name, sourceUrl, sourceExternalId });
}

// =============================================================================
// AI Review / Suggest Children
// =============================================================================

export async function aiReviewChildren(
  worldViewId: number,
  regionId: number,
): Promise<ChildrenReviewed> {
  return postAdminWvImportMatchesByWorldViewIdAiSuggestChildren(worldViewId, { regionId });
}

/** Modern alias for aiReviewChildren — same endpoint, different name in newer call sites */
export const aiSuggestChildren = aiReviewChildren;

// =============================================================================
// Mark Manual Fix / Select Map Image
// =============================================================================

export async function markManualFix(
  worldViewId: number,
  regionId: number,
  needsManualFix: boolean,
  fixNote?: string,
): Promise<ManualFixMarked> {
  return postAdminWvImportMatchesByWorldViewIdMarkManualFix(worldViewId, { regionId, needsManualFix, fixNote });
}

export async function selectMapImage(
  worldViewId: number,
  regionId: number,
  imageUrl: string | null,
): Promise<MapImageSelected> {
  return postAdminWvImportMatchesByWorldViewIdSelectMapImage(worldViewId, { regionId, imageUrl });
}

// =============================================================================
// Smart Simplify
// =============================================================================

export async function detectSmartSimplify(
  worldViewId: number,
  parentRegionId: number,
): Promise<SmartSimplifyMoves> {
  return postAdminWvImportMatchesByWorldViewIdSmartSimplify(worldViewId, { parentRegionId });
}

export async function applySmartFlatten(
  worldViewId: number,
  parentRegionId: number,
  ownerRegionId: number,
  memberRowIds: number[],
): Promise<SmartSimplifyApplied> {
  return postAdminWvImportMatchesByWorldViewIdSmartSimplifyApplyMove(worldViewId, { parentRegionId, ownerRegionId, memberRowIds });
}

// Backward-compat alias for older call-sites
export const applySmartSimplifyMove = applySmartFlatten;

// =============================================================================
// Prune / Smart Flatten / Merge / Collapse / Auto-Resolve
// =============================================================================

export async function pruneToLeaves(
  worldViewId: number,
  regionId: number,
): Promise<DescendantsPruned> {
  return postAdminWvImportMatchesByWorldViewIdPruneToLeaves(worldViewId, { regionId });
}

export async function smartFlatten(
  worldViewId: number,
  regionId: number,
): Promise<SmartFlattenResult> {
  return postAdminWvImportMatchesByWorldViewIdSmartFlatten(worldViewId, { regionId });
}

export async function smartFlattenPreview(
  worldViewId: number,
  regionId: number,
): Promise<FlattenPreviewResult> {
  return postAdminWvImportMatchesByWorldViewIdSmartFlattenPreview(worldViewId, { regionId });
}

export async function mergeChildIntoParent(
  worldViewId: number,
  regionId: number,
): Promise<ChildMerged> {
  return postAdminWvImportMatchesByWorldViewIdMergeChild(worldViewId, { regionId });
}

export async function collapseToParent(
  worldViewId: number,
  regionId: number,
): Promise<ChildrenCollapsed> {
  return postAdminWvImportMatchesByWorldViewIdCollapseToParent(worldViewId, { regionId });
}

export async function autoResolveChildren(
  worldViewId: number,
  regionId: number,
): Promise<ChildrenAutoResolved> {
  return postAdminWvImportMatchesByWorldViewIdAutoResolveChildren(worldViewId, { regionId });
}

export async function reparentRegion(
  worldViewId: number,
  regionId: number,
  newParentId: number | null,
): Promise<RegionReparented> {
  return postAdminWvImportMatchesByWorldViewIdReparentRegion(worldViewId, { regionId, newParentId });
}

export async function dismissHierarchyWarnings(
  worldViewId: number,
  regionId: number,
): Promise<HierarchyWarningsDismissed> {
  return postAdminWvImportMatchesByWorldViewIdDismissHierarchyWarnings(worldViewId, { regionId });
}

export async function clearRegionMembers(
  worldViewId: number,
  regionId: number,
): Promise<MembersCleared> {
  return postAdminWvImportMatchesByWorldViewIdClearMembers(worldViewId, { regionId });
}

// =============================================================================
// Batch accept/reject
// =============================================================================

export async function acceptBatchAndRejectRest(
  worldViewId: number,
  regionId: number,
  divisionIds: number[],
): Promise<SelectionAccepted> {
  return postAdminWvImportMatchesByWorldViewIdAcceptBatchAndRejectRest(worldViewId, { regionId, divisionIds });
}

export async function rejectBatchSuggestions(
  worldViewId: number,
  regionId: number,
  divisionIds: number[],
): Promise<SelectionRejected> {
  return postAdminWvImportMatchesByWorldViewIdRejectBatch(worldViewId, { regionId, divisionIds });
}

// =============================================================================
// Division Overlap Detection / Resolution
// =============================================================================

export async function checkDivisionOverlap(
  worldViewId: number,
  parentRegionId: number,
): Promise<DivisionOverlaps> {
  return postAdminWvImportMatchesByWorldViewIdCheckOverlap(worldViewId, { parentRegionId });
}

export async function getOverlapDivisionChildren(
  worldViewId: number,
  divisionId: number,
  regionIds: number[],
): Promise<OverlapChildren> {
  return postAdminWvImportMatchesByWorldViewIdOverlapChildren(worldViewId, { divisionId, childRegionIds: regionIds });
}

/** Keep a division in one region, or split its coarse parent into GADM children. */
export type OverlapResolution = WvImportResolveOverlapBody;

export async function resolveOverlap(
  worldViewId: number,
  resolution: OverlapResolution,
): Promise<OverlapResolved> {
  return postAdminWvImportMatchesByWorldViewIdResolveOverlap(worldViewId, resolution);
}
