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
 *
 * What the history's entries read as — the chip naming each act and the line under it —
 * is `curationLog.ts`, which is presentation this dialog happens to be the first caller
 * of rather than anything of the dialog's own.
 */

import { memo, useState, useEffect } from 'react';
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
  setExperienceState,
  type Experience,
  type ExperienceDetail,
  type ImageCredit,
} from '../../api/experiences';
import { formatRelativeTime } from '../../utils/dateFormat';
import { invalidateExperiences } from '../../utils/queryInvalidation';
import { LoadingSpinner } from './LoadingSpinner';
import { PictureWithCredit } from './PictureWithCredit';
import { verdictOf } from './LifecycleChip';
import { ACTION_LABELS, formatLogDetails } from './curationLog';
import { typeOptionsFor } from '../../utils/experienceTypes';

interface CurationDialogProps {
  /** The experience to curate — null means dialog is closed */
  experience: Experience | null;
  /** Region context for reject/unreject scope */
  regionId: number | null;
  onClose: () => void;
}

/**
 * Whose photograph the preview under the Image URL box is showing, if anyone's.
 *
 * The credit goes with the stored picture and with nothing else: an address
 * typed and not yet saved has no credit until the save resolves one
 * (`PATCH /experiences/:id/edit` writes `metadata.imageCredit` beside
 * `image_url`), and a credit under somebody else's photograph names a person
 * for a picture that is not theirs. Read off the row where the row carries it —
 * every list this dialog opens from sends `image_credit` beside `image_url` —
 * and off the detail's metadata otherwise, the read this dialog already makes.
 */
function creditForPreview(
  editImageUrl: string, row: Experience, detail: ExperienceDetail | undefined,
): ImageCredit | null {
  if (editImageUrl !== (row.image_url || '')) return null;
  if (row.image_credit !== undefined) return row.image_credit;
  return (detail?.metadata?.imageCredit as ImageCredit | null | undefined) ?? null;
}

