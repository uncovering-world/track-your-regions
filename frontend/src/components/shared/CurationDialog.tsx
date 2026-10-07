/**
 * CurationDialog — Shared dialog for curator actions on an experience.
 *
 * Supports editing (name, description, type, picture, links), rejecting, and
 * unrejecting an experience within a region, and lists the places the object
 * is made of with the way to correct each (`CurationPlaces`). The edit's
 * fields are held by the form layer (`useEditForm`, ADR-0076), which decides
 * what changed, what is sent and which field a refusal names. Ends with the
 * object's curation history (`CurationHistory`). Self-contained mutations that
 * invalidate the relevant query caches on success.
 *
 * Used from both Map mode (ExperienceList) and Discover mode
 * (ExperienceCard, ExperienceDetailPanel).
 */

import { memo, useId } from 'react';
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
  FormHelperText,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import BlockIcon from '@mui/icons-material/Block';
import UndoIcon from '@mui/icons-material/Undo';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchExperience,
  type Experience,
  type ImageCredit,
} from '../../api/experiences';
import {
  editExperience,
  rejectExperience,
  unrejectExperience,
  removeExperienceFromRegion,
  setExperienceState,
} from '../../api/curation';
import { useEditForm } from '../../hooks/useEditForm';
import { invalidateExperiences } from '../../utils/queryInvalidation';
import { PictureWithCredit } from './PictureWithCredit';
import { CurationPlaces } from './CurationPlaces';
import { verdictOf } from './LifecycleChip';
import { CurationHistory } from './CurationHistory';
import { typeOptionsFor } from '../../utils/experienceTypes';
import { tidyLabel } from '@tyr/shared/labels';
import { queryKeys } from '../../api/queryKeys';

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
 * for a picture that is not theirs. Read off the row, which every list this
 * dialog opens from sends beside `image_url` (the region list's `Experience`).
 */
function creditForPreview(editImageUrl: string, row: Experience): ImageCredit | null {
  if (editImageUrl !== (row.image_url || '')) return null;
  return row.image_credit;
}

/** What the edit form holds, named by the request body's keys (ADR-0076). */
type EditFields = Required<Pick<Parameters<typeof editExperience>[1],
  'name' | 'shortDescription' | 'type' | 'imageUrl' | 'websiteUrl' | 'wikipediaUrl'>>;

const text = (value: unknown) => (typeof value === 'string' ? value : '');

function CurationDialogComponent({ experience, regionId, onClose }: CurationDialogProps) {
  const queryClient = useQueryClient();
  const typeOptions = typeOptionsFor(experience?.kind_id);

  // A select's refusal is read out with it, as a text field's helper text is.
  const typeErrorId = useId();

  // Fetch full experience detail to get metadata.website
  const detailQuery = useQuery({
    queryKey: queryKeys.experience.one(experience?.id),
    queryFn: () => fetchExperience(experience!.id),
    enabled: !!experience,
    staleTime: 300_000,
  });

  // The stored values. The two links arrive with the detail read, and the form
  // moves them in only where the curator has not typed. The name is compared
  // and sent as the endpoint stores it (`tidyLabel`, #835), and an emptied one,
  // which the endpoint refuses, holds the save back.
  const metadata = detailQuery.data?.metadata;
  const form = useEditForm<EditFields>({
    initial: {
      name: experience?.name ?? '',
      shortDescription: experience?.short_description ?? '',
      type: experience?.type ?? '',
      imageUrl: experience?.image_url ?? '',
      websiteUrl: text(metadata?.website),
      wikipediaUrl: text(metadata?.wikipediaUrl),
    },
    resetKey: experience?.id ?? null,
    tidy: { name: tidyLabel },
    required: ['name'],
  });
  const rejectForm = useEditForm({ initial: { reason: '' }, resetKey: experience?.id ?? null });

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
      queryClient.invalidateQueries({ queryKey: queryKeys.discover.regionCountsAll });
      onClose();
    },
  });

  if (!experience) return null;

  const handleReject = () => {
    if (!regionId) return;
    rejectMutation.mutate({
      experienceId: experience.id,
      rId: regionId,
      reason: rejectForm.changes().reason || undefined,
    });
  };

  const handleUnreject = () => {
    if (!regionId) return;
    unrejectMutation.mutate({
      experienceId: experience.id,
      rId: regionId,
    });
  };

  const imageUrl = form.values.imageUrl;
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
          {experience.kind_name && (
            <Chip label={experience.kind_name} size="small" variant="outlined" />
          )}
        </Box>
      </DialogTitle>

      <DialogContent>
        {/* Edit Section */}
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>
          Edit Details
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 2 }}>
          <TextField label="Name" {...form.field('name')} fullWidth size="small" required />
          {/* Where it is, beside what it is called: a fact of the object, read as a
              field of this form. For a museum or a monument the one place is the
              object, and this field is the only row that place has anywhere (#583).
              Keyed on the object: this dialog is mounted for as long as the list is
              and reconciles across objects, and a place opened under one object must
              not stay open under the next — the form would correct the old row and
              report the new object. */}
          <CurationPlaces
            key={experience.id}
            experienceId={experience.id}
            experienceName={experience.name}
            regionId={regionId}
            countryNames={experience.country_names}
            objectMissingSince={experience.missing_since}
          />
          <TextField
            label="Short Description"
            {...form.field('shortDescription')}
            fullWidth
            size="small"
            multiline
            rows={2}
          />
          {/* The kind's own types and nothing else — cultural / natural / mixed for a
              World Heritage site, monument / sculpture for public art, cathedral / church / chapel / monastery / mosque / temple / shrine / synagogue
              for a place of worship — and no control
              at all for a museum, which is a kind without types (ADR-0045, #814). */}
          {typeOptions.length > 0 && (
            <FormControl fullWidth size="small" error={!!form.errors.type}>
              <InputLabel>Type</InputLabel>
              <Select
                value={form.values.type}
                label="Type"
                SelectDisplayProps={{ 'aria-describedby': form.errors.type ? typeErrorId : undefined }}
                onChange={(e) => form.set('type', e.target.value)}
              >
                <MenuItem value="">None</MenuItem>
                {typeOptions.map(option => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </Select>
              {form.errors.type && <FormHelperText id={typeErrorId}>{form.errors.type}</FormHelperText>}
            </FormControl>
          )}
          <Box>
            <TextField
              label="Image URL"
              {...form.field('imageUrl')}
              fullWidth
              size="small"
              placeholder="https://commons.wikimedia.org/..."
            />
            {/* What the address in the box draws, as the create dialog shows it —
                so checking a picture is not a copy, a new tab and a way back. An
                emptied box draws nothing: the picture is the field's value, and
                the removal readers get is the removal the curator sees. */}
            {imageUrl && (
              <PictureWithCredit url={imageUrl} credit={creditForPreview(imageUrl, experience)} alt="Picture preview" />
            )}
          </Box>
          <TextField
            label="Wikipedia URL"
            {...form.field('wikipediaUrl')}
            fullWidth
            size="small"
            placeholder="https://en.wikipedia.org/wiki/..."
          />
          <TextField
            label="Website URL"
            {...form.field('websiteUrl', { helperText: 'Official site (UNESCO page, museum site, etc.)' })}
            fullWidth
            size="small"
            placeholder="https://..."
          />
        </Box>

        {editMutation.isSuccess && (
          <Alert severity="success" sx={{ mb: 1 }}>
            Changes saved.
          </Alert>
        )}
        {form.formError && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {form.formError}
          </Alert>
        )}

        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <Button
            size="small"
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={() => form.submit(editMutation.mutateAsync)}
            disabled={!form.dirty || form.missing || isPending}
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
                    {unrejectMutation.error.message}
                  </Alert>
                )}
                {removeMutation.isError && (
                  <Alert severity="error" sx={{ mt: 1 }}>
                    {removeMutation.error.message}
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
                  {...rejectForm.field('reason')}
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
                    {rejectMutation.error.message}
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

        {/* Keyed by the place: the next one opens with its history folded. */}
        <CurationHistory key={experience.id} experienceId={experience.id} regionId={regionId} />
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
