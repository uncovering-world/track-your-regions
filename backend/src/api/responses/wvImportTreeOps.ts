/**
 * What the world-view import review's tree operations answer (ADR-0066): the
 * success bodies of the endpoints `frontend/src/api/admin/wvImportTreeOps.ts`
 * calls, declared once: a reviewer's edits to the imported tree (removing,
 * merging, pruning, flattening, collapsing, renaming and moving regions,
 * simplifying their divisions, resolving a container's leaves, undoing the last
 * of these), the checks that propose such edits (smart simplify, overlaps
 * between siblings, a model's review of a region's children), a region's review
 * state, and the batch verdicts on a region's suggestions.
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`, and
 * the handler sends its body through `respond()`, which holds it to the schema.
 * Imports are held to the list in the header of `curation.ts` beside this file,
 * which also says why.
 */

import { z } from 'zod/v4';
import { AreaGeometry } from './regions.js';
import { SpatialAnomaly } from './wvImportCvMatch.js';

export const SelectionAccepted = z.strictObject({
  accepted: z.number().int().describe('Divisions of the selection that are the region\'s members now.'),
  rejected: z.number().int().describe('The region\'s other open suggestions, rejected.'),
}).describe('A selection of a region\'s suggestions accepted, and the rest rejected.');
export type SelectionAccepted = z.infer<typeof SelectionAccepted>;

export const SelectionRejected = z.strictObject({
  rejected: z.number().int().describe('Suggestions of the selection marked rejected.'),
}).describe('A selection of a region\'s suggestions rejected, and taken out of its members.');
export type SelectionRejected = z.infer<typeof SelectionRejected>;

// ---------------------------------------------------------------------------
// Edits to the tree
// ---------------------------------------------------------------------------

export const UndoOperation = z.enum([
  'dismiss-children', 'handle-as-grouping', 'smart-flatten', 'collapse-to-parent', 'auto-resolve-children', 'prune-to-leaves',
]).describe('A tree edit that can be undone: the store keeps the last one per world view.');
export type UndoOperation = z.infer<typeof UndoOperation>;

export const ChildrenDismissed = z.strictObject({
  dismissed: z.number().int().describe('Descendant regions deleted.'),
  undoAvailable: z.literal(true),
}).describe('A region\'s descendants deleted, making it a leaf.');
export type ChildrenDismissed = z.infer<typeof ChildrenDismissed>;

export const DescendantsPruned = z.strictObject({
  pruned: z.number().int().describe('Regions below the direct children, deleted.'),
  undoAvailable: z.literal(true),
}).describe('A region\'s grandchildren and everything below deleted, making its children leaves.');
export type DescendantsPruned = z.infer<typeof DescendantsPruned>;

export const ChildMerged = z.strictObject({
  merged: z.literal(true),
  childId: z.number().int(),
  childName: z.string(),
}).describe('A region\'s only child merged into it: its members, children and import state moved up, the child deleted.');
export type ChildMerged = z.infer<typeof ChildMerged>;

export const RegionRemovedKeepingChildren = z.strictObject({
  removed: z.literal(true),
  regionName: z.string(),
  childrenReparented: z.number().int().describe('Children moved up to the removed region\'s parent.'),
  divisionsReparented: z.number().int().describe('Divisions moved up to the parent, where they were asked to be.'),
}).describe('A region removed, its children moved up to its parent.');
export type RegionRemovedKeepingChildren = z.infer<typeof RegionRemovedKeepingChildren>;

export const RegionRemovedWithBranch = z.strictObject({
  removed: z.literal(true),
  regionName: z.string(),
  descendantsRemoved: z.number().int(),
}).describe('A region removed with everything below it.');
export type RegionRemovedWithBranch = z.infer<typeof RegionRemovedWithBranch>;

export const RegionRemoved = z.union([RegionRemovedKeepingChildren, RegionRemovedWithBranch])
  .describe('A region removed from the import, told apart by whether its children were kept.');
export type RegionRemoved = z.infer<typeof RegionRemoved>;

export const SimplifyReplacement = z.strictObject({
  parentName: z.string(),
  parentPath: z.string(),
  replacedCount: z.number().int().describe('The member divisions that together cover the parent, replaced by it.'),
}).describe('A GADM parent that took the place of its children in a region\'s members.');
export type SimplifyReplacement = z.infer<typeof SimplifyReplacement>;

