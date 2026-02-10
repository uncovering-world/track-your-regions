/**
 * CurationDialog — Shared dialog for curator actions on an experience.
 *
 * Supports editing (name, description, category, image), rejecting, and
 * unrejecting an experience within a region. Includes a collapsible
 * curation history log. Self-contained mutations that invalidate the
 * relevant query caches on success.
 *
 * Used from both Map mode (ExperienceList) and Discover mode
 * (ExperienceCard, ExperienceDetailPanel).
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Alert,
  Box,
  Typography,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Collapse,
  CircularProgress,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import BlockIcon from '@mui/icons-material/Block';
import UndoIcon from '@mui/icons-material/Undo';
import HistoryIcon from '@mui/icons-material/History';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  editExperience,
  rejectExperience,
  unrejectExperience,
  removeExperienceFromRegion,
  fetchCurationLog,
  fetchExperience,
  type Experience,
  type CurationLogEntry,
} from '../../api/experiences';

interface CurationDialogProps {
  /** The experience to curate — null means dialog is closed */
  experience: Experience | null;
  /** Region context for reject/unreject scope */
  regionId: number | null;
  onClose: () => void;
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  rejected: { label: 'Rejected', color: '#EF4444' },
  unrejected: { label: 'Unrejected', color: '#22C55E' },
  edited: { label: 'Edited', color: '#3B82F6' },
  created: { label: 'Created', color: '#8B5CF6' },
  added_to_region: { label: 'Added to region', color: '#0D9488' },
  removed_from_region: { label: 'Removed from region', color: '#F59E0B' },
};

