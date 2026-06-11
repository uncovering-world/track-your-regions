/**
 * SuggestionList — Shows assigned divisions and suggestions for the selected node.
 *
 * Assigned divisions: name + path + preview icon + remove (removeDivisionsFromRegion).
 * Suggestions: name/path/score + conflict chip + Accept/Reject/preview.
 * Bulk: "Accept all" (clean suggestions), "Reject remaining".
 */

import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Preview as PreviewIcon,
  Delete as RemoveIcon,
  SwapHoriz as ConflictIcon,
} from '@mui/icons-material';
import type { MatchTreeNode } from '../../../api/admin/worldViewImport';
import type { useTreeMutations } from '../useTreeMutations';

type Mutations = ReturnType<typeof useTreeMutations>;

interface SuggestionListProps {
  node: MatchTreeNode | null;
  mutations: Mutations;
  onPreview: (divisionId: number, name: string, path?: string, regionMapUrl?: string, wikidataId?: string, regionId?: number, isAssigned?: boolean) => void;
}

export function SuggestionList({ node, mutations, onPreview }: SuggestionListProps) {
  if (!node) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Select a region in the tree to see suggestions.
        </Typography>
      </Box>
    );
  }

  const { assignedDivisions, suggestions, id: regionId, regionMapUrl, wikidataId } = node;

  const handleRemoveDivision = (divisionId: number) => {
    mutations.rejectMutation.mutate({ regionId, divisionId });
  };

  const handleAccept = (divisionId: number) => {
    mutations.acceptMutation.mutate({ regionId, divisionId });
  };

  const handleReject = (divisionId: number) => {
    mutations.rejectMutation.mutate({ regionId, divisionId });
  };

  const handleAcceptTransfer = (divisionId: number, conflict: { type: 'direct' | 'split'; donorRegionId: number; donorDivisionId: number }) => {
    mutations.onAcceptTransfer(regionId, divisionId, conflict);
  };

  const handleAcceptAll = () => {
    const cleanSuggestions = suggestions.filter(s => !s.conflict);
    if (cleanSuggestions.length === 0) return;
    mutations.acceptAllMutation.mutate(cleanSuggestions.map(s => ({ regionId, divisionId: s.divisionId })));
  };

  const handleRejectRemaining = () => {
    mutations.rejectRemainingMutation.mutate(regionId);
  };

  const isBusy = mutations.acceptMutation.isPending || mutations.rejectMutation.isPending ||
    mutations.acceptAllMutation.isPending || mutations.rejectRemainingMutation.isPending ||
    mutations.acceptTransferMutation.isPending;

  const cleanSuggestions = suggestions.filter(s => !s.conflict);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
      {/* Assigned Divisions */}
      {assignedDivisions.length > 0 && (
        <Box>
          <Typography variant="overline" sx={{ px: 1, color: 'text.secondary', fontSize: '0.65rem' }}>
            Assigned ({assignedDivisions.length})
          </Typography>
          <List dense disablePadding>
            {assignedDivisions.map(div => (
              <ListItem
                key={div.divisionId}
                dense
                secondaryAction={
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Tooltip title="Preview">
                      <IconButton
                        size="small"
                        onClick={() => onPreview(div.divisionId, div.name, div.path, regionMapUrl ?? undefined, wikidataId ?? undefined, regionId, true)}
                      >
                        <PreviewIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Remove">
                      <IconButton
                        size="small"
                        onClick={() => handleRemoveDivision(div.divisionId)}
                        disabled={isBusy}
                      >
                        <RemoveIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                }
              >
                <ListItemText
                  primary={<Typography variant="body2" noWrap>{div.name}</Typography>}
                  secondary={div.path && div.path !== div.name ? (
                    <Typography variant="caption" color="text.secondary" noWrap>{div.path}</Typography>
                  ) : undefined}
                />
              </ListItem>
            ))}
          </List>
          {suggestions.length > 0 && <Divider />}
        </Box>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1 }}>
            <Typography variant="overline" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
              Suggestions ({suggestions.length})
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              {cleanSuggestions.length > 1 && (
                <Button size="small" onClick={handleAcceptAll} disabled={isBusy}>
                  Accept all
                </Button>
              )}
              {assignedDivisions.length > 0 && (
                <Button size="small" color="error" onClick={handleRejectRemaining} disabled={isBusy}>
                  Reject remaining
                </Button>
              )}
            </Box>
          </Box>
          <List dense disablePadding>
            {suggestions.map(sug => {
              const hasConflict = !!sug.conflict;
              return (
                <ListItem
                  key={sug.divisionId}
                  dense
                  secondaryAction={
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {isBusy && <CircularProgress size={14} sx={{ mt: 0.5 }} />}
                      <Tooltip title="Preview">
                        <IconButton
                          size="small"
                          onClick={() => onPreview(sug.divisionId, sug.name, sug.path, regionMapUrl ?? undefined, wikidataId ?? undefined, regionId, false)}
                        >
                          <PreviewIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={hasConflict ? `Accept (transfer from ${sug.conflict!.donorRegionName})` : 'Accept'}>
                        <Button
                          size="small"
                          variant="outlined"
                          color="success"
                          sx={{ minWidth: 0, px: 0.5, py: 0, fontSize: '0.65rem', height: 22 }}
                          onClick={() => {
                            if (hasConflict) {
                              handleAcceptTransfer(sug.divisionId, { type: sug.conflict!.type, donorRegionId: sug.conflict!.donorRegionId, donorDivisionId: sug.conflict!.donorDivisionId });
                            } else {
                              handleAccept(sug.divisionId);
                            }
                          }}
                          disabled={isBusy}
                        >
                          {hasConflict ? '↑' : '✓'}
                        </Button>
                      </Tooltip>
                      <Tooltip title="Reject">
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          sx={{ minWidth: 0, px: 0.5, py: 0, fontSize: '0.65rem', height: 22 }}
                          onClick={() => handleReject(sug.divisionId)}
                          disabled={isBusy}
                        >
                          ✗
                        </Button>
                      </Tooltip>
                    </Box>
                  }
                >
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>{sug.name}</Typography>
                        {hasConflict && (
                          <Tooltip title={`Conflict: already assigned to ${sug.conflict!.donorRegionName}`}>
                            <ConflictIcon sx={{ fontSize: 14, color: 'warning.main', flexShrink: 0 }} />
                          </Tooltip>
                        )}
                        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                          {Math.round(sug.score * 100)}%
                        </Typography>
                      </Box>
                    }
                    secondary={sug.path && sug.path !== sug.name ? (
                      <Typography variant="caption" color="text.secondary" noWrap>{sug.path}</Typography>
                    ) : undefined}
                  />
                </ListItem>
              );
            })}
          </List>
        </Box>
      )}

      {/* Empty state */}
      {assignedDivisions.length === 0 && suggestions.length === 0 && (
        <Box sx={{ p: 1 }}>
          <Typography variant="body2" color="text.secondary">No suggestions or assigned divisions.</Typography>
        </Box>
      )}

      {/* Assigned-only, no suggestions: clear members (I2 — rejectRemaining is a no-op here) */}
      {assignedDivisions.length > 0 && suggestions.length === 0 && (
        <Box sx={{ px: 1 }}>
          <Button
            size="small"
            color="error"
            onClick={() => mutations.clearMembersMutation.mutate(regionId)}
            disabled={isBusy}
          >
            Clear all assignments
          </Button>
        </Box>
      )}

      {/* Conflict chip summary at bottom if any */}
      {suggestions.some(s => s.conflict) && (
        <Box sx={{ px: 1 }}>
          <Chip
            icon={<ConflictIcon />}
            label={`${suggestions.filter(s => s.conflict).length} conflict(s) — use ↑ to transfer`}
            size="small"
            color="warning"
            variant="outlined"
          />
        </Box>
      )}
    </Box>
  );
}
