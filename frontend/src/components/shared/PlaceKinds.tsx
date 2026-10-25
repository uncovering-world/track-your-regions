/**
 * Every kind a place belongs to, on its curation dialog, and taking a
 * published place out of one of them (#2022).
 *
 * The review queue answers only what a run asked about. The Temple of Concord
 * is offered by Places of worship and by Archaeology, only its podium is left,
 * and no run raised a question about it: a curator who judged it not worth a
 * visit had nowhere to say so. Here each kind is a row with where it stands;
 * an offered one can be taken out, with a note, after a step that says what
 * readers lose; a kept-out one says who kept it out and why, and is put back
 * with the override every pinned refusal has. An arrival and a rule's refusal
 * are answered on the review page, and say so.
 */

import { useState } from 'react';
import { Alert, Box, Button, Chip, Stack, TextField, Typography } from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchPlaceKinds, keepOutOfKind, setExperienceAdmission, type PlaceKindStanding,
} from '../../api/curation';
import { queryKeys } from '../../api/queryKeys';
import { formatDateTime } from '../../utils/dateFormat';
import { displayNameOf } from '../../utils/displayName';
import { typeLabelFor } from '../../utils/experienceTypes';
import { invalidateExperiences } from '../../utils/queryInvalidation';

/** The line under a kind's name: its type, then where it stands. */
function standingLine(kind: PlaceKindStanding): string {
  const type = kind.type ? `${typeLabelFor(kind.kindId, kind.type).toLowerCase()} · ` : '';
  switch (kind.state) {
    case 'offered': return `${type}offered`;
    case 'waiting': return `${type}waiting for a curator, on the review page`;
    case 'refused': return [`${type}kept out by its rule`, kind.reason].filter(Boolean).join(': ');
    case 'kept-out': return `${type}kept out`;
  }
}

/** Who kept it out and when, as the pins list says it. */
function keptOutBy(kind: PlaceKindStanding): string {
  const who = displayNameOf(kind.curatorName) ?? 'a curator';
  const when = kind.answeredAt ? formatDateTime(kind.answeredAt) : null;
  return [`kept out by ${who}`, when].filter(Boolean).join(' · ');
}

/** The row's ground: tinted while it asks, greyed once kept out. */
function rowGround(theme: Theme, asking: boolean, keptOut: boolean): string | undefined {
  if (asking) return alpha(theme.palette.error.main, 0.05);
  return keptOut ? theme.palette.action.hover : undefined;
}

function KindRow({ experienceId, kind, onlyOffered, regionId }: {
  experienceId: number;
  kind: PlaceKindStanding;
  /** Whether this is the one kind that offers the place: taken out, readers see it nowhere. */
  onlyOffered: boolean;
  regionId: number | null;
}) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const settled = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.curation.placeKinds(experienceId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.curation.admissionPinsAll });
    queryClient.invalidateQueries({ queryKey: queryKeys.curation.reviewQueueAll });
    queryClient.invalidateQueries({ queryKey: queryKeys.experience.curationLogAll });
    invalidateExperiences(queryClient, { regionId, experienceId });
  };
  const takeOut = useMutation({
    mutationFn: () => keepOutOfKind(experienceId, { membershipId: kind.membershipId, note: note.trim() || undefined }),
    onSuccess: () => { setAsking(false); setNote(''); settled(); },
  });
  const putBack = useMutation({
    mutationFn: () => setExperienceAdmission(experienceId, { decision: 'override', membershipId: kind.membershipId }),
    onSuccess: settled,
  });
  const failed = takeOut.error ?? putBack.error;
  const keptOut = kind.state === 'kept-out';

  return (
    <Box
      sx={{
        p: 1.5, borderBottom: 1, borderColor: 'divider', '&:last-of-type': { borderBottom: 0 },
        bgcolor: (theme) => rowGround(theme, asking, keptOut),
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, color: keptOut ? 'text.secondary' : undefined }}>
            {kind.kindName}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">{standingLine(kind)}</Typography>
          {keptOut && (
            <>
              <Chip size="small" color="warning" variant="outlined" label={keptOutBy(kind)} sx={{ mt: 0.5 }} />
              {kind.note && (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ fontStyle: 'italic', mt: 0.5 }}>
                  “{kind.note}”
                </Typography>
              )}
            </>
          )}
        </Box>
        {kind.canAnswer && kind.state === 'offered' && !asking && (
          <Button size="small" variant="outlined" color="error" onClick={() => setAsking(true)}>Take out…</Button>
        )}
        {kind.canAnswer && keptOut && (
          <Button size="small" variant="outlined" disabled={putBack.isPending} onClick={() => putBack.mutate()}>
            Put it back
          </Button>
        )}
      </Stack>

      {asking && (
        <Stack spacing={1.25} sx={{ mt: 1.25 }}>
          {onlyOffered ? (
            <Alert severity="warning" sx={{ py: 0 }}>
              {kind.kindName} is the only kind that offers it. Taken out, it leaves every list, the map and the counts.
              Visits already recorded stay.
            </Alert>
          ) : (
            <Typography variant="body2">
              It leaves {kind.kindName}’s lists, counts and map now, and stays in its other kinds. Later runs keep it
              out. It can be put back here or from the kept-out list.
            </Typography>
          )}
          <TextField
            label="Why (optional, kept in its history)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            size="small"
            fullWidth
            inputProps={{ maxLength: 1000 }}
          />
          <Stack direction="row" spacing={1}>
            <Button
              size="small" variant="contained" color="error" disabled={takeOut.isPending}
              onClick={() => takeOut.mutate()}
            >
              Take out of {kind.kindName}
            </Button>
            <Button size="small" disabled={takeOut.isPending} onClick={() => { setAsking(false); setNote(''); }}>
              Cancel
            </Button>
          </Stack>
        </Stack>
      )}
      {failed && <Alert severity="error" sx={{ py: 0, mt: 1 }}>{(failed as Error).message}</Alert>}
    </Box>
  );
}

/** The Kinds section of a place's curation dialog; nothing until its kinds are read. */
export function PlaceKinds({ experienceId, regionId }: { experienceId: number; regionId: number | null }) {
  const kinds = useQuery({
    queryKey: queryKeys.curation.placeKinds(experienceId),
    queryFn: () => fetchPlaceKinds(experienceId),
    // Read afresh on every opening: the review page answers kinds too, and a row
    // offering an action on a standing that has moved would only earn a 409.
    staleTime: 0,
  });
  const list = kinds.data?.kinds ?? [];
  if (list.length === 0) return null;
  const offered = list.filter(kind => kind.state === 'offered').length;

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Kinds</Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        Where readers find this place. Each kind is answered on its own.
      </Typography>
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
        {list.map(kind => (
          <KindRow
            key={kind.membershipId}
            experienceId={experienceId}
            kind={kind}
            onlyOffered={kind.state === 'offered' && offered === 1}
            regionId={regionId}
          />
        ))}
      </Box>
    </Box>
  );
}