export const HierarchySimplified = z.strictObject({
  replacements: z.array(SimplifyReplacement),
  totalReduced: z.number().int().describe('How many fewer members the region has.'),
}).describe('A region\'s members simplified: every GADM parent its members cover whole takes their place, upward until none does.');
export type HierarchySimplified = z.infer<typeof HierarchySimplified>;

export const ChildrenSimplified = z.strictObject({
  results: z.array(z.strictObject({
    regionId: z.number().int(),
    regionName: z.string(),
    replacements: z.array(SimplifyReplacement),
    totalReduced: z.number().int(),
  })).describe('One entry per child that changed.'),
  totalSimplified: z.number().int(),
}).describe('The members of each child of a region simplified, one child at a time.');
export type ChildrenSimplified = z.infer<typeof ChildrenSimplified>;

export const OperationUndone = z.strictObject({
  undone: z.literal(true),
  operation: UndoOperation,
}).describe('The world view\'s last undoable tree edit, reverted.');
export type OperationUndone = z.infer<typeof OperationUndone>;

export const AutoResolveMatch = z.strictObject({
  regionId: z.number().int(),
  regionName: z.string(),
  divisionId: z.number().int(),
  divisionName: z.string(),
  similarity: z.number().describe('The name match\'s trigram similarity, 0 to 1.'),
  geoSimilarity: z.number().nullable().describe('How far the division overlaps the leaf\'s geoshape, 0 to 1; null without a geoshape.'),
  action: z.enum(['auto_matched', 'needs_review']),
}).describe('A leaf\'s best name match, and what resolving would do with it.');
export type AutoResolveMatch = z.infer<typeof AutoResolveMatch>;

export const AutoResolvePreview = z.strictObject({
  autoMatched: z.array(AutoResolveMatch),
  needsReview: z.array(AutoResolveMatch),
  unmatched: z.array(z.strictObject({
    id: z.number().int(),
    name: z.string(),
  })),
  parentMembers: z.strictObject({
    kept: z.array(z.strictObject({
      divisionId: z.number().int(),
      name: z.string(),
    })),
    redundant: z.array(z.strictObject({
      divisionId: z.number().int(),
      name: z.string(),
      coverage: z.number().describe('How much of it the matched leaves cover, 0 to 1.'),
    })),
  }).describe('The container\'s own divisions, and which of them its matched leaves would cover.'),
  total: z.number().int(),
}).describe('What resolving a container\'s unmatched leaves would do, without doing it. No screen calls it.');
export type AutoResolvePreview = z.infer<typeof AutoResolvePreview>;

export const ChildrenAutoResolved = z.strictObject({
  resolved: z.number().int().describe('Leaves whose name match overlaps their geoshape by half or more, assigned.'),
  review: z.number().int().describe('Leaves whose match overlaps less, or has no geoshape to compare, left as suggestions.'),
  total: z.number().int().describe('Unmatched leaves the container had.'),
  failed: z.array(z.strictObject({
    id: z.number().int(),
    name: z.string(),
  })).describe('Leaves with no name match, or whose match does not overlap their geoshape at all.'),
  parentMembersKept: z.number().int().describe('The container\'s own divisions, which it keeps.'),
  undoAvailable: z.literal(true),
}).describe('A container\'s unmatched leaves matched by name, and checked against their geoshapes.');
export type ChildrenAutoResolved = z.infer<typeof ChildrenAutoResolved>;

export const ChildRegionAdded = z.strictObject({
  created: z.literal(true),
  regionId: z.number().int(),
}).describe('A child region added to the imported tree.');
export type ChildRegionAdded = z.infer<typeof ChildRegionAdded>;

export const RegionRenamed = z.strictObject({
  renamed: z.literal(true),
  regionId: z.number().int(),
  oldName: z.string(),
  newName: z.string(),
}).describe('A region renamed.');
export type RegionRenamed = z.infer<typeof RegionRenamed>;

export const RegionReparented = z.strictObject({
  reparented: z.literal(true),
  regionId: z.number().int(),
  oldParentId: z.number().int().nullable().describe('Null for a root.'),
  newParentId: z.number().int().nullable().describe('Null to make it a root.'),
  noChange: z.literal(true).optional().describe('Sent when the region already had that parent.'),
}).describe('A region moved under another parent.');
export type RegionReparented = z.infer<typeof RegionReparented>;

// ---------------------------------------------------------------------------
// A region's review state
// ---------------------------------------------------------------------------

export const HierarchyWarningsDismissed = z.strictObject({
  dismissed: z.literal(true),
}).describe('A region\'s hierarchy warnings marked reviewed.');
export type HierarchyWarningsDismissed = z.infer<typeof HierarchyWarningsDismissed>;

