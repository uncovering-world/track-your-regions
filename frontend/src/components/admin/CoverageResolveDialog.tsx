/**
 * Coverage Resolve Dialog
 *
 * Dedicated large dialog for resolving GADM coverage gaps.
 * Features an interactive gap tree (left panel) and inline map preview (right panel)
 * where every node (top-level, intermediate, or leaf) can be individually
 * suggested, previewed, and approved.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Button,
  IconButton,
  Tooltip,
  Chip,
  Collapse,
  Paper,
  LinearProgress,
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import ExpandMore from '@mui/icons-material/ExpandMore';
import ExpandLess from '@mui/icons-material/ExpandLess';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import Refresh from '@mui/icons-material/Refresh';
import type { MapRef } from 'react-map-gl/maplibre';
import * as turf from '@turf/turf';
import { useMutation, useQuery } from '@tanstack/react-query';
import { fetchDivisionGeometry } from '../../api/divisions';
import {
  geoSuggestGap,
  dismissCoverageGap,
  undismissCoverageGap,
} from '../../api/adminWorldViewImport';
import type {
  CoverageResult,
  CoverageGap,
  GeoSuggestResult,
} from '../../api/adminWorldViewImport';
import { searchRegions } from '../../api/regions';
import type { ShadowInsertion } from './WorldViewImportReview';
import { GapNodeRow } from './CoverageGapTree';
import { CoverageMapPreview } from './CoverageMapPreview';
import {
  type TreeNodeInfo,
  findSubtreeNode,
  collectSubtreeIds,
  allLeavesApplied,
} from './coverageResolveUtils';

interface CoverageResolveDialogProps {
  open: boolean;
  onClose: () => void;
  worldViewId: number;
  coverageData: CoverageResult | null;
  coverageProgress: { running: boolean; step?: string; elapsed?: number };
  shadowInsertions: ShadowInsertion[];
  onCoverageChange: (data: CoverageResult) => void;
  onApplyToTree: (insertions: ShadowInsertion[]) => void;
  onRecheck: () => void;
}

export function CoverageResolveDialog({
  open,
  onClose,
  worldViewId,
  coverageData,
  coverageProgress,
  shadowInsertions,
  onCoverageChange,
  onApplyToTree,
  onRecheck,
}: CoverageResolveDialogProps) {
  const mapRef = useRef<MapRef>(null);

  // Per-node geo-suggest results, keyed by division ID
  const [nodeSuggestions, setNodeSuggestions] = useState<Map<number, GeoSuggestResult>>(new Map());

  // Per-node selected target region (ancestor override), keyed by division ID
  const [selectedTargets, setSelectedTargets] = useState<Map<number, { id: number; name: string }>>(new Map());

  // Currently selected node for map preview
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);

  // Expanded gap groups and subtree nodes
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedNodes, setExpandedNodes] = useState<Set<number>>(new Set());

  // Dismissed section expanded
  const [dismissedExpanded, setDismissedExpanded] = useState(false);

  // Map geometry state
  const [gapGeom, setGapGeom] = useState<GeoJSON.Geometry | null>(null);
  const [suggGeom, setSuggGeom] = useState<GeoJSON.Geometry | null>(null);
  const [mapLoading, setMapLoading] = useState(false);

  // Nodes already sent to tree (grayed out until unapplied)
  const [appliedNodes, setAppliedNodes] = useState<Set<number>>(new Set());

  // Manual region search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [regionQuery, setRegionQuery] = useState('');

  const { data: regionResults, isFetching: isSearchingRegions } = useQuery({
    queryKey: ['admin', 'coverageRegionSearch', worldViewId, regionQuery],
    queryFn: () => searchRegions(worldViewId, regionQuery),
    enabled: searchOpen && regionQuery.length >= 2,
  });

  // Clear map preview on close, but preserve tree/suggestion state
  useEffect(() => {
    if (!open) {
      setSelectedNodeId(null);
      setGapGeom(null);
      setSuggGeom(null);
      setMapLoading(false);
      setSearchOpen(false);
      setRegionQuery('');
    }
  }, [open]);

  // Close search when switching nodes
  useEffect(() => {
    setSearchOpen(false);
    setRegionQuery('');
  }, [selectedNodeId]);

  // Sync appliedNodes with shadowInsertions from parent -- when shadows are
  // accepted/rejected in the match tree, remove them from our applied set
  useEffect(() => {
    // Build set of all IDs that should remain applied (shadow gap + its subtree descendants)
    const keepIds = new Set<number>();
    for (const s of shadowInsertions) {
      keepIds.add(s.gapDivisionId);
      const gap = coverageData?.gaps.find(g => g.id === s.gapDivisionId);
      if (gap?.subtree) collectSubtreeIds(gap.subtree, keepIds);
    }
    setAppliedNodes(prev => {
      const next = new Set<number>();
      for (const id of prev) {
        if (keepIds.has(id)) next.add(id);
      }
      if (next.size === prev.size) return prev; // no change -- avoid re-render
      return next;
    });
  }, [shadowInsertions, coverageData]);

  // Get the effective suggestion for a node, considering manual override
  const getNodeSuggestion = useCallback((divisionId: number, treeSuggestion: CoverageGap['suggestion'] | null) => {
    // Manual override takes highest priority (from search or context tree click)
    const override = selectedTargets.get(divisionId);
    if (override) {
      return { action: 'add_member' as const, targetRegionId: override.id, targetRegionName: override.name };
    }
    // Then geo-suggest
    const geoResult = nodeSuggestions.get(divisionId);
    if (geoResult?.suggestion) return geoResult.suggestion;
    // Then tree-based suggestion
    return treeSuggestion;
  }, [nodeSuggestions, selectedTargets]);

  // Get the geo-suggest result for map display
  const getGeoResult = useCallback((divisionId: number): GeoSuggestResult | undefined => {
    return nodeSuggestions.get(divisionId);
  }, [nodeSuggestions]);

  // Handle node selection for map preview
  const handleSelectNode = useCallback(async (divisionId: number) => {
    setSelectedNodeId(divisionId);
    setGapGeom(null);
    setSuggGeom(null);
    setMapLoading(true);

    try {
      const feature = await fetchDivisionGeometry(divisionId, 1, { detail: 'low' });
      setGapGeom((feature?.geometry as GeoJSON.Geometry) ?? null);

      const geoResult = nodeSuggestions.get(divisionId);
      if (geoResult?.suggestionDivisionId) {
        const suggFeature = await fetchDivisionGeometry(geoResult.suggestionDivisionId, 1, { detail: 'low' });
        setSuggGeom((suggFeature?.geometry as GeoJSON.Geometry) ?? null);
      }
    } finally {
      setMapLoading(false);
    }
  }, [nodeSuggestions]);

  // Fit map bounds when geometry changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !gapGeom) return;

    const geoResult = selectedNodeId ? nodeSuggestions.get(selectedNodeId) : undefined;

    if (geoResult?.gapCenter && geoResult.distanceKm) {
      // Fit to the distance circle
      const circleFeature = turf.circle(geoResult.gapCenter, geoResult.distanceKm, {
        units: 'kilometers',
        steps: 64,
      });
      const bbox = turf.bbox(circleFeature) as [number, number, number, number];
      map.fitBounds(
        [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
        { padding: 40, duration: 500 },
      );
    } else {
      // Fit to gap geometry
      const gapFC: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: gapGeom }],
      };
      const bbox = turf.bbox(gapFC) as [number, number, number, number];
      map.fitBounds(
        [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
        { padding: 40, duration: 500 },
      );
    }
  }, [gapGeom, suggGeom, selectedNodeId, nodeSuggestions]);

  // Geo-suggest mutation
  const geoSuggestMutation = useMutation({
    mutationFn: ({ divisionId }: { divisionId: number; name: string }) =>
      geoSuggestGap(worldViewId, divisionId),
    onSuccess: (data, { divisionId }) => {
      if (!data.suggestion) return;

      // Store the geo-suggest result
      setNodeSuggestions(prev => {
        const next = new Map(prev);
        next.set(divisionId, data);
        return next;
      });

      // Update coverageData for top-level gaps
      if (coverageData) {
        const gap = coverageData.gaps.find(g => g.id === divisionId);
        if (gap) {
          onCoverageChange({
            ...coverageData,
            gaps: coverageData.gaps.map(g =>
              g.id === divisionId ? { ...g, suggestion: data.suggestion } : g,
            ),
          });
        }
      }

      // Select this node and load the map preview
      setSelectedNodeId(divisionId);
      setMapLoading(true);
      setGapGeom(null);
      setSuggGeom(null);

      Promise.all([
        fetchDivisionGeometry(divisionId, 1, { detail: 'low' }),
        data.suggestionDivisionId
          ? fetchDivisionGeometry(data.suggestionDivisionId, 1, { detail: 'low' })
          : Promise.resolve(null),
      ]).then(([gapFeature, suggFeature]) => {
        setGapGeom((gapFeature?.geometry as GeoJSON.Geometry) ?? null);
        if (suggFeature) setSuggGeom((suggFeature?.geometry as GeoJSON.Geometry) ?? null);
      }).finally(() => setMapLoading(false));
    },
  });

  // Dismiss mutation -- optimistic update, no re-fetch
  const dismissGapMutation = useMutation({
    mutationFn: (divisionId: number) => dismissCoverageGap(worldViewId, divisionId),
    onSuccess: (_data, divisionId) => {
      if (!coverageData) return;
      const gap = coverageData.gaps.find(g => g.id === divisionId);
      if (!gap) return;
      onCoverageChange({
        ...coverageData,
        gaps: coverageData.gaps.filter(g => g.id !== divisionId),
        dismissedCount: coverageData.dismissedCount + 1,
        dismissedGaps: [...coverageData.dismissedGaps, { id: gap.id, name: gap.name, parentName: gap.parentName }],
      });
    },
  });

  // Undismiss mutation
  const undismissGapMutation = useMutation({
    mutationFn: (divisionId: number) => undismissCoverageGap(worldViewId, divisionId),
    onSuccess: () => onRecheck(),
  });

  // Toggle group expansion
  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Toggle subtree node expansion
  const toggleNode = useCallback((nodeId: number) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  // Group coverage gaps by parent for display
  const groupedGaps = useMemo(() => {
    if (!coverageData?.gaps.length) return [];
    type GroupedChild = CoverageGap;
    const groups = new Map<string, GroupedChild[]>();
    for (const gap of coverageData.gaps) {
      const key = gap.parentName ?? '(root -- uncovered countries)';
      const arr = groups.get(key);
      if (arr) arr.push(gap);
      else groups.set(key, [gap]);
    }
    return Array.from(groups.entries()).map(([parent, children]) => ({
      parent,
      children,
      count: children.length,
    }));
  }, [coverageData]);

  // Count gaps that have suggestions (excluding applied and children-resolved)
  const gapsWithSuggestions = useMemo(() => {
    if (!coverageData?.gaps.length) return 0;
    return coverageData.gaps.filter(g => {
      if (appliedNodes.has(g.id)) return false;
      if (g.subtree?.length && allLeavesApplied(g.subtree, appliedNodes)) return false;
      const effective = getNodeSuggestion(g.id, g.suggestion);
      return effective != null;
    }).length;
  }, [coverageData, getNodeSuggestion, appliedNodes]);

  // Handle "Apply all to tree" (skips applied and children-resolved gaps)
  const handleApplyToTree = useCallback(() => {
    if (!coverageData?.gaps) return;
    const insertions: ShadowInsertion[] = [];
    for (const gap of coverageData.gaps) {
      if (appliedNodes.has(gap.id)) continue;
      if (gap.subtree?.length && allLeavesApplied(gap.subtree, appliedNodes)) continue;
      const effective = getNodeSuggestion(gap.id, gap.suggestion);
      if (effective) {
        insertions.push({
          gapDivisionId: gap.id,
          gapDivisionName: gap.name,
          action: effective.action,
          targetRegionId: effective.targetRegionId,
        });
      }
    }
    onApplyToTree(insertions);
    onClose();
  }, [coverageData, getNodeSuggestion, appliedNodes, onApplyToTree, onClose]);

  // Handle "Apply single gap to tree"
  const handleApplySingle = useCallback((divisionId: number, divisionName: string) => {
    const gap = coverageData?.gaps.find(g => g.id === divisionId);
    const effective = getNodeSuggestion(divisionId, gap?.suggestion ?? null);
    if (!effective) return;
    onApplyToTree([{
      gapDivisionId: divisionId,
      gapDivisionName: divisionName,
      action: effective.action,
      targetRegionId: effective.targetRegionId,
    }]);
    // Mark this node + all subtree descendants as applied (parent covers children)
    setAppliedNodes(prev => {
      const next = new Set(prev);
      next.add(divisionId);
      if (gap?.subtree) collectSubtreeIds(gap.subtree, next);
      return next;
    });
  }, [coverageData, getNodeSuggestion, onApplyToTree]);

  // Undo a per-node apply (visual only -- shadow stays in tree for separate rejection)
  const handleUnapplySingle = useCallback((divisionId: number) => {
    const gap = coverageData?.gaps.find(g => g.id === divisionId);
    setAppliedNodes(prev => {
      const next = new Set(prev);
      next.delete(divisionId);
      // Also unapply all subtree descendants
      if (gap?.subtree) {
        const descendantIds = new Set<number>();
        collectSubtreeIds(gap.subtree, descendantIds);
        for (const id of descendantIds) next.delete(id);
      }
      return next;
    });
  }, [coverageData]);

  // Build GeoJSON for map
  const gapFC: GeoJSON.FeatureCollection = gapGeom
    ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: gapGeom }] }
    : { type: 'FeatureCollection', features: [] };

  const suggFC: GeoJSON.FeatureCollection = suggGeom
    ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: suggGeom }] }
    : { type: 'FeatureCollection', features: [] };

  // Circle for geo-suggest
  const selectedGeoResult = selectedNodeId ? getGeoResult(selectedNodeId) : undefined;
  const circleFeature = selectedGeoResult?.gapCenter && selectedGeoResult.distanceKm
    ? turf.circle(selectedGeoResult.gapCenter, selectedGeoResult.distanceKm, {
        units: 'kilometers',
        steps: 64,
      })
    : null;

  const circleFC: GeoJSON.FeatureCollection = circleFeature
    ? { type: 'FeatureCollection', features: [circleFeature] }
    : { type: 'FeatureCollection', features: [] };

  const markersFC: GeoJSON.FeatureCollection = selectedGeoResult?.gapCenter && selectedGeoResult?.suggestionCenter
    ? {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { type: 'gap' }, geometry: { type: 'Point', coordinates: selectedGeoResult.gapCenter } },
          { type: 'Feature', properties: { type: 'sugg' }, geometry: { type: 'Point', coordinates: selectedGeoResult.suggestionCenter } },
        ],
      }
    : { type: 'FeatureCollection', features: [] };

  // Find selected gap info for the right panel suggestion display
  const selectedGapInfo = useMemo((): TreeNodeInfo | null => {
    if (!selectedNodeId || !coverageData) return null;

    // Check top-level gaps
    const gap = coverageData.gaps.find(g => g.id === selectedNodeId);
    if (gap) {
      return {
        divisionId: gap.id,
        name: gap.name,
        isGapRoot: true,
        parentName: gap.parentName,
        hasChildren: !!gap.subtree?.length,
        suggestion: getNodeSuggestion(gap.id, gap.suggestion),
      };
    }

    // Check subtree nodes
    for (const g of coverageData.gaps) {
      if (g.subtree) {
        const found = findSubtreeNode(g.subtree, selectedNodeId);
        if (found) {
          return {
            divisionId: selectedNodeId,
            name: found.name,
            isGapRoot: false,
            parentName: g.name,
            hasChildren: found.children.length > 0,
            suggestion: getNodeSuggestion(selectedNodeId, null),
          };
        }
      }
    }
    return null;
  }, [selectedNodeId, coverageData, getNodeSuggestion]);

  const coverageChecking = coverageProgress.running;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      slotProps={{ paper: { sx: { height: '80vh' } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="h6" component="span" sx={{ flex: 1 }}>
          Coverage Resolution
        </Typography>
        <Tooltip title="Re-check coverage">
          <span>
            <IconButton
              size="small"
              onClick={onRecheck}
              disabled={coverageChecking}
            >
              <Refresh />
            </IconButton>
          </span>
        </Tooltip>
      </DialogTitle>

      <DialogContent sx={{ display: 'flex', gap: 2, p: 2, overflow: 'hidden' }}>
        {/* Left panel: Gap tree */}
        <Paper
          variant="outlined"
          sx={{
            flex: 1.2,
            overflow: 'auto',
            p: 1.5,
            minWidth: 0,
          }}
        >
          {coverageChecking && (
            <Box sx={{ py: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {coverageProgress.step ?? 'Starting...'}
                {coverageProgress.elapsed != null && (
                  <Typography component="span" variant="caption" sx={{ ml: 1 }}>
                    {coverageProgress.elapsed.toFixed(1)}s
                  </Typography>
                )}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={(() => {
                  const step = coverageProgress.step;
                  if (!step) return 0;
                  if (step.startsWith('Done')) return 100;
                  const ancestor = step.match(/^Ancestor walk (\d+)\/(\d+)/);
                  if (ancestor) return 50 + (parseInt(ancestor[1]) / parseInt(ancestor[2])) * 45;
                  if (step.startsWith('Sibling matches')) return 50;
                  if (step.includes('sibling')) return 30;
                  if (step.includes('Found')) return 25;
                  return 10;
                })()}
              />
            </Box>
          )}

          {coverageData && !coverageChecking && (
            coverageData.gaps.length === 0 ? (
              <Box sx={{ py: 4, textAlign: 'center' }}>
                <CheckCircleOutline sx={{ fontSize: 48, color: 'success.main', mb: 1 }} />
                <Typography variant="h6" color="success.main">
                  All GADM divisions covered
                </Typography>
                {coverageData.dismissedCount > 0 && (
                  <Typography variant="body2" color="text.secondary">
                    {coverageData.dismissedCount} dismissed
                  </Typography>
                )}
              </Box>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {coverageData.gaps.length} gap{coverageData.gaps.length !== 1 ? 's' : ''} remaining
                  {coverageData.dismissedCount > 0 && ` (${coverageData.dismissedCount} dismissed)`}
                </Typography>

                {groupedGaps.map(group => (
                  <Box key={group.parent} sx={{ mb: 0.5 }}>
                    {/* Group header */}
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        cursor: 'pointer',
                        py: 0.5,
                        px: 0.5,
                        borderRadius: 1,
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                      onClick={() => toggleGroup(group.parent)}
                    >
                      {expandedGroups.has(group.parent)
                        ? <ExpandLess fontSize="small" sx={{ color: 'text.secondary' }} />
                        : <ExpandMore fontSize="small" sx={{ color: 'text.secondary' }} />
                      }
                      <Typography variant="subtitle2" sx={{ ml: 0.5, flex: 1 }}>
                        {group.parent}
                      </Typography>
                      <Chip label={group.count} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.75rem' }} />
                    </Box>

                    <Collapse in={expandedGroups.has(group.parent)} unmountOnExit>
                      {group.children.map(gap => (
                        <GapNodeRow
                          key={gap.id}
                          gap={gap}
                          depth={1}
                          selectedNodeId={selectedNodeId}
                          expandedNodes={expandedNodes}
                          nodeSuggestions={nodeSuggestions}
                          appliedNodes={appliedNodes}
                          getNodeSuggestion={getNodeSuggestion}
                          onSelect={handleSelectNode}
                          onToggleExpand={toggleNode}
                          onGeoSuggest={(id, name) => geoSuggestMutation.mutate({ divisionId: id, name })}
                          onDismiss={(id) => dismissGapMutation.mutate(id)}
                          onApplySingle={handleApplySingle}
                          onUnapply={handleUnapplySingle}
                          geoSuggestPending={geoSuggestMutation.isPending}
                          dismissPending={dismissGapMutation.isPending}
                        />
                      ))}
                    </Collapse>
                  </Box>
                ))}

                {/* Dismissed gaps section */}
                {coverageData.dismissedCount > 0 && (
                  <Box sx={{ mt: 2, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                    <Button
                      size="small"
                      onClick={() => setDismissedExpanded(v => !v)}
                      startIcon={dismissedExpanded ? <ExpandLess /> : <ExpandMore />}
                      sx={{ textTransform: 'none' }}
                    >
                      {coverageData.dismissedCount} dismissed
                    </Button>
                    <Collapse in={dismissedExpanded} unmountOnExit>
                      {coverageData.dismissedGaps.map(gap => (
                        <Box
                          key={gap.id}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            py: 0.25,
                            pl: 2,
                          }}
                        >
                          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                            {gap.name}
                            {gap.parentName && (
                              <Typography component="span" variant="caption" color="text.disabled" sx={{ ml: 0.5 }}>
                                ({gap.parentName})
                              </Typography>
                            )}
                          </Typography>
                          <Tooltip title="Undismiss">
                            <IconButton
                              size="small"
                              onClick={() => undismissGapMutation.mutate(gap.id)}
                              disabled={undismissGapMutation.isPending}
                            >
                              <Visibility sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      ))}
                    </Collapse>
                  </Box>
                )}
              </>
            )
          )}
        </Paper>

        {/* Right panel: Map preview + suggestion */}
        <CoverageMapPreview
          mapRef={mapRef}
          selectedNodeId={selectedNodeId}
          selectedGapInfo={selectedGapInfo}
          selectedGeoResult={selectedGeoResult}
          selectedTargets={selectedTargets}
          gapGeom={gapGeom}
          suggGeom={suggGeom}
          mapLoading={mapLoading}
          gapFC={gapFC}
          suggFC={suggFC}
          circleFC={circleFC}
          markersFC={markersFC}
          searchOpen={searchOpen}
          regionQuery={regionQuery}
          regionResults={regionResults}
          isSearchingRegions={isSearchingRegions}
          onSearchOpenChange={setSearchOpen}
          onRegionQueryChange={setRegionQuery}
          onSelectTarget={(nodeId, target) => {
            setSelectedTargets(prev => {
              const next = new Map(prev);
              next.set(nodeId, target);
              return next;
            });
          }}
          onClearTarget={(nodeId) => {
            setSelectedTargets(prev => {
              const next = new Map(prev);
              next.delete(nodeId);
              return next;
            });
          }}
        />
      </DialogContent>

      <DialogActions>
        {gapsWithSuggestions > 0 && (
          <Button
            variant="contained"
            color="warning"
            onClick={handleApplyToTree}
            sx={{ mr: 'auto' }}
          >
            Apply {gapsWithSuggestions} to tree
          </Button>
        )}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
