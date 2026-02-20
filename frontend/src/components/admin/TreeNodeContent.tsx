import {
  Box,
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
      <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 250 }}>
        {div.path || div.name}
      </Typography>
      <Tooltip title="Preview on map">
        <IconButton size="small" onClick={() => onPreview(div.divisionId, div.name, div.path)} sx={{ p: 0.25 }}>
          <MapIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Reject">
        <IconButton size="small" color="error" onClick={() => onReject(regionId, div.divisionId)} disabled={isMutating} sx={{ p: 0.25 }}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

/** Render a suggestion with accept + reject + preview buttons */
function SuggestionRow({ suggestion, regionId, onAccept, onAcceptAndRejectRest, onReject, onPreview, isMutating }: {
  suggestion: { divisionId: number; name: string; path: string; score: number };
  regionId: number;
  onAccept: (regionId: number, divisionId: number) => void;
  onAcceptAndRejectRest: (regionId: number, divisionId: number) => void;
  onReject: (regionId: number, divisionId: number) => void;
  onPreview: (divisionId: number, name: string, path?: string) => void;
  isMutating: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 250 }}>
        {suggestion.path || suggestion.name}
      </Typography>
      <Tooltip title="Preview on map">
        <IconButton size="small" onClick={() => onPreview(suggestion.divisionId, suggestion.name, suggestion.path)} sx={{ p: 0.25 }}>
          <MapIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Accept">
        <IconButton size="small" color="success" onClick={() => onAccept(regionId, suggestion.divisionId)} disabled={isMutating} sx={{ p: 0.25 }}>
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
      <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 250 }}>
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
  onAcceptAndRejectRest: (regionId: number, divisionId: number) => void;
  onReject: (regionId: number, divisionId: number) => void;
  onRejectRemaining: (regionId: number) => void;
  onAcceptAll: (assignments: Array<{ regionId: number; divisionId: number }>) => void;
  handlePreviewAssigned: (divisionId: number, name: string, path?: string) => void;
  handlePreviewSuggestion: (divisionId: number, name: string, path?: string) => void;
  onApproveShadow?: (insertion: ShadowInsertion) => void;
  onRejectShadow?: (insertion: ShadowInsertion) => void;
  isMutating: boolean;
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
  onApproveShadow,
  onRejectShadow,
  isMutating,
}: TreeNodeContentProps) {
  return (
    <>
      {/* Division list for matched countries */}
      {role === 'country' && (node.matchStatus === 'auto_matched' || node.matchStatus === 'manual_matched') && node.assignedDivisions.length > 0 && (
        <Box sx={{ pl: depth * 3 + 4.5, pb: 0.3 }}>
          {node.assignedDivisions.map((div) => (
            <AssignedDivisionRow key={div.divisionId} div={div} regionId={node.id} onReject={onReject} onPreview={handlePreviewAssigned} isMutating={isMutating} />
          ))}
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
          {node.assignedDivisions.map((div) => (
            <AssignedDivisionRow key={`a-${div.divisionId}`} div={div} regionId={node.id} onReject={onReject} onPreview={handlePreviewAssigned} isMutating={isMutating} />
          ))}
          {node.suggestions.map((suggestion) => (
            <SuggestionRow
              key={`s-${suggestion.divisionId}`}
              suggestion={suggestion}
              regionId={node.id}
              onAccept={onAccept}
              onAcceptAndRejectRest={onAcceptAndRejectRest}
              onReject={onReject}
              onPreview={handlePreviewSuggestion}
              isMutating={isMutating}
            />
          ))}
          {node.suggestions.length > 1 && (
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
