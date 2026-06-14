/**
 * SuggestionList — Shows assigned divisions and suggestions for the selected node.
 *
 * Assigned divisions: name + path + preview icon + remove (removeDivisionsFromRegion).
 * Suggestions: name/path/score + conflict chip + Accept/Reject/preview.
 * Bulk: "Accept all" (clean suggestions), "Reject remaining", "Preview union" (>1 suggestion).
 *
 * onPreviewTransfer: conflict-accept (↑) triggers the 3-layer transfer preview dialog
 *   instead of a blind direct acceptWithTransfer call. The dialog's Accept button
 *   executes the grouped transfer.
 * onPreviewUnion: shown when >1 clean suggestion, lets the user compare the union
 *   of all suggested divisions against the region map/geoshape before accepting.
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
  Layers as UnionIcon,
} from '@mui/icons-material';

/** Color-code geo-similarity identical to legacy TNC:64-69 */
function geoSimColor(geo: number | null | undefined): string | undefined {
  if (geo == null) return undefined;
  if (geo >= 0.7) return 'success.main';
  if (geo >= 0.5) return 'warning.main';
  return 'text.disabled';
}
import type { MatchTreeNode, MatchSuggestion } from '../../../api/admin/worldViewImport';
import type { useTreeMutations } from '../useTreeMutations';
import type { FinderMethod } from './finderFeedback';

type Mutations = ReturnType<typeof useTreeMutations>;

interface SuggestionListProps {
  node: MatchTreeNode | null;
  mutations: Mutations;
  /** Single-division preview — full legacy signature including markerPoints + regionName */
  onPreview: (
    divisionId: number, name: string, path?: string,
    regionMapUrl?: string, wikidataId?: string,
    regionId?: number, isAssigned?: boolean,
    regionMapLabel?: string, regionName?: string,
    markerPoints?: Array<{ name: string; lat: number; lon: number }>,
  ) => void;
  /** Transfer preview: opens the 3-layer donor/moving/target dialog */
  onPreviewTransfer?: (
    divisionId: number, name: string, path: string | undefined,
    conflict: { donorDivisionId: number; donorDivisionName: string; donorRegionId: number; type: 'direct' | 'split' },
    wikidataId: string, regionName: string,
    regionId?: number,
  ) => void;
  /** Union preview: shown when >1 suggestion exists */
  onPreviewUnion?: (
    regionId: number,
    divisionIds: number[],
    context: { wikidataId?: string; regionMapUrl?: string; regionMapLabel?: string; regionName: string },
  ) => void;
  /**
   * Parent-map fallback maps: nodes without their own regionMapUrl/name inherit
   * from the nearest ancestor that has one (ported from CountryWorkspacePage).
   */
  parentMapUrlById?: ReadonlyMap<number, string>;
  parentMapNameById?: ReadonlyMap<number, string>;
  /**
   * Client-side provenance: divisionId → finder method that proposed it.
   * Populated from each finder's returned suggestions; reset on node change.
   */
  proposedSource?: ReadonlyMap<number, FinderMethod>;
  /**
   * Called on mouseenter/leave over a proposed row — syncs hover highlight to
   * the map amber layer. Pass null on leave.
   */
  onHoverProposed?: (divisionId: number | null) => void;
}