function formatLogDetails(entry: CurationLogEntry): string | null {
  if (!entry.details) return null;
  const d = entry.details as Record<string, unknown>;

  if (entry.action === 'rejected' && d.reason) {
    return `Reason: ${d.reason}`;
  }

  if (entry.action === 'edited') {
    const changes: string[] = [];
    for (const [field, val] of Object.entries(d)) {
      const change = val as { old?: unknown; new?: unknown } | undefined;
      if (change?.old !== undefined && change?.new !== undefined) {
        const oldStr = String(change.old || '(empty)');
        const newStr = String(change.new || '(empty)');
        // Truncate long values
        const truncOld = oldStr.length > 40 ? oldStr.slice(0, 40) + '...' : oldStr;
        const truncNew = newStr.length > 40 ? newStr.slice(0, 40) + '...' : newStr;
        changes.push(`${field}: "${truncOld}" → "${truncNew}"`);
      }
    }
    return changes.length > 0 ? changes.join('\n') : null;
  }

  if (entry.action === 'created' && d.name) {
    return `Name: ${d.name}`;
  }

  return null;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function CurationDialog({ experience, regionId, onClose }: CurationDialogProps) {
  const queryClient = useQueryClient();

  // Edit fields
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editImageUrl, setEditImageUrl] = useState('');
  const [editWebsiteUrl, setEditWebsiteUrl] = useState('');
  const [editWikipediaUrl, setEditWikipediaUrl] = useState('');

  // Reject fields
  const [rejectReason, setRejectReason] = useState('');

  // History toggle
  const [historyOpen, setHistoryOpen] = useState(false);

  // Fetch full experience detail to get metadata.website
  const detailQuery = useQuery({
    queryKey: ['experience', experience?.id],
    queryFn: () => fetchExperience(experience!.id),
    enabled: !!experience,
    staleTime: 300_000,
  });

  // Reset fields when experience changes
  useEffect(() => {
    if (experience) {
      setEditName(experience.name);
      setEditDescription(experience.short_description || '');
      setEditCategory(experience.category || '');
      setEditImageUrl(experience.image_url || '');
      setRejectReason('');
      setHistoryOpen(false);
    }
  }, [experience]);

  // Populate website + wikipedia URLs when detail loads
  useEffect(() => {
    if (detailQuery.data?.metadata) {
      const website = detailQuery.data.metadata.website;
      const wiki = detailQuery.data.metadata.wikipediaUrl;
      setEditWebsiteUrl(typeof website === 'string' ? website : '');
      setEditWikipediaUrl(typeof wiki === 'string' ? wiki : '');
    } else {
      setEditWebsiteUrl('');
      setEditWikipediaUrl('');
    }
  }, [detailQuery.data]);

  // Fetch curation log when history is opened
  const logQuery = useQuery({
    queryKey: ['curation-log', experience?.id],
    queryFn: () => fetchCurationLog(experience!.id),
    enabled: !!experience && historyOpen,
    staleTime: 30_000,
  });

  const invalidateCaches = () => {
    if (regionId) {
      queryClient.invalidateQueries({ queryKey: ['experiences', 'by-region', regionId] });
    }
    queryClient.invalidateQueries({ queryKey: ['discover-experiences'] });
    if (experience) {
      queryClient.invalidateQueries({ queryKey: ['experience', experience.id] });
      queryClient.invalidateQueries({ queryKey: ['curation-log', experience.id] });
    }
  };

  // Edit mutation
  const editMutation = useMutation({
    mutationFn: (data: Parameters<typeof editExperience>[1]) =>
      editExperience(experience!.id, data),
    onSuccess: () => {
      invalidateCaches();
    },
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: ({ experienceId, rId, reason }: { experienceId: number; rId: number; reason?: string }) =>
      rejectExperience(experienceId, rId, reason),
    onSuccess: () => {
      invalidateCaches();
      onClose();
    },
  });

  // Unreject mutation
  const unrejectMutation = useMutation({
    mutationFn: ({ experienceId, rId }: { experienceId: number; rId: number }) =>
      unrejectExperience(experienceId, rId),
    onSuccess: () => {
      invalidateCaches();
      onClose();
    },
  });

  // Remove from region mutation
  const removeMutation = useMutation({
    mutationFn: ({ experienceId, rId }: { experienceId: number; rId: number }) =>
      removeExperienceFromRegion(experienceId, rId),
    onSuccess: () => {
      invalidateCaches();
      queryClient.invalidateQueries({ queryKey: ['discover-region-counts'] });
      onClose();
    },
  });

  if (!experience) return null;

  const handleSave = () => {
    const changes: Record<string, string | undefined> = {};
    if (editName !== experience.name) changes.name = editName;
    if (editDescription !== (experience.short_description || '')) changes.shortDescription = editDescription || undefined;
    if (editCategory !== (experience.category || '')) changes.category = editCategory || undefined;
    if (editImageUrl !== (experience.image_url || '')) changes.imageUrl = editImageUrl || undefined;
    const currentWebsite = (detailQuery.data?.metadata?.website as string) || '';
    if (editWebsiteUrl !== currentWebsite) changes.websiteUrl = editWebsiteUrl || undefined;
    const currentWiki = (detailQuery.data?.metadata?.wikipediaUrl as string) || '';
    if (editWikipediaUrl !== currentWiki) changes.wikipediaUrl = editWikipediaUrl || undefined;

    if (Object.keys(changes).length === 0) return;
    editMutation.mutate(changes);
  };

  const handleReject = () => {
    if (!regionId) return;
    rejectMutation.mutate({
      experienceId: experience.id,
      rId: regionId,
      reason: rejectReason || undefined,
    });
  };

  const handleUnreject = () => {
    if (!regionId) return;
    unrejectMutation.mutate({
      experienceId: experience.id,
      rId: regionId,
    });
  };

  const currentWebsite = (detailQuery.data?.metadata?.website as string) || '';
  const currentWikipedia = (detailQuery.data?.metadata?.wikipediaUrl as string) || '';
  const hasChanges =
    editName !== experience.name ||
    editDescription !== (experience.short_description || '') ||
    editCategory !== (experience.category || '') ||
    editImageUrl !== (experience.image_url || '') ||
    editWebsiteUrl !== currentWebsite ||
    editWikipediaUrl !== currentWikipedia;

  const isRejected = experience.is_rejected;
  const isPending = editMutation.isPending || rejectMutation.isPending || unrejectMutation.isPending || removeMutation.isPending;

  return (
    <Dialog
      open={!!experience}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6" sx={{ flex: 1 }}>
            Curate Experience
          </Typography>
          {experience.source_name && (
            <Chip label={experience.source_name} size="small" variant="outlined" />
          )}
        </Box>
      </DialogTitle>

      <DialogContent>
        {/* Edit Section */}
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
          Edit Details
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 2 }}>
          <TextField
            label="Name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            fullWidth
            size="small"
            required
          />
          <TextField
            label="Short Description"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            fullWidth
            size="small"
            multiline
            rows={2}
          />
          <FormControl fullWidth size="small">
            <InputLabel>Category</InputLabel>
            <Select
              value={editCategory}
              label="Category"
              onChange={(e) => setEditCategory(e.target.value)}
            >
              <MenuItem value="">None</MenuItem>
              <MenuItem value="cultural">Cultural</MenuItem>
              <MenuItem value="natural">Natural</MenuItem>
              <MenuItem value="mixed">Mixed</MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Image URL"
            value={editImageUrl}
            onChange={(e) => setEditImageUrl(e.target.value)}
            fullWidth
            size="small"
            placeholder="https://commons.wikimedia.org/..."
          />
          <TextField
            label="Wikipedia URL"
            value={editWikipediaUrl}
            onChange={(e) => setEditWikipediaUrl(e.target.value)}
            fullWidth
            size="small"
            placeholder="https://en.wikipedia.org/wiki/..."
          />
          <TextField
            label="Website URL"
            value={editWebsiteUrl}
            onChange={(e) => setEditWebsiteUrl(e.target.value)}
            fullWidth
            size="small"
            placeholder="https://..."
            helperText="Official site (UNESCO page, museum site, etc.)"
          />
        </Box>

        {editMutation.isSuccess && (
          <Alert severity="success" sx={{ mb: 1 }}>
            Changes saved.
          </Alert>
        )}
        {editMutation.isError && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {(editMutation.error as Error).message || 'Failed to save'}
          </Alert>
        )}

        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <Button
            size="small"
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={handleSave}
            disabled={!editName || !hasChanges || isPending}
          >
            {editMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </Box>

        {/* Reject / Unreject Section */}
        {regionId && (
          <>
            <Divider sx={{ my: 2 }} />

            {isRejected ? (
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: 'error.main' }}>
                  Rejected
                </Typography>
                {experience.rejection_reason && (
                  <Alert severity="warning" variant="outlined" sx={{ mb: 1.5, py: 0 }}>
                    <Typography variant="caption">
                      Reason: {experience.rejection_reason}
                    </Typography>
                  </Alert>
                )}
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Button
                    size="small"
                    variant="outlined"
                    color="success"
                    startIcon={<UndoIcon />}
                    onClick={handleUnreject}
                    disabled={isPending}
                  >
                    {unrejectMutation.isPending ? 'Unrejecting...' : 'Unreject'}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    startIcon={<LinkOffIcon />}
                    onClick={() => {
                      if (!regionId) return;
                      removeMutation.mutate({ experienceId: experience.id, rId: regionId });
                    }}
                    disabled={isPending}
                  >
                    {removeMutation.isPending ? 'Removing...' : 'Remove from region'}
                  </Button>
                </Box>
                {unrejectMutation.isError && (
                  <Alert severity="error" sx={{ mt: 1 }}>
                    {(unrejectMutation.error as Error).message || 'Failed to unreject'}
                  </Alert>
                )}
                {removeMutation.isError && (
                  <Alert severity="error" sx={{ mt: 1 }}>
                    {(removeMutation.error as Error).message || 'Failed to remove'}
                  </Alert>
                )}
              </Box>
            ) : (
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  Reject from Region
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Hides <strong>{experience.name}</strong> from this region. Other regions are not affected.
                </Typography>
                <TextField
                  label="Reason (optional)"
                  placeholder="Why is this experience being rejected?"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  fullWidth
                  size="small"
                  multiline
                  rows={2}
                  sx={{ mb: 1.5 }}
                />
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  startIcon={<BlockIcon />}
                  onClick={handleReject}
                  disabled={isPending}
                >
                  {rejectMutation.isPending ? 'Rejecting...' : 'Reject'}
                </Button>
                {rejectMutation.isError && (
                  <Alert severity="error" sx={{ mt: 1 }}>
                    {(rejectMutation.error as Error).message || 'Failed to reject'}
                  </Alert>
                )}
              </Box>
            )}
          </>
        )}

        {/* Curation History */}
        <Divider sx={{ my: 2 }} />
        <Button
          size="small"
          startIcon={<HistoryIcon />}
          endIcon={historyOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          onClick={() => setHistoryOpen(!historyOpen)}
          sx={{ mb: 1, textTransform: 'none', color: 'text.secondary' }}
        >
          Curation History
          {logQuery.data && logQuery.data.length > 0 && (
            <Chip
              label={logQuery.data.length}
              size="small"
              sx={{ ml: 0.75, height: 18, fontSize: '0.65rem', '& .MuiChip-label': { px: 0.5 } }}
            />
          )}
        </Button>

        <Collapse in={historyOpen}>
          <Box sx={{ maxHeight: 240, overflowY: 'auto' }}>
            {logQuery.isLoading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={20} />
              </Box>
            )}
            {logQuery.isError && (
              <Alert severity="error" sx={{ py: 0 }}>
                Failed to load history
              </Alert>
            )}
            {logQuery.data && logQuery.data.length === 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', py: 1 }}>
                No curation history yet.
              </Typography>
            )}
            {logQuery.data?.map((entry) => {
              const actionInfo = ACTION_LABELS[entry.action] || { label: entry.action, color: '#6B7280' };
              const details = formatLogDetails(entry);
              return (
                <Box
                  key={entry.id}
                  sx={{
                    display: 'flex',
                    gap: 1,
                    py: 0.75,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    alignItems: 'flex-start',
                  }}
                >
                  <Chip
                    label={actionInfo.label}
                    size="small"
                    sx={{
                      height: 20,
                      fontSize: '0.6rem',
                      fontWeight: 600,
                      color: actionInfo.color,
                      bgcolor: `${actionInfo.color}14`,
                      border: `1px solid ${actionInfo.color}30`,
                      flexShrink: 0,
                      '& .MuiChip-label': { px: 0.5 },
                    }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="caption" sx={{ fontWeight: 500 }}>
                      {entry.curator_name}
                    </Typography>
                    {entry.region_name && (
                      <Typography variant="caption" color="text.secondary">
                        {' '}in {entry.region_name}
                      </Typography>
                    )}
                    {details && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', mt: 0.25, whiteSpace: 'pre-line', lineHeight: 1.3 }}
                      >
                        {details}
                      </Typography>
                    )}
                  </Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ flexShrink: 0, fontSize: '0.65rem' }}
                  >
                    {formatRelativeTime(entry.created_at)}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </Collapse>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={isPending}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