export const MembersCleared = z.strictObject({
  cleared: z.number().int().describe('Member divisions removed.'),
}).describe('A region\'s member divisions removed; it goes back to review, or to no candidates where no suggestion is open.');
export type MembersCleared = z.infer<typeof MembersCleared>;

export const MapImageSelected = z.strictObject({
  selected: z.literal(true),
}).describe('One of a region\'s map image candidates chosen as its map, or the choice cleared.');
export type MapImageSelected = z.infer<typeof MapImageSelected>;

export const ManualFixMarked = z.strictObject({
  updated: z.literal(true),
}).describe('A region marked as needing a manual fix, or unmarked.');
export type ManualFixMarked = z.infer<typeof ManualFixMarked>;

// ---------------------------------------------------------------------------
// Flattening and collapsing
// ---------------------------------------------------------------------------

export const FlattenBlocked = z.strictObject({
  blocked: z.literal(true),
  unmatched: z.array(z.strictObject({
    id: z.number().int(),
    name: z.string(),
  })).describe('Descendants with no clear GADM match by name, which have to be matched first.'),
}).describe('A flatten refused, naming the descendants that stop it.');
export type FlattenBlocked = z.infer<typeof FlattenBlocked>;

export const FlattenPreview = z.strictObject({
  blocked: z.literal(false),
  geometry: AreaGeometry.nullable().describe('The descendants\' divisions unified; null where they have none drawn.'),
  regionMapUrl: z.string().nullable().describe('The region\'s source map, to compare against.'),
  descendants: z.number().int(),
  divisions: z.number().int().describe('Distinct divisions the region would hold.'),
}).describe('What flattening a region would leave it holding.');
export type FlattenPreview = z.infer<typeof FlattenPreview>;

export const FlattenPreviewResult = z.union([FlattenPreview, FlattenBlocked])
  .describe('A flatten\'s preview, or why it cannot run. The preview already matches what it can, so the flatten finds those done.');
export type FlattenPreviewResult = z.infer<typeof FlattenPreviewResult>;

export const FlattenDone = z.strictObject({
  blocked: z.literal(false),
  absorbed: z.number().int().describe('Descendant regions deleted.'),
  divisions: z.number().int().describe('Distinct divisions the region took from them.'),
  undoAvailable: z.literal(true),
}).describe('A region flattened: its descendants\' divisions moved into it and the descendants deleted.');
export type FlattenDone = z.infer<typeof FlattenDone>;

export const SmartFlattenResult = z.union([FlattenDone, FlattenBlocked])
  .describe('A flatten done, or why it could not run.');
export type SmartFlattenResult = z.infer<typeof SmartFlattenResult>;

export const ChildrenCollapsed = z.strictObject({
  collapsed: z.number().int().describe('Descendant regions whose suggestions and members were cleared; the regions stay.'),
  parentSuggestions: z.number().int().describe('Suggestions a database search then found for the region itself.'),
  undoAvailable: z.literal(true),
}).describe('A region\'s descendants\' matches cleared, and its own match started over with a database search.');
export type ChildrenCollapsed = z.infer<typeof ChildrenCollapsed>;

export const ChildrenGrouped = z.strictObject({
  matched: z.number().int(),
  total: z.number().int(),
  undoAvailable: z.literal(true),
}).describe('A region\'s children matched as countries, within the divisions the region holds.');
export type ChildrenGrouped = z.infer<typeof ChildrenGrouped>;

// ---------------------------------------------------------------------------
// Smart simplify
// ---------------------------------------------------------------------------

export const SmartSimplifyMove = z.strictObject({
  gadmParentId: z.number().int(),
  gadmParentName: z.string(),
  gadmParentPath: z.string(),
  totalChildren: z.number().int().describe('The GADM parent\'s children, all held among the siblings.'),
  ownerRegionId: z.number().int().describe('The sibling holding most of them, which would take the rest.'),
  ownerRegionName: z.string(),
  divisions: z.array(z.strictObject({
    divisionId: z.number().int(),
    name: z.string(),
    fromRegionId: z.number().int(),
    fromRegionName: z.string(),
    memberRowId: z.number().int(),
  })).describe('The members other siblings hold, which would move to the owner.'),
}).describe('A GADM parent whose children are split among siblings, gathered into one of them so it can be simplified.');
export type SmartSimplifyMove = z.infer<typeof SmartSimplifyMove>;

