import { useState, useCallback, useEffect } from 'react';
import {
  Box,
  Checkbox,
  Chip,
  CircularProgress,
  Typography,
  IconButton,
  Button,
} from '@mui/material';
import {
  Check as CheckIcon,
  Close as CloseIcon,
  Map as MapIcon,
  DoneAll as AcceptAndRejectRestIcon,
} from '@mui/icons-material';
import type { MatchTreeNode } from '../../api/admin/worldViewImport';
import { Tooltip, type ShadowInsertion } from './treeNodeShared';

/** Render a single assigned division (already accepted) */
function AssignedDivisionRow({ div, regionId, onReject, onPreview, isMutating }: {
  div: { divisionId: number; name: string; path?: string };
  regionId: number;
  onReject: (regionId: number, divisionId: number) => void;
  onPreview: (divisionId: number, name: string, path?: string) => void;
  isMutating: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <CheckIcon sx={{ fontSize: 14, color: 'success.main' }} />
      <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
        {div.path || div.name}
      </Typography>
      <Tooltip title="Preview on map">
        <IconButton size="small" onClick={() => onPreview(div.divisionId, div.name, div.path)} sx={{ p: 0.25 }}>
          <MapIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Reject">
        <span>
        <IconButton size="small" color="error" onClick={() => onReject(regionId, div.divisionId)} disabled={isMutating} sx={{ p: 0.25 }}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
}

/** Render a suggestion with accept + reject + preview buttons */
function SuggestionRow({ suggestion, regionId, onAccept, onAcceptAndRejectRest, onReject, onPreview, onAcceptTransfer, onPreviewTransfer, isMutating, checked, onToggle }: {
  suggestion: { divisionId: number; name: string; path: string; score: number; geoSimilarity?: number | null; conflict?: { type: 'direct' | 'split'; donorRegionId: number; donorRegionName: string; donorDivisionId: number; donorDivisionName: string } };
  regionId: number;
  onAccept: (regionId: number, divisionId: number) => void;
  onAcceptAndRejectRest: (regionId: number, divisionId: number) => void;
  onReject: (regionId: number, divisionId: number) => void;
  onPreview: (divisionId: number, name: string, path?: string) => void;
  onAcceptTransfer?: (regionId: number, divisionId: number, conflict: { type: 'direct' | 'split'; donorRegionId: number; donorDivisionId: number }) => void;
  onPreviewTransfer?: (divisionId: number, name: string, path: string | undefined, conflict: { donorDivisionId: number; donorDivisionName: string; donorRegionId: number; type: 'direct' | 'split' }, regionId?: number, allDivisionIds?: number[], allSuggestions?: Array<{ divisionId: number; conflict?: { donorDivisionId: number; donorRegionId: number; type: 'direct' | 'split' } }>) => void;
  isMutating: boolean;
  checked?: boolean;
  onToggle?: (divisionId: number) => void;
}) {
  const geo = suggestion.geoSimilarity;
  let geoColor: string | undefined;
  if (geo != null) {
    if (geo >= 0.7) geoColor = 'success.main';
    else if (geo >= 0.5) geoColor = 'warning.main';
    else geoColor = 'text.disabled';
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      {onToggle && (
        <Checkbox
          size="small"
          checked={checked ?? false}
          onChange={() => onToggle(suggestion.divisionId)}
          sx={{ p: 0, '& .MuiSvgIcon-root': { fontSize: 16 } }}
        />
      )}
      <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
        {suggestion.path || suggestion.name}
      </Typography>
      {suggestion.conflict && (
        <Typography
          variant="caption"
          sx={{
            color: 'warning.main',
            fontSize: '0.6rem',
            whiteSpace: 'nowrap',
            border: '1px solid',
            borderColor: 'warning.main',
            borderRadius: 0.5,
            px: 0.5,
            lineHeight: 1.4,
          }}
        >
          from {suggestion.conflict.donorRegionName}
          {suggestion.conflict.type === 'split' ? ` (split ${suggestion.conflict.donorDivisionName})` : ''}
        </Typography>
      )}
      {geo != null ? (
        <Typography variant="caption" sx={{ color: geoColor, fontWeight: geo >= 0.5 ? 600 : 400, flexShrink: 0 }}>
          {Math.round(geo * 100)}%
        </Typography>
      ) : (
        <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>—</Typography>
      )}
      <Tooltip title="Preview on map">
        <IconButton size="small" onClick={() => {
          if (suggestion.conflict && onPreviewTransfer) {
            onPreviewTransfer(suggestion.divisionId, suggestion.name, suggestion.path, suggestion.conflict);
          } else {
            onPreview(suggestion.divisionId, suggestion.name, suggestion.path);
          }
        }} sx={{ p: 0.25 }}>
          <MapIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title={suggestion.conflict ? `Accept and transfer from ${suggestion.conflict.donorRegionName}` : 'Accept'}>
        <IconButton size="small" color="success" onClick={() => {
          if (suggestion.conflict && onAcceptTransfer) {
            onAcceptTransfer(regionId, suggestion.divisionId, suggestion.conflict);
          } else {
            onAccept(regionId, suggestion.divisionId);
          }
        }} disabled={isMutating} sx={{ p: 0.25 }}>
          <CheckIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Accept and reject rest">
        <IconButton size="small" color="success" onClick={() => onAcceptAndRejectRest(regionId, suggestion.divisionId)} disabled={isMutating} sx={{ p: 0.25 }}>
          <AcceptAndRejectRestIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Dismiss">
        <IconButton size="small" color="error" onClick={() => onReject(regionId, suggestion.divisionId)} disabled={isMutating} sx={{ p: 0.25 }}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

/** Render a shadow member insertion with approve/reject buttons */
function ShadowMemberRow({ shadow, onApprove, onReject, isMutating }: {
  shadow: ShadowInsertion;
  onApprove?: (insertion: ShadowInsertion) => void;
  onReject?: (insertion: ShadowInsertion) => void;
  isMutating: boolean;
}) {
  return (
    <Box sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 0.5,
      borderLeft: '2px dashed',
      borderLeftColor: 'warning.main',
      bgcolor: 'rgba(237, 108, 2, 0.06)',
      pl: 0.5,
      py: 0.25,
      borderRadius: '0 4px 4px 0',
    }}>
      <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
        {shadow.gapDivisionName}
      </Typography>
      <Typography variant="caption" color="warning.main" sx={{ fontSize: '0.6rem', flexShrink: 0 }}>
        (coverage gap)
      </Typography>
      <Tooltip title="Approve — add as member">
        <IconButton size="small" color="success" onClick={() => onApprove?.(shadow)} disabled={isMutating} sx={{ p: 0.25 }}>
          <CheckIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Reject">
        <IconButton size="small" color="error" onClick={() => onReject?.(shadow)} sx={{ p: 0.25 }}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

type SelectedBatchAction = (regionId: number, divisionIds: number[]) => void;

function coverageChipColor(pct: number): 'success' | 'warning' | 'error' {
  if (pct >= 0.9) return 'success';
  if (pct >= 0.5) return 'warning';
  return 'error';
}

/** Coverage chips (loading skeleton + final value) for container nodes */
function ChildrenCoverageChip({ hasChildren, coverageLoading, coveragePercent, coverageFetching, depth, onCoverageClick, nodeId }: {
  hasChildren: boolean;
  coverageLoading?: boolean;
  coveragePercent?: number;
  coverageFetching?: boolean;
  depth: number;
  onCoverageClick?: (regionId: number) => void;
  nodeId: number;
}) {
  if (!hasChildren) return null;
  if (coverageLoading) {
    return (
      <Box sx={{ pl: depth * 3 + 4.5, pb: 0.3 }}>
        <Chip
          size="small"
          icon={<CircularProgress size={12} />}
          label="Calculating coverage…"
          variant="outlined"
          sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } }}
        />
      </Box>
    );
  }
  if (coveragePercent == null) return null;
  const chipColor = coverageChipColor(coveragePercent);
  return (
    <Box sx={{ pl: depth * 3 + 4.5, pb: 0.3 }}>
      <Chip
        size="small"
        icon={coverageFetching ? <CircularProgress size={12} color="inherit" /> : undefined}
        label={`Children cover ${(coveragePercent * 100).toFixed(2)}%`}
        color={chipColor}
        variant="outlined"
        onClick={onCoverageClick && !coverageFetching ? () => onCoverageClick(nodeId) : undefined}
        sx={{ height: 20, cursor: onCoverageClick && !coverageFetching ? 'pointer' : 'default', '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } }}
      />
    </Box>
  );
}

/** Geoshape coverage chip rendered below division list */
function GeoshapeCoverageChip({ geoshapeCoveragePercent, coverageFetching, onCoverageClick, nodeId }: {
  geoshapeCoveragePercent?: number;
  coverageFetching?: boolean;
  onCoverageClick?: (regionId: number) => void;
  nodeId: number;
}) {
  if (geoshapeCoveragePercent == null) return null;
  const geoChipColor = coverageChipColor(geoshapeCoveragePercent);
  return (
    <Chip
      size="small"
      variant="outlined"
      label={`Geoshape ${(geoshapeCoveragePercent * 100).toFixed(1)}%`}
      icon={coverageFetching ? <CircularProgress size={12} color="inherit" /> : undefined}
      color={geoChipColor}
      onClick={onCoverageClick && !coverageFetching ? () => onCoverageClick(nodeId) : undefined}
      sx={{ height: 18, mt: 0.25, cursor: onCoverageClick && !coverageFetching ? 'pointer' : 'default', '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } }}
    />
  );
}

/** Expandable list of assigned divisions with a toggle row */
function AssignedDivisionsList({ node, divisionsExpanded, setDivisionsExpanded, onReject, handlePreviewAssigned, isMutating, keyPrefix = '' }: {
  node: MatchTreeNode;
  divisionsExpanded: boolean;
  setDivisionsExpanded: (expanded: boolean) => void;
  onReject: (regionId: number, divisionId: number) => void;
  handlePreviewAssigned: (divisionId: number, name: string, path?: string) => void;
  isMutating: boolean;
  keyPrefix?: string;
}) {
  if (divisionsExpanded) {
    return (
      <>
        {node.assignedDivisions.map((div) => (
          <AssignedDivisionRow key={`${keyPrefix}${div.divisionId}`} div={div} regionId={node.id} onReject={onReject} onPreview={handlePreviewAssigned} isMutating={isMutating} />
        ))}
        <Typography
          variant="caption"
          color="primary"
          onClick={() => setDivisionsExpanded(false)}
          sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
        >
          Hide
        </Typography>
      </>
    );
  }
  return (
    <Typography
      variant="caption"
      color="primary"
      onClick={() => setDivisionsExpanded(true)}
      sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
    >
      {node.assignedDivisions.length} division{node.assignedDivisions.length !== 1 ? 's' : ''}…
    </Typography>
  );
}

/** Preview-or-accept action for a set of selected suggestions (shared logic) */
function previewOrRunBatch(
  node: MatchTreeNode,
  selectedDivIds: Set<number>,
  onPreviewTransfer: TreeNodeContentProps['onPreviewTransfer'],
  fallback: (regionId: number, divisionIds: number[]) => void,
) {
  const selectedSuggestions = node.suggestions.filter(s => selectedDivIds.has(s.divisionId));
  const firstConflict = selectedSuggestions.find(s => s.conflict)?.conflict;
  if (firstConflict && onPreviewTransfer) {
    const conflictSuggestions = selectedSuggestions.filter(s => s.conflict).map(s => ({ divisionId: s.divisionId, conflict: s.conflict! }));
    onPreviewTransfer(selectedSuggestions[0].divisionId, selectedSuggestions[0].name, selectedSuggestions[0].path, firstConflict, node.id, [...selectedDivIds], conflictSuggestions);
  } else {
    fallback(node.id, [...selectedDivIds]);
  }
}

/** Bulk-select toolbar (appears when 1+ suggestions selected) */
function SelectedBatchToolbar({ node, selectedDivIds, onPreviewUnion, onAcceptSelected, onAcceptSelectedRejectRest, onRejectSelected, onPreviewTransfer, isMutating }: {
  node: MatchTreeNode;
  selectedDivIds: Set<number>;
  onPreviewUnion?: (regionId: number, divisionIds: number[]) => void;
  onAcceptSelected?: SelectedBatchAction;
  onAcceptSelectedRejectRest?: SelectedBatchAction;
  onRejectSelected?: SelectedBatchAction;
  onPreviewTransfer?: TreeNodeContentProps['onPreviewTransfer'];
  isMutating: boolean;
}) {
  const selectedSuggestions = node.suggestions.filter(s => selectedDivIds.has(s.divisionId));
  const hasConflicts = selectedSuggestions.some(s => s.conflict);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25, pl: 0.25 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
        {selectedDivIds.size} selected
      </Typography>
      {onPreviewUnion && (
        <Button size="small" variant="text" color="info"
          onClick={() => onPreviewUnion(node.id, [...selectedDivIds])}
          disabled={isMutating}
          sx={{ fontSize: '0.65rem', py: 0, minHeight: 0, textTransform: 'none' }}>
          Preview union
        </Button>
      )}
      {onAcceptSelected && (
        <Button size="small" variant="text" color="success"
          onClick={() => previewOrRunBatch(node, selectedDivIds, onPreviewTransfer, onAcceptSelected)}
          disabled={isMutating}
          sx={{ fontSize: '0.65rem', py: 0, minHeight: 0, textTransform: 'none' }}>
          {hasConflicts ? `Preview transfer (${selectedDivIds.size})` : `Accept ${selectedDivIds.size}`}
        </Button>
      )}
      {onAcceptSelectedRejectRest && (
        <Button size="small" variant="text" color="success"
          onClick={() => previewOrRunBatch(node, selectedDivIds, onPreviewTransfer, onAcceptSelectedRejectRest)}
          disabled={isMutating}
          sx={{ fontSize: '0.65rem', py: 0, minHeight: 0, textTransform: 'none' }}>
          {hasConflicts ? `Preview transfer (${selectedDivIds.size}) + reject rest` : `Accept ${selectedDivIds.size} + reject rest`}
        </Button>
      )}
      {onRejectSelected && (
        <Button size="small" variant="text" color="error"
          onClick={() => onRejectSelected(node.id, [...selectedDivIds])}
          disabled={isMutating}
          sx={{ fontSize: '0.65rem', py: 0, minHeight: 0, textTransform: 'none' }}>
          Reject {selectedDivIds.size}
        </Button>
      )}
    </Box>
  );
}

/** Bulk-accept/reject toolbar that appears above individual suggestion rows */
function SuggestionsBulkActions({ node, selectedDivIds, setSelectedDivIds, onAcceptAll, onRejectRemaining, onPreviewTransfer, isMutating }: {
  node: MatchTreeNode;
  selectedDivIds: Set<number>;
  setSelectedDivIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  onAcceptAll: (assignments: Array<{ regionId: number; divisionId: number }>) => void;
  onRejectRemaining: (regionId: number) => void;
  onPreviewTransfer?: TreeNodeContentProps['onPreviewTransfer'];
  isMutating: boolean;
}) {
  return (
    <>
      {node.suggestions.length > 1 && (
        <>
          <Button
            size="small"
            variant="text"
            color="info"
            onClick={() => {
              const allIds = node.suggestions.map(s => s.divisionId);
              const allSelected = allIds.every(id => selectedDivIds.has(id));
              setSelectedDivIds(allSelected ? new Set() : new Set(allIds));
            }}
            sx={{ fontSize: '0.65rem', py: 0, minHeight: 0, textTransform: 'none' }}
          >
            {node.suggestions.every(s => selectedDivIds.has(s.divisionId)) ? 'Deselect all' : 'Select all'}
          </Button>
          <Button
            size="small"
            variant="text"
            color="success"
            onClick={() => {
              const firstConflict = node.suggestions.find(s => s.conflict)?.conflict;
              if (firstConflict && onPreviewTransfer) {
                const conflictSuggestions = node.suggestions.filter(s => s.conflict).map(s => ({ divisionId: s.divisionId, conflict: s.conflict! }));
                onPreviewTransfer(node.suggestions[0].divisionId, node.suggestions[0].name, node.suggestions[0].path, firstConflict, node.id, node.suggestions.map(s => s.divisionId), conflictSuggestions);
              } else {
                onAcceptAll(node.suggestions.map(s => ({ regionId: node.id, divisionId: s.divisionId })));
              }
            }}
            disabled={isMutating}
            sx={{ fontSize: '0.65rem', py: 0, minHeight: 0, textTransform: 'none' }}
          >
            {node.suggestions.some(s => s.conflict) ? `Preview transfer (${node.suggestions.length})` : `Accept all ${node.suggestions.length}`}
          </Button>
        </>
      )}
      {node.suggestions.length > 0 && (
        <Button
          size="small"
          variant="text"
          color="error"
          onClick={() => onRejectRemaining(node.id)}
          disabled={isMutating}
          sx={{ fontSize: '0.65rem', py: 0, minHeight: 0, textTransform: 'none' }}
        >
          Reject {node.assignedDivisions.length > 0 ? 'remaining ' : 'all '}{node.suggestions.length} suggestion{node.suggestions.length > 1 ? 's' : ''}
        </Button>
      )}
    </>
  );
}

/** List of add_member shadow insertions with approve/reject buttons */
function ShadowMemberList({ nodeShadows, onApproveShadow, onRejectShadow, isMutating, depth }: {
  nodeShadows: ShadowInsertion[];
  onApproveShadow?: (insertion: ShadowInsertion) => void;
  onRejectShadow?: (insertion: ShadowInsertion) => void;
  isMutating: boolean;
  depth: number;
}) {
  return (
    <Box sx={{ pl: depth * 3 + 4.5, pb: 0.3 }}>
      {nodeShadows.filter(s => s.action === 'add_member').map(shadow => (
        <ShadowMemberRow key={`shadow-${shadow.gapDivisionId}`} shadow={shadow} onApprove={onApproveShadow} onReject={onRejectShadow} isMutating={isMutating} />
      ))}
    </Box>
  );
}

/** create_region shadow rows rendered at the leaf level */
function CreateRegionShadows({ nodeShadows, onApproveShadow, onRejectShadow, isMutating, depth }: {
  nodeShadows: ShadowInsertion[];
  onApproveShadow?: (insertion: ShadowInsertion) => void;
  onRejectShadow?: (insertion: ShadowInsertion) => void;
  isMutating: boolean;
  depth: number;
}) {
  return (
    <Box>
      {nodeShadows.filter(s => s.action === 'create_region').map(shadow => (
        <Box
          key={`shadow-create-${shadow.gapDivisionId}`}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            pl: (depth + 1) * 3,
            py: 0.3,
            borderBottom: '1px solid',
            borderColor: 'divider',
            borderLeft: '2px dashed',
            borderLeftColor: 'warning.main',
            bgcolor: 'rgba(237, 108, 2, 0.06)',
            minHeight: 32,
          }}
        >
          <Box sx={{ width: 28, flexShrink: 0 }} />
          <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
            + {shadow.gapDivisionName}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            (new region)
          </Typography>
          <Tooltip title="Approve — create region and add member">
            <IconButton size="small" color="success" onClick={() => onApproveShadow?.(shadow)} disabled={isMutating} sx={{ p: 0.25 }}>
              <CheckIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Reject">
            <IconButton size="small" color="error" onClick={() => onRejectShadow?.(shadow)} sx={{ p: 0.25 }}>
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>
      ))}
    </Box>
  );
}

interface TreeNodeContentProps {
  node: MatchTreeNode;
  depth: number;
  role: 'container' | 'country' | 'subdivision';
  hasChildren: boolean;
  nodeShadows: ShadowInsertion[] | undefined;
  onAccept: (regionId: number, divisionId: number) => void;
  onAcceptAndRejectRest: (regionId: number, divisionId: number) => void;
  onReject: (regionId: number, divisionId: number) => void;
  onRejectRemaining: (regionId: number) => void;
  onAcceptAll: (assignments: Array<{ regionId: number; divisionId: number }>) => void;
  handlePreviewAssigned: (divisionId: number, name: string, path?: string) => void;
  handlePreviewSuggestion: (divisionId: number, name: string, path?: string) => void;
  onPreviewTransfer?: (divisionId: number, name: string, path: string | undefined, conflict: { donorDivisionId: number; donorDivisionName: string; donorRegionId: number; type: 'direct' | 'split' }, regionId?: number, allDivisionIds?: number[], allSuggestions?: Array<{ divisionId: number; conflict?: { donorDivisionId: number; donorRegionId: number; type: 'direct' | 'split' } }>) => void;
  onApproveShadow?: (insertion: ShadowInsertion) => void;
  onRejectShadow?: (insertion: ShadowInsertion) => void;
  onPreviewUnion?: (regionId: number, divisionIds: number[]) => void;
  onAcceptSelected?: (regionId: number, divisionIds: number[]) => void;
  onAcceptSelectedRejectRest?: (regionId: number, divisionIds: number[]) => void;
  onRejectSelected?: (regionId: number, divisionIds: number[]) => void;
  isMutating: boolean;
  /** Children coverage percentage (0-1) for container nodes */
  coveragePercent?: number;
  /** Geoshape coverage percentage (0-1) — how well assigned divisions cover the source geoshape */
  geoshapeCoveragePercent?: number;
  /** Whether coverage data is still loading for the first time */
  coverageLoading?: boolean;
  /** Whether coverage data is being refetched for this node */
  coverageFetching?: boolean;
  /** Callback when coverage chip is clicked */
  onCoverageClick?: (regionId: number) => void;
  /** Notify virtualizer to re-measure row height after content resize */
  onContentResize?: () => void;
}

export function TreeNodeContent({
  node,
  depth,
  role,
  hasChildren,
  nodeShadows,
  onAccept,
  onAcceptAndRejectRest,
  onReject,
  onRejectRemaining,
  onAcceptAll,
  handlePreviewAssigned,
  handlePreviewSuggestion,
  onPreviewTransfer,
  onApproveShadow,
  onRejectShadow,
  onPreviewUnion,
  onAcceptSelected,
  onAcceptSelectedRejectRest,
  onRejectSelected,
  isMutating,
  coveragePercent,
  geoshapeCoveragePercent,
  coverageLoading,
  coverageFetching,
  onCoverageClick,
  onContentResize,
}: TreeNodeContentProps) {
  const [selectedDivIds, setSelectedDivIds] = useState<Set<number>>(new Set());
  const [divisionsExpanded, setDivisionsExpanded] = useState(false);
  const showCheckboxes = node.suggestions.length > 1;

  // Reset collapse state when node changes (virtualized list may reuse component)
  useEffect(() => {
    setDivisionsExpanded(false);
  }, [node.id]);

  // Notify virtualizer to re-measure row height when divisions expand/collapse
  useEffect(() => {
    onContentResize?.();
  }, [divisionsExpanded, onContentResize]);

  const toggleSelection = useCallback((divisionId: number) => {
    setSelectedDivIds(prev => {
      const next = new Set(prev);
      if (next.has(divisionId)) next.delete(divisionId);
      else next.add(divisionId);
      return next;
    });
  }, []);

  // Clear selection when suggestions change (accept/reject)
  useEffect(() => {
    setSelectedDivIds(new Set());
  }, [node.suggestions.length]);

  const isMatchedCountry = role === 'country' && (node.matchStatus === 'auto_matched' || node.matchStatus === 'manual_matched');
  const isReviewSuggestedCountry = role === 'country' && (node.matchStatus === 'needs_review' || node.matchStatus === 'suggested');
  const isChildrenMatched = role === 'country' || node.matchStatus === 'children_matched';
  const showMatchedDivisions = isChildrenMatched
    && (node.matchStatus === 'auto_matched' || node.matchStatus === 'manual_matched' || node.matchStatus === 'children_matched')
    && node.assignedDivisions.length > 0;
  const showReviewDivisions = isReviewSuggestedCountry && (node.assignedDivisions.length > 0 || node.suggestions.length > 0);
  const hasAddMemberShadows = !!nodeShadows?.some(s => s.action === 'add_member');
  const showUnmatchedAddMemberShadows = node.matchStatus !== 'auto_matched'
    && node.matchStatus !== 'manual_matched'
    && !(node.matchStatus === 'needs_review' || node.matchStatus === 'suggested')
    && hasAddMemberShadows;
  const showCreateRegionShadows = !hasChildren && !!nodeShadows?.some(s => s.action === 'create_region');

  return (
    <>
      <ChildrenCoverageChip
        hasChildren={hasChildren}
        coverageLoading={coverageLoading}
        coveragePercent={coveragePercent}
        coverageFetching={coverageFetching}
        depth={depth}
        onCoverageClick={onCoverageClick}
        nodeId={node.id}
      />

      {/* Division list for matched countries and drilled-down parents */}
      {showMatchedDivisions && (
        <Box sx={{ pl: depth * 3 + 4.5, pb: 0.3 }}>
          <AssignedDivisionsList
            node={node}
            divisionsExpanded={divisionsExpanded}
            setDivisionsExpanded={setDivisionsExpanded}
            onReject={onReject}
            handlePreviewAssigned={handlePreviewAssigned}
            isMutating={isMutating}
          />
          <GeoshapeCoverageChip
            geoshapeCoveragePercent={geoshapeCoveragePercent}
            coverageFetching={coverageFetching}
            onCoverageClick={onCoverageClick}
            nodeId={node.id}
          />
        </Box>
      )}

      {/* Shadow insertions for add_member on matched regions */}
      {isMatchedCountry && hasAddMemberShadows && nodeShadows && (
        <ShadowMemberList nodeShadows={nodeShadows} onApproveShadow={onApproveShadow} onRejectShadow={onRejectShadow} isMutating={isMutating} depth={depth} />
      )}

      {/* Suggestions and assigned divisions for review/suggested countries */}
      {showReviewDivisions && (
        <Box sx={{ pl: depth * 3 + 4.5, pb: 0.3 }}>
          <AssignedDivisionsList
            node={node}
            divisionsExpanded={divisionsExpanded}
            setDivisionsExpanded={setDivisionsExpanded}
            onReject={onReject}
            handlePreviewAssigned={handlePreviewAssigned}
            isMutating={isMutating}
            keyPrefix="a-"
          />
          {node.suggestions.map((suggestion) => (
            <SuggestionRow
              key={`s-${suggestion.divisionId}`}
              suggestion={suggestion}
              regionId={node.id}
              onAccept={onAccept}
              onAcceptAndRejectRest={onAcceptAndRejectRest}
              onReject={onReject}
              onPreview={handlePreviewSuggestion}
              onPreviewTransfer={onPreviewTransfer}
              isMutating={isMutating}
              checked={selectedDivIds.has(suggestion.divisionId)}
              onToggle={showCheckboxes ? toggleSelection : undefined}
            />
          ))}
          <SuggestionsBulkActions
            node={node}
            selectedDivIds={selectedDivIds}
            setSelectedDivIds={setSelectedDivIds}
            onAcceptAll={onAcceptAll}
            onRejectRemaining={onRejectRemaining}
            onPreviewTransfer={onPreviewTransfer}
            isMutating={isMutating}
          />
          {selectedDivIds.size > 0 && (
            <SelectedBatchToolbar
              node={node}
              selectedDivIds={selectedDivIds}
              onPreviewUnion={onPreviewUnion}
              onAcceptSelected={onAcceptSelected}
              onAcceptSelectedRejectRest={onAcceptSelectedRejectRest}
              onRejectSelected={onRejectSelected}
              onPreviewTransfer={onPreviewTransfer}
              isMutating={isMutating}
            />
          )}
        </Box>
      )}

      {/* Shadow insertions for add_member on unmatched/container regions */}
      {showUnmatchedAddMemberShadows && nodeShadows && (
        <ShadowMemberList nodeShadows={nodeShadows} onApproveShadow={onApproveShadow} onRejectShadow={onRejectShadow} isMutating={isMutating} depth={depth} />
      )}

      {/* Shadow insertions for add_member on needs_review/suggested regions */}
      {isReviewSuggestedCountry && hasAddMemberShadows && nodeShadows && (
        <ShadowMemberList nodeShadows={nodeShadows} onApproveShadow={onApproveShadow} onRejectShadow={onRejectShadow} isMutating={isMutating} depth={depth} />
      )}

      {/* Shadow insertions for create_region on leaf nodes */}
      {showCreateRegionShadows && nodeShadows && (
        <CreateRegionShadows nodeShadows={nodeShadows} onApproveShadow={onApproveShadow} onRejectShadow={onRejectShadow} isMutating={isMutating} depth={depth} />
      )}
    </>
  );
}
