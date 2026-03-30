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
import type { MatchTreeNode } from '../../api/adminWorldViewImport';
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
  onPreviewTransfer?: (divisionId: number, name: string, path: string | undefined, conflict: { donorDivisionId: number; donorDivisionName: string }) => void;
  isMutating: boolean;
  checked?: boolean;
  onToggle?: (divisionId: number) => void;
}) {
  const geo = suggestion.geoSimilarity;
  const geoColor = geo != null ? (geo >= 0.7 ? 'success.main' : geo >= 0.5 ? 'warning.main' : 'text.disabled') : undefined;

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

interface TreeNodeContentProps {
  node: MatchTreeNode;
  depth: number;
  role: 'container' | 'country' | 'subdivision';
  hasChildren: boolean;
  nodeShadows: ShadowInsertion[] | undefined;
  onAccept: (regionId: number, divisionId: number) => void;
  onAcceptTransfer?: (regionId: number, divisionId: number, conflict: { type: 'direct' | 'split'; donorRegionId: number; donorDivisionId: number }) => void;
  onAcceptAndRejectRest: (regionId: number, divisionId: number) => void;
  onReject: (regionId: number, divisionId: number) => void;
  onRejectRemaining: (regionId: number) => void;
  onAcceptAll: (assignments: Array<{ regionId: number; divisionId: number }>) => void;
  handlePreviewAssigned: (divisionId: number, name: string, path?: string) => void;
  handlePreviewSuggestion: (divisionId: number, name: string, path?: string) => void;
  onPreviewTransfer?: (divisionId: number, name: string, path: string | undefined, conflict: { donorDivisionId: number; donorDivisionName: string }) => void;
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
  onAcceptTransfer,
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

  return (
    <>
      {/* Children coverage info — always visible for container nodes */}
      {hasChildren && coverageLoading && (
        <Box sx={{ pl: depth * 3 + 4.5, pb: 0.3 }}>
          <Chip
            size="small"
            icon={<CircularProgress size={12} />}
            label="Calculating coverage…"
            variant="outlined"
            sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } }}
          />
        </Box>
      )}
      {hasChildren && !coverageLoading && coveragePercent != null && (
        <Box sx={{ pl: depth * 3 + 4.5, pb: 0.3 }}>
          <Chip
            size="small"
            icon={coverageFetching ? <CircularProgress size={12} color="inherit" /> : undefined}
            label={`Children cover ${(coveragePercent * 100).toFixed(2)}%`}
            color={coveragePercent >= 0.9 ? 'success' : coveragePercent >= 0.5 ? 'warning' : 'error'}
            variant="outlined"
            onClick={onCoverageClick && !coverageFetching ? () => onCoverageClick(node.id) : undefined}
            sx={{ height: 20, cursor: onCoverageClick && !coverageFetching ? 'pointer' : 'default', '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } }}
          />
        </Box>
      )}

      {/* Division list for matched countries and drilled-down parents */}
      {(role === 'country' || node.matchStatus === 'children_matched') && (node.matchStatus === 'auto_matched' || node.matchStatus === 'manual_matched' || node.matchStatus === 'children_matched') && node.assignedDivisions.length > 0 && (
        <Box sx={{ pl: depth * 3 + 4.5, pb: 0.3 }}>
          {divisionsExpanded ? (
            <>
              {node.assignedDivisions.map((div) => (
                <AssignedDivisionRow key={div.divisionId} div={div} regionId={node.id} onReject={onReject} onPreview={handlePreviewAssigned} isMutating={isMutating} />
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
          ) : (
            <Typography
              variant="caption"
              color="primary"
              onClick={() => setDivisionsExpanded(true)}
              sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
            >
              {node.assignedDivisions.length} division{node.assignedDivisions.length !== 1 ? 's' : ''}…
            </Typography>
          )}
          {geoshapeCoveragePercent != null && (
            <Chip
              size="small"
              variant="outlined"
              label={`Geoshape ${(geoshapeCoveragePercent * 100).toFixed(1)}%`}
              icon={coverageFetching ? <CircularProgress size={12} color="inherit" /> : undefined}
              color={geoshapeCoveragePercent >= 0.9 ? 'success' : geoshapeCoveragePercent >= 0.5 ? 'warning' : 'error'}
              onClick={onCoverageClick && !coverageFetching ? () => onCoverageClick(node.id) : undefined}
              sx={{ height: 18, mt: 0.25, cursor: onCoverageClick && !coverageFetching ? 'pointer' : 'default', '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem' } }}
            />
          )}
        </Box>
      )}

      {/* Shadow insertions for add_member on matched regions */}
      {role === 'country' && (node.matchStatus === 'auto_matched' || node.matchStatus === 'manual_matched') && nodeShadows?.some(s => s.action === 'add_member') && (
        <Box sx={{ pl: depth * 3 + 4.5, pb: 0.3 }}>
          {nodeShadows.filter(s => s.action === 'add_member').map(shadow => (
            <ShadowMemberRow key={`shadow-${shadow.gapDivisionId}`} shadow={shadow} onApprove={onApproveShadow} onReject={onRejectShadow} isMutating={isMutating} />
          ))}
        </Box>
      )}

      {/* Suggestions and assigned divisions for review/suggested countries */}
      {role === 'country' && (node.matchStatus === 'needs_review' || node.matchStatus === 'suggested') && (node.assignedDivisions.length > 0 || node.suggestions.length > 0) && (
        <Box sx={{ pl: depth * 3 + 4.5, pb: 0.3 }}>
          {divisionsExpanded ? (
            <>
              {node.assignedDivisions.map((div) => (
                <AssignedDivisionRow key={`a-${div.divisionId}`} div={div} regionId={node.id} onReject={onReject} onPreview={handlePreviewAssigned} isMutating={isMutating} />
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
          ) : (
            <Typography
              variant="caption"
              color="primary"
              onClick={() => setDivisionsExpanded(true)}
              sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
            >
              {node.assignedDivisions.length} division{node.assignedDivisions.length !== 1 ? 's' : ''}…
            </Typography>
          )}
          {node.suggestions.map((suggestion) => (
            <SuggestionRow
              key={`s-${suggestion.divisionId}`}
              suggestion={suggestion}
              regionId={node.id}
              onAccept={onAccept}
              onAcceptTransfer={onAcceptTransfer}
              onAcceptAndRejectRest={onAcceptAndRejectRest}
              onReject={onReject}
              onPreview={handlePreviewSuggestion}
              onPreviewTransfer={onPreviewTransfer}
              isMutating={isMutating}
              checked={selectedDivIds.has(suggestion.divisionId)}
              onToggle={showCheckboxes ? toggleSelection : undefined}
            />
          ))}
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
                onClick={() => onAcceptAll(node.suggestions.map(s => ({ regionId: node.id, divisionId: s.divisionId })))}
                disabled={isMutating}
                sx={{ fontSize: '0.65rem', py: 0, minHeight: 0, textTransform: 'none' }}
              >
                Accept all {node.suggestions.length}
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
          {selectedDivIds.size > 0 && (
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
                  onClick={() => onAcceptSelected(node.id, [...selectedDivIds])}
                  disabled={isMutating}
                  sx={{ fontSize: '0.65rem', py: 0, minHeight: 0, textTransform: 'none' }}>
                  Accept {selectedDivIds.size}
                </Button>
              )}
              {onAcceptSelectedRejectRest && (
                <Button size="small" variant="text" color="success"
                  onClick={() => onAcceptSelectedRejectRest(node.id, [...selectedDivIds])}
                  disabled={isMutating}
                  sx={{ fontSize: '0.65rem', py: 0, minHeight: 0, textTransform: 'none' }}>
                  Accept {selectedDivIds.size} + reject rest
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
          )}
        </Box>
      )}

      {/* Shadow insertions for add_member on unmatched/container regions */}
      {node.matchStatus !== 'auto_matched' && node.matchStatus !== 'manual_matched'
        && !(node.matchStatus === 'needs_review' || node.matchStatus === 'suggested')
        && nodeShadows?.some(s => s.action === 'add_member') && (
        <Box sx={{ pl: depth * 3 + 4.5, pb: 0.3 }}>
          {nodeShadows.filter(s => s.action === 'add_member').map(shadow => (
            <ShadowMemberRow key={`shadow-${shadow.gapDivisionId}`} shadow={shadow} onApprove={onApproveShadow} onReject={onRejectShadow} isMutating={isMutating} />
          ))}
        </Box>
      )}

      {/* Shadow insertions for add_member on needs_review/suggested regions */}
      {role === 'country' && (node.matchStatus === 'needs_review' || node.matchStatus === 'suggested')
        && nodeShadows?.some(s => s.action === 'add_member') && (
        <Box sx={{ pl: depth * 3 + 4.5, pb: 0.3 }}>
          {nodeShadows.filter(s => s.action === 'add_member').map(shadow => (
            <ShadowMemberRow key={`shadow-${shadow.gapDivisionId}`} shadow={shadow} onApprove={onApproveShadow} onReject={onRejectShadow} isMutating={isMutating} />
          ))}
        </Box>
      )}

      {/* Shadow insertions for create_region on leaf nodes */}
      {!hasChildren && nodeShadows?.some(s => s.action === 'create_region') && (
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
      )}
    </>
  );
}
