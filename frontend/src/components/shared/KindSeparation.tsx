/**
 * Separating one kind of a place into a place of its own (ADR-0144, #1885), on
 * the curate dialog of a place that holds more than one kind: the way back
 * from a merge, or a join on arrival, that a shared Wikidata item misled — the
 * Places of worship side of the Ajanta Caves, say, if its item named another
 * cave temple. One step to choose, one to confirm, since the action splits a
 * place readers know into two.
 */

import { useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { separateKind } from '../../api/curation';
import { queryKeys } from '../../api/queryKeys';
import type { Experience } from '../../api/experiences';
import { invalidateExperiences } from '../../utils/queryInvalidation';

export function KindSeparation({ experience, regionId, onSeparated }: {
  experience: Experience;
  regionId: number | null;
  /** The place the dialog shows is no longer what it was: the dialog closes. */
  onSeparated: () => void;
}) {
  const queryClient = useQueryClient();
  const [asked, setAsked] = useState<number | null>(null);
  const separation = useMutation({
    mutationFn: (kindId: number) => separateKind(experience.id, kindId),
    onSuccess: () => {
      invalidateExperiences(queryClient, { regionId: regionId ?? undefined, experienceId: experience.id });
      // The separated kind is another place's now: no Kinds list of either may be served from before.
      queryClient.invalidateQueries({ queryKey: queryKeys.curation.placeKindsAll });
      onSeparated();
    },
  });
  const kinds = experience.kinds ?? [];
  if (kinds.length < 2) return null;
  const chosen = kinds.find(kind => kind.kind_id === asked);

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Separate a kind</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        One place for {kinds.map(kind => kind.kind_name).join(' and ')}. If one of them is another place, separate it.
      </Typography>
      {separation.isError && (
        <Alert severity="error" sx={{ mb: 1 }}>
          Could not separate it: {(separation.error as Error)?.message}
        </Alert>
      )}
      {chosen ? (
        <Alert
          severity="warning"
          action={(
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => setAsked(null)} disabled={separation.isPending}>Cancel</Button>
              <Button
                size="small" color="warning" variant="contained" disabled={separation.isPending}
                onClick={() => separation.mutate(chosen.kind_id)}
              >
                Separate
              </Button>
            </Stack>
          )}
        >
          {chosen.kind_name} becomes a place of its own, with the points and works it places. This place keeps its
          other kinds and its visits; travellers who marked it visited are asked which of the two they visited.
        </Alert>
      ) : (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          {kinds.map(kind => (
            <Button
              key={kind.kind_id} size="small" variant="outlined" startIcon={<CallSplitIcon />}
              onClick={() => setAsked(kind.kind_id)}
            >
              Separate {kind.kind_name}
            </Button>
          ))}
        </Stack>
      )}
    </Box>
  );
}