export const SmartSimplifyMoves = z.strictObject({
  moves: z.array(SmartSimplifyMove).describe('Most divisions to move first.'),
  spatialAnomalies: z.array(SpatialAnomaly),
}).describe('The moves that would let a region\'s children simplify, and the pieces of them cut off from the rest.');
export type SmartSimplifyMoves = z.infer<typeof SmartSimplifyMoves>;

export const SmartSimplifyApplied = z.strictObject({
  moved: z.number().int().describe('Member rows moved to the owner, duplicates it already held counted as moved.'),
}).describe('One smart simplify move applied.');
export type SmartSimplifyApplied = z.infer<typeof SmartSimplifyApplied>;

// ---------------------------------------------------------------------------
// Overlaps between siblings
// ---------------------------------------------------------------------------

export const DivisionOverlap = z.strictObject({
  divisionId: z.number().int(),
  divisionPath: z.string().describe('The division\'s GADM path, root first.'),
  regions: z.array(z.strictObject({
    regionId: z.number().int(),
    regionName: z.string(),
    viaDivisionId: z.number().int(),
    viaDivisionName: z.string(),
    isDirect: z.boolean().describe('False where the sibling holds it through a coarser ancestor.'),
  })),
}).describe('A division two or more siblings cover.');
export type DivisionOverlap = z.infer<typeof DivisionOverlap>;

export const DivisionOverlaps = z.strictObject({
  overlaps: z.array(DivisionOverlap).describe('By path.'),
}).describe('The divisions a region\'s children cover more than once.');
export type DivisionOverlaps = z.infer<typeof DivisionOverlaps>;

export const OverlapGadmChild = z.strictObject({
  divisionId: z.number().int(),
  name: z.string(),
  hasChildren: z.boolean(),
  areaKm2: z.number().int().nullable(),
  assignedToRegionId: z.number().int().nullable().describe('The sibling already holding it, if one does.'),
}).describe('A GADM child of an overlapping division, which a split would hand to one sibling.');
export type OverlapGadmChild = z.infer<typeof OverlapGadmChild>;

export const OverlapChildren = z.strictObject({
  children: z.array(OverlapGadmChild).describe('By name.'),
  canSplit: z.boolean().describe('False where the division has no drawn GADM children.'),
}).describe('What splitting an overlapping division would hand out.');
export type OverlapChildren = z.infer<typeof OverlapChildren>;

export const OverlapKept = z.strictObject({
  success: z.literal(true),
  action: z.literal('keep'),
  removed: z.number().int().describe('Siblings the division was taken from.'),
}).describe('An overlap resolved by keeping the division in one sibling.');
export type OverlapKept = z.infer<typeof OverlapKept>;

export const OverlapSplit = z.strictObject({
  success: z.literal(true),
  action: z.literal('split'),
  assigned: z.number().int().describe('GADM children handed to siblings.'),
}).describe('An overlap resolved by splitting the coarse division into its GADM children.');
export type OverlapSplit = z.infer<typeof OverlapSplit>;

export const OverlapResolved = z.union([OverlapKept, OverlapSplit])
  .describe('An overlap between siblings resolved.');
export type OverlapResolved = z.infer<typeof OverlapResolved>;

// ---------------------------------------------------------------------------
// A model's review of a region's children
// ---------------------------------------------------------------------------

export const ChildAction = z.strictObject({
  type: z.enum(['add', 'remove', 'rename', 'enrich']),
  name: z.string().describe('The child to add, or the existing child the action is on.'),
  newName: z.string().optional().describe('Sent with a rename.'),
  reason: z.string(),
  sourceUrl: z.string().nullable().describe('The child\'s Wikivoyage page, where one was found and verified.'),
  sourceExternalId: z.string().nullable().describe('The page\'s Wikidata item.'),
  verified: z.boolean().describe('Whether the Wikivoyage page was found to exist.'),
}).describe('One change a model proposes to a region\'s children.');
export type ChildAction = z.infer<typeof ChildAction>;

export const ChildrenReviewed = z.strictObject({
  actions: z.array(ChildAction),
  analysis: z.string().describe('The model\'s own account, or its unparsed reply.'),
  stats: z.strictObject({
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    cost: z.number().describe('In US dollars.'),
  }).nullable().describe('Null where no model was called.'),
}).describe('A model\'s review of a region\'s children against its Wikivoyage page\'s region list.');
export type ChildrenReviewed = z.infer<typeof ChildrenReviewed>;