function CurationDialogComponent({ experience, regionId, onClose }: CurationDialogProps) {
  const queryClient = useQueryClient();

  // Edit fields
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editType, setEditType] = useState('');
  const typeOptions = typeOptionsFor(experience?.category_id);
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
      setEditType(experience.type || '');
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
    invalidateExperiences(queryClient, {
      regionId,
      experienceId: experience?.id,
    });
  };

  // Edit mutation
  const editMutation = useMutation({
    mutationFn: (data: Parameters<typeof editExperience>[1]) =>
      editExperience(experience!.id, data),
    onSuccess: () => {
      invalidateCaches();
    },
  });

  const lifecycleVerdict = verdictOf(experience);

  const lifecycleMutation = useMutation({
    mutationFn: () => setExperienceState(experience!.id, {
      ...(lifecycleVerdict === 'lost' ? { existence: 'extant' as const } : { membership: 'present' as const }),
      // The row as this dialog is showing it. The server compares it under the
      // write lock and refuses if someone answered in between, so a stale
      // dialog cannot undo an answer it never saw.
      expected: {
        membership: experience!.source_membership ?? 'present',
        existence: experience!.existence ?? 'extant',
        flagged: experience!.missing_since != null,
      },
    }),
    onSuccess: () => {
      invalidateCaches();
      onClose();
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
    // A field travels only when it changed, and an emptied one travels as ''
    // — the API's way of clearing it (#696). Folding it into `undefined` here
    // had `JSON.stringify` drop it, so a removal never left the browser: alone
    // it was answered "No fields to update", beside another change it was
    // reported saved.
    const changes: Record<string, string> = {};
    if (editName !== experience.name) changes.name = editName;
    if (editDescription !== (experience.short_description || '')) changes.shortDescription = editDescription;
    if (editType !== (experience.type || '')) changes.type = editType;
    if (editImageUrl !== (experience.image_url || '')) changes.imageUrl = editImageUrl;
    const currentWebsite = (detailQuery.data?.metadata?.website as string) || '';
    if (editWebsiteUrl !== currentWebsite) changes.websiteUrl = editWebsiteUrl;
    const currentWiki = (detailQuery.data?.metadata?.wikipediaUrl as string) || '';
    if (editWikipediaUrl !== currentWiki) changes.wikipediaUrl = editWikipediaUrl;

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
  const previewCredit = creditForPreview(editImageUrl, experience, detailQuery.data);
  const hasChanges =
    editName !== experience.name ||
    editDescription !== (experience.short_description || '') ||
    editType !== (experience.type || '') ||
    editImageUrl !== (experience.image_url || '') ||
    editWebsiteUrl !== currentWebsite ||
    editWikipediaUrl !== currentWikipedia;

  const isRejected = experience.is_rejected;
  // Every write from this dialog, including the lifecycle correction: they all
  // act on the same row, and one left enabled while another is in flight is an
  // invitation to send two verdicts about the same object.
  const isPending = editMutation.isPending || rejectMutation.isPending
    || unrejectMutation.isPending || removeMutation.isPending || lifecycleMutation.isPending;

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
          {experience.category_name && (
            <Chip label={experience.category_name} size="small" variant="outlined" />
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
          {/* The kind's own types and nothing else — cultural / natural / mixed for a
              World Heritage site, monument / sculpture for public art — and no control
              at all for a museum, which is a kind without types (ADR-0045, #814). The
              list used to offer every vocabulary plus `art` to every object. */}
          {typeOptions.length > 0 && (
            <FormControl fullWidth size="small">
              <InputLabel>Type</InputLabel>
              <Select
                value={editType}
                label="Type"
                onChange={(e) => setEditType(e.target.value)}
              >
                <MenuItem value="">None</MenuItem>
                {typeOptions.map(option => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <Box>
            <TextField
              label="Image URL"
              value={editImageUrl}
              onChange={(e) => setEditImageUrl(e.target.value)}
              fullWidth
              size="small"
              placeholder="https://commons.wikimedia.org/..."
            />
            {/* What the address in the box draws, as the create dialog shows it —
                so checking a picture is not a copy, a new tab and a way back. An
                emptied box draws nothing: the picture is the field's value, and
                the removal readers get is the removal the curator sees. */}
            {editImageUrl && (
              <PictureWithCredit url={editImageUrl} credit={previewCredit} alt="Picture preview" />
            )}
          </Box>
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

        {/* Taking a verdict back.
            The review queue lists only rows a run flagged, so it lets go of an
            object the moment it is answered — and a `lost` verdict then hides
            it from every list, the map, search and the counts. This is the one
            surface a curator can still reach it from, and without a control
            here a mis-click has no remedy short of SQL. */}
        {lifecycleVerdict && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              {lifecycleVerdict === 'lost' ? 'Recorded as no longer existing' : 'Recorded as delisted'}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {lifecycleVerdict === 'lost'
                ? 'It is hidden from lists, the map and search. Visits to it still count.'
                : 'It stays in lists and on the map, marked as no longer officially listed.'}
            </Typography>
            {lifecycleMutation.isError && (
              <Alert severity="error" sx={{ mb: 1 }}>
                Could not change it: {(lifecycleMutation.error as Error)?.message}
              </Alert>
            )}
            <Button
              size="small"
              variant="outlined"
              disabled={isPending}
              onClick={() => lifecycleMutation.mutate()}
            >
              {lifecycleVerdict === 'lost' ? 'It does still exist' : 'It is still listed'}
            </Button>
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
              <LoadingSpinner size={20} padding="8px 0" />
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

/**
 * Memoised because it is mounted for as long as the list is, closed or not, and
 * the list re-renders on every scroll of it. Measured on Europe's 661 rows, one
 * wheel scroll spent 14 ms re-rendering a dialog nobody had opened. Kept mounted
 * rather than gated on `experience` so that closing it still fades out.
 */
export const CurationDialog = memo(CurationDialogComponent);