export function SuggestionList({ node, mutations, onPreview, onPreviewTransfer, onPreviewUnion, parentMapUrlById, parentMapNameById, proposedSource, onHoverProposed }: SuggestionListProps) {
  if (!node) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Select a region in the tree to see suggestions.
        </Typography>
      </Box>
    );
  }

  const { suggestions, id: regionId, regionMapUrl, wikidataId, name: regionName, markerPoints } = node;

  // Belt-and-suspenders render-time dedup: keeps a legit custom-geom + plain pair
  // but kills exact duplicates created by a prior optimistic-accept race.
  const seenKeys = new Set<string>();
  const assignedDivisions = node.assignedDivisions.filter(d => {
    const key = `${d.divisionId}-${String(d.hasCustomGeom)}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  // Parent-map fallback for union preview (mirrors the single-division path in CountryWorkspacePage)
  const effectiveMapUrl = regionMapUrl ?? parentMapUrlById?.get(regionId);
  const parentLabel = parentMapUrlById?.has(regionId)
    ? `${parentMapNameById?.get(regionId) ?? 'Parent'} map`
    : undefined;
  const effectiveMapLabel: string | undefined = regionMapUrl ? undefined : parentLabel;

  const handleRemoveDivision = (divisionId: number) => {
    mutations.rejectMutation.mutate({ regionId, divisionId });
  };

  const handleAccept = (divisionId: number) => {
    mutations.acceptMutation.mutate({ regionId, divisionId });
  };

  const handleReject = (divisionId: number) => {
    mutations.rejectMutation.mutate({ regionId, divisionId });
  };

  // Conflict accept (↑): if onPreviewTransfer is provided AND the node has a
  // wikidataId, open the 3-layer transfer preview dialog (legacy behaviour);
  // otherwise fall back to direct transfer (pre-3d behaviour, same as legacy
  // TreeNodeRow.tsx:177 guard).
  const handleConflictAccept = (sug: MatchSuggestion) => {
    if (!sug.conflict) return;
    if (onPreviewTransfer && wikidataId) {
      // Pass ONLY this suggestion — per-row semantics = single suggestion.
      // Multi-donor batch machinery in useWorkspacePreview stays correct for
      // future batch use but must NOT be triggered here.
      onPreviewTransfer(
        sug.divisionId, sug.name, sug.path,
        { donorDivisionId: sug.conflict.donorDivisionId, donorDivisionName: sug.conflict.donorDivisionName, donorRegionId: sug.conflict.donorRegionId, type: sug.conflict.type },
        wikidataId, regionName,
        regionId,
      );
    } else {
      mutations.onAcceptTransfer(regionId, sug.divisionId, { type: sug.conflict.type, donorRegionId: sug.conflict.donorRegionId, donorDivisionId: sug.conflict.donorDivisionId });
    }
  };

  const handleAcceptAll = () => {
    const cleanSuggestions = suggestions.filter(s => !s.conflict);
    if (cleanSuggestions.length === 0) return;
    mutations.acceptAllMutation.mutate(cleanSuggestions.map(s => ({ regionId, divisionId: s.divisionId })));
  };

  const handleRejectRemaining = () => {
    mutations.rejectRemainingMutation.mutate(regionId);
  };

  // "Dismiss all" rejects every current suggestion (uses rejectRemainingMutation
  // which is a single-call bulk reject — no need for Promise.all).
  const handleDismissAll = () => {
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
                        onClick={() => onPreview(div.divisionId, div.name, div.path, regionMapUrl ?? undefined, wikidataId ?? undefined, regionId, true, undefined, regionName, markerPoints ?? undefined)}
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

      {/* Proposed (Suggestions) */}
      {suggestions.length > 0 && (
        <Box
          sx={suggestions.length > 0 ? {
            borderLeft: '3px solid',
            borderColor: 'primary.light',
            bgcolor: 'action.hover',
            borderRadius: '0 4px 4px 0',
          } : undefined}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1, pt: 0.5 }}>
            <Typography variant="overline" sx={{ color: 'primary.main', fontSize: '0.65rem', fontWeight: 700 }}>
              Proposed ({suggestions.length})
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              {cleanSuggestions.length > 1 && onPreviewUnion && (
                <Tooltip title="Preview the union of all suggested divisions vs region map/geoshape">
                  <Button
                    size="small"
                    startIcon={<UnionIcon sx={{ fontSize: 13 }} />}
                    onClick={() => onPreviewUnion(
                      regionId,
                      cleanSuggestions.map(s => s.divisionId),
                      { wikidataId: wikidataId ?? undefined, regionMapUrl: effectiveMapUrl, regionMapLabel: effectiveMapLabel, regionName },
                    )}
                    disabled={isBusy}
                  >
                    Preview union
                  </Button>
                </Tooltip>
              )}
              {cleanSuggestions.length > 1 && (
                <Button size="small" onClick={handleAcceptAll} disabled={isBusy}>
                  Accept all
                </Button>
              )}
              <Button size="small" color="error" onClick={handleDismissAll} disabled={isBusy}>
                Dismiss all
              </Button>
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
              const sourceMethod = proposedSource?.get(sug.divisionId);
              return (
                <ListItem
                  key={sug.divisionId}
                  dense
                  onMouseEnter={() => onHoverProposed?.(sug.divisionId)}
                  onMouseLeave={() => onHoverProposed?.(null)}
                  secondaryAction={
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      {isBusy && <CircularProgress size={14} sx={{ mt: 0.5 }} />}
                      <Tooltip title="Preview">
                        <IconButton
                          size="small"
                          onClick={() => onPreview(sug.divisionId, sug.name, sug.path, regionMapUrl ?? undefined, wikidataId ?? undefined, regionId, false, undefined, regionName, markerPoints ?? undefined)}
                        >
                          <PreviewIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={hasConflict ? `Transfer preview: ${sug.conflict!.donorRegionName}` : 'Accept'}>
                        <Button
                          size="small"
                          variant="outlined"
                          color="success"
                          sx={{ minWidth: 0, px: 0.5, py: 0, fontSize: '0.65rem', height: 22 }}
                          onClick={() => {
                            if (hasConflict) {
                              handleConflictAccept(sug);
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
                      </Box>
                    }
                    secondary={
                      <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'nowrap' }}>
                        {sug.path && sug.path !== sug.name && (
                          <Typography component="span" variant="caption" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>{sug.path}</Typography>
                        )}
                        {/* Name score — raw 0-1000 trigram/exact value, shown as plain number */}
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                          {Math.round(sug.score)}
                        </Typography>
                        {/* Geo-similarity — shown only when present; 0..1 value ×100 → % */}
                        {sug.geoSimilarity != null && (
                          <Typography
                            component="span"
                            variant="caption"
                            sx={{
                              color: geoSimColor(sug.geoSimilarity),
                              fontWeight: sug.geoSimilarity >= 0.5 ? 600 : 400,
                              flexShrink: 0,
                            }}
                          >
                            geo {Math.round(sug.geoSimilarity * 100)}%
                          </Typography>
                        )}
                        {/* Source chip — shows which finder proposed this candidate */}
                        {sourceMethod && (
                          <Typography component="span" variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
                            · {sourceMethod}
                          </Typography>
                        )}
                      </Box>
                    }
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
