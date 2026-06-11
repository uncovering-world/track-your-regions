/**
 * actionHelp.ts — Tooltip content for every ActionPanel action.
 *
 * Descriptions verified against the backend handlers.
 */

export interface ActionHelp {
  title: string;
  description: string;
  /** Short statement shown in italic when the button is disabled. */
  requires?: string;
}

export const ACTION_HELP: Record<string, ActionHelp> = {
  // ── Match methods ──────────────────────────────────────────────────────────

  geoshapeMatch: {
    title: 'Geoshape match',
    description:
      "Fetches the region's Wikidata geoshape and scores GADM divisions by IoU " +
      '(Intersection over Union). High-confidence hits are auto-accepted; the rest ' +
      'become suggestions for manual review.',
    requires: 'Wikidata ID',
  },

  pointsMatch: {
    title: 'Points match',
    description:
      'Parses Wikivoyage {{marker}} and {{geo}} templates to get coordinates, then ' +
      'finds GADM divisions that spatially contain those points. Results become suggestions.',
    requires: 'Wikidata ID',
  },

  geocode: {
    title: 'Geocode',
    description:
      'Geocodes the region name via Nominatim (OpenStreetMap) and uses ST_Contains ' +
      'to find GADM divisions at every level. Works even when names differ — as long as ' +
      'Nominatim can locate the place.',
  },

  dbSearch: {
    title: 'DB search',
    description:
      'Searches GADM divisions using PostgreSQL pg_trgm trigram similarity. ' +
      'Returns up to 5 candidates scored > 0.3, catching spelling variants like ' +
      '"Ingushetia" vs "Ingush".',
  },

  aiMatch: {
    title: 'AI match',
    description:
      'Sends the region name to an OpenAI model for intelligent matching. Results are ' +
      'added as suggestions for you to accept or reject — never auto-assigned.',
  },

  autoResolveSubtree: {
    title: 'Auto-resolve subtree',
    description:
      'Targets unmatched (no_candidates) leaf descendants only. Uses name trigram search ' +
      'plus geo-similarity to classify each: strong matches (geo-sim ≥ 0.5) are auto-assigned; ' +
      'weaker matches become needs_review suggestions; zero-overlap candidates are discarded.',
    requires: 'Parent node (has children)',
  },

  divisionSearch: {
    title: 'Division search',
    description:
      'Opens a search dialog to find and accept a GADM division by name. ' +
      'Use this when automated methods miss the correct division or return noisy results.',
  },

  matchChildrenIndependently: {
    title: 'Match children independently',
    description:
      "Clears this region's own match and re-runs matching on each child independently. " +
      'Useful for sub-continents or large countries whose children should each map ' +
      'to their own GADM division.',
    requires: 'Parent node (has children)',
  },

  cvColorMatch: {
    title: 'CV color match',
    description:
      'Streams a computer-vision pipeline that compares a color-coded region map image ' +
      'against GADM division polygons to assign each color cluster to a child region. ' +
      'Includes interactive water-detection and cluster-review steps.',
    requires: 'Region map image (regionMapUrl) and child regions',
  },

  mapshapeMatch: {
    title: 'Mapshape match',
    description:
      "Fetches Wikivoyage Kartographer {{mapshape}} templates from the region's article " +
      'and matches each named shape to GADM divisions by coverage. Results open in the ' +
      'same review dialog as CV color match.',
    requires: 'Wikivoyage source URL (sourceUrl) and child regions',
  },

  // ── Hierarchy actions ──────────────────────────────────────────────────────

  aiReviewChildren: {
    title: 'AI review children',
    description:
      "Fetches the region's live Wikivoyage article and asks an AI to audit the current " +
      'child set, surfacing missing, removed, or renamed sub-regions for the admin to apply.',
  },

  rename: {
    title: 'Rename',
    description:
      'Renames this region in the import tree. Optionally updates its Wikivoyage ' +
      'source URL and Wikidata external ID.',
  },

  reparent: {
    title: 'Reparent',
    description:
      'Moves this region under a different parent in the hierarchy. ' +
      'All children and assignments travel with it.',
  },

  addChild: {
    title: 'Add child',
    description:
      'Creates a new child region under this node with match status "no candidates". ' +
      'Useful for adding sub-regions that are missing from the Wikivoyage import.',
  },

  remove: {
    title: 'Remove',
    description:
      'Deletes this region from the import tree. You can choose to reparent its children ' +
      'or its GADM division assignments to the grandparent.',
  },

  // ── Restructure ops ────────────────────────────────────────────────────────

  dismissChildren: {
    title: 'Dismiss children',
    description:
      'Deletes all descendant regions and their GADM members, making this node a leaf. ' +
      'Use when the sub-regions are not needed and the parent should own its divisions directly. ' +
      'Supports undo.',
  },

  pruneToLeaves: {
    title: 'Prune to leaves',
    description:
      'Unconditionally deletes all grandchildren and deeper — direct children are kept and ' +
      'become leaves. Destructive: everything below the first child level is permanently removed. ' +
      'Supports undo.',
  },

  collapseToParent: {
    title: 'Collapse to parent',
    description:
      'Keeps all child regions in place, but clears every descendant\'s assignments and ' +
      'suggestions (reset to no_candidates) and also clears this node\'s own assignments. ' +
      'Then generates fresh match suggestions for this node — re-match at this level instead ' +
      'of per-child. Nothing is moved or deleted. Supports undo.',
  },

  mergeSingleChild: {
    title: 'Merge single child',
    description:
      'When this region has exactly one child, absorbs the child\'s divisions, suggestions, ' +
      'and source metadata into this node, then removes the child. The parent keeps its own name.',
    requires: 'Exactly one child',
  },

  smartFlatten: {
    title: 'Smart flatten',
    description:
      'Auto-matches any unmatched descendants by name, then absorbs ALL descendant divisions ' +
      'into this node and deletes all descendant regions, making this node a leaf. Blocked if ' +
      'any descendant stays unmatched after auto-matching. Not selective — the entire subtree ' +
      'is collapsed. Destructive. Supports undo.',
  },

  restructure: {
    title: 'Restructure',
    description:
      'Tree-shaping operations for this node — each menu entry explains what it changes. ' +
      'The destructive ones support undo right after running.',
  },

  // ── Cleanup & checks ───────────────────────────────────────────────────────

  simplify: {
    title: 'Simplify',
    description:
      "Replaces a region's GADM division members with a single parent-level entry whenever " +
      'all siblings in the GADM tree are already covered. Cascades upward until no further ' +
      'collapse is possible.',
  },

  simplifyChildren: {
    title: 'Simplify children',
    description:
      'Runs Simplify on each direct child independently. Useful after a CV or mapshape match ' +
      'assigns many fine-grained divisions that could be folded into GADM parents.',
    requires: 'Parent node (has children)',
  },

  smartSimplify: {
    title: 'Smart simplify',
    description:
      "Detects cross-sibling division splits — where a GADM parent's children are scattered " +
      'across multiple sibling regions — and proposes consolidation moves to the majority owner.',
  },

  overlapCheck: {
    title: 'Overlap check',
    description:
      'Finds GADM divisions assigned to more than one child of this region. ' +
      'Opens a resolution dialog so duplicates can be moved or removed.',
  },

  clearMembers: {
    title: 'Clear members',
    description:
      'Removes all GADM division members from this region without changing its match status. ' +
      'Use before re-running a match method from scratch.',
  },

  resetMatch: {
    title: 'Reset match',
    description:
      'Clears all suggestions, rejections, and assigned members, resetting match status to ' +
      '"no candidates". Useful when cached suggestions from a previous search pollute results.',
  },

  waiveAssignment: {
    title: 'Waive assignment',
    description:
      'Marks this leaf as intentionally unassigned (e.g. an uninhabited territory). ' +
      'Waived leaves are excluded from "unassigned" blockers in the checks bar.',
  },

  unwaiveAssignment: {
    title: 'Unwaive assignment',
    description:
      'Restores this leaf to normal status. It will again appear in the "unassigned" ' +
      'blocker list if it lacks division members.',
  },

  manualFixFlag: {
    title: 'Manual-fix flag',
    description:
      'Records a note that this region requires manual attention before sign-off. ' +
      'Flagged regions show a warning chip and block sign-off until resolved.',
  },

  syncInstances: {
    title: 'Sync instances',
    description:
      'Copies match state (status, suggestions, division members) from this region to all ' +
      'other regions that share the same Wikivoyage source URL. ' +
      'Useful for regions that appear under multiple continents.',
    requires: 'Another region with the same source URL',
  },
};
