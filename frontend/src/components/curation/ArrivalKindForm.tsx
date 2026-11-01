/**
 * The form behind an arrival's "Belongs in another kind…" (#2213), loaded when
 * the curator opens it: `ArrivalKindChoice` says what it answers.
 *
 * The kinds offered are the ones the place is not in yet, World Heritage Sites
 * aside — the place's own card's list (`addable`, #2035), read when the form
 * opens.
 */

import { useId, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Stack, TextField, Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { answerArrivalWithKind, fetchPlaceKinds, type ArrivalAnsweredWithKind } from '../../api/curation';
import { queryKeys } from '../../api/queryKeys';
import { typeLabelFor, typeOptionsFor } from '../../utils/experienceTypes';

/** What the curator is told once the answer landed. */
export function arrivalKindOutcome(name: string, kindId: number, type: string | null, result: ArrivalAnsweredWithKind): string {
  const into = type ? `${result.kind} as ${typeLabelFor(kindId, type).toLowerCase()}` : result.kind;
  if (!result.stays) return `${name}: added to ${into} and kept out of ${result.fromKind}`;
  if (result.arrivalPublished) return `${name}: added to ${into}, and published in ${result.fromKind} too`;
  return `${name}: added to ${into}; its arrival in ${result.fromKind} still waits — ${result.arrivalWaits ?? 'the publish was refused'}`;
}

export function ArrivalKindForm({ experienceId, name, membershipId, arrivingKind, disabled, onDone, onCancel }: {
  experienceId: number;
  name: string;
  /** The arrival's membership, the one the answer is about. */
  membershipId: number | null | undefined;
  /** The kind that brought the place, by name. */
  arrivingKind: string;
  disabled: boolean;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const kindLabel = useId();
  const typeLabel = useId();
  const queryClient = useQueryClient();
  const [kindId, setKindId] = useState<number | ''>('');
  const [type, setType] = useState('');
  const [stays, setStays] = useState(false);
  const [note, setNote] = useState('');
  const kinds = useQuery({
    queryKey: queryKeys.curation.placeKinds(experienceId),
    queryFn: () => fetchPlaceKinds(experienceId),
  });
  const addable = kinds.data?.addable ?? [];
  const kind = addable.find(candidate => candidate.kindId === kindId);
  const typeOptions = typeOptionsFor(kind?.kindId);
  // A kind with a vocabulary is filed under one of its types, as a run files every place it brings.
  const ready = kind !== undefined && (typeOptions.length === 0 || type !== '');
  const verb = stays ? 'Add to' : 'Move to';
  const answer = useMutation({
    mutationFn: () => answerArrivalWithKind(experienceId, {
      kindId: kindId as number, type: type || undefined, stays, note: note.trim() || undefined,
      ...(membershipId ? { membershipId } : {}),
    }),
    onSuccess: (result) => {
      // The kinds this form read are stale now, and the place's edit dialog reads the same
      // ones: left cached, it would offer the kind just added and answer the add with a 409.
      queryClient.invalidateQueries({ queryKey: queryKeys.curation.placeKinds(experienceId) });
      onDone(arrivalKindOutcome(name, kindId as number, type || null, result));
    },
  });

  return (
    <Box sx={{ p: 1.5, width: '100%', borderRadius: 1, bgcolor: (theme) => alpha(theme.palette.primary.main, 0.05) }}>
      <Stack spacing={1.5}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>Belongs in another kind</Typography>
        {kinds.isError && <Alert severity="error" sx={{ py: 0 }}>The kinds could not be read</Alert>}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <FormControl fullWidth size="small">
            <InputLabel id={kindLabel}>Kind</InputLabel>
            <Select
              labelId={kindLabel}
              value={kindId}
              // Until the place's kinds are read there is nothing to choose from.
              disabled={!kinds.data}
              label="Kind"
              onChange={(e) => { setKindId(e.target.value === '' ? '' : Number(e.target.value)); setType(''); }}
            >
              {addable.map(candidate => (
                <MenuItem key={candidate.kindId} value={candidate.kindId}>{candidate.kindName}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {typeOptions.length > 0 && (
            <FormControl fullWidth size="small">
              <InputLabel id={typeLabel}>Type</InputLabel>
              <Select labelId={typeLabel} value={type} label="Type" onChange={(e) => setType(e.target.value)}>
                {typeOptions.map(option => (
                  <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </Stack>
        <FormControlLabel
          control={<Checkbox size="small" checked={stays} onChange={(e) => setStays(e.target.checked)} />}
          label={`It belongs in ${arrivingKind} too`}
        />
        {kind && (
          <Typography variant="body2">
            {`Readers find it in ${kind.kindName} from now on, and later runs keep it there. `}
            {stays
              ? `It is published in ${arrivingKind} as well.`
              : `It is kept out of ${arrivingKind}, and that kind's runs do not bring it back.`}
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
          <Button size="small" variant="contained" disabled={!ready || answer.isPending || disabled} onClick={() => answer.mutate()}>
            {kind ? `${verb} ${kind.kindName}` : 'Move'}
          </Button>
          <Button size="small" disabled={answer.isPending} onClick={onCancel}>Cancel</Button>
        </Stack>
        {answer.error && <Alert severity="error" sx={{ py: 0 }}>{(answer.error as Error).message}</Alert>}
      </Stack>
    </Box>
  );
}
