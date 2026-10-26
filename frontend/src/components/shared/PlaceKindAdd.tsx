/**
 * Putting a place into a kind no run offers it in, at the foot of its Kinds
 * section (#2035).
 *
 * A run finds a place only through its kind's rule: the East Side Gallery is a
 * mile of murals that Wikidata types an art museum, so Public art never reads
 * it. Closed, this is one row that says what it is for; open, the kind, its
 * type from the kind's own vocabulary, what the add does for readers and for
 * later runs, and an optional reason kept in the place's history. The list
 * holds only the kinds the place is not in yet, and never World Heritage Sites
 * — the server's `addable`.
 */

import { useId, useState } from 'react';
import {
  Alert, Box, Button, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useMutation } from '@tanstack/react-query';
import { addToKind, type AddableKind } from '../../api/curation';
import { typeOptionsFor } from '../../utils/experienceTypes';

export function PlaceKindAdd({ experienceId, addable, onAdded }: {
  experienceId: number;
  addable: AddableKind[];
  onAdded: () => void;
}) {
  const kindLabel = useId();
  const typeLabel = useId();
  const [open, setOpen] = useState(false);
  const [kindId, setKindId] = useState<number | ''>('');
  const [type, setType] = useState('');
  const [note, setNote] = useState('');
  const reset = () => { setOpen(false); setKindId(''); setType(''); setNote(''); };
  const add = useMutation({
    mutationFn: () => addToKind(experienceId, {
      kindId: kindId as number, type: type || undefined, note: note.trim() || undefined,
    }),
    onSuccess: () => { reset(); onAdded(); },
  });

  const kind = addable.find(candidate => candidate.kindId === kindId);
  const typeOptions = typeOptionsFor(kind?.kindId);
  // A kind with a vocabulary is filed under one of its types, as a run files every place it brings.
  const ready = kind !== undefined && (typeOptions.length === 0 || type !== '');

  if (!open) {
    return (
      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.5, py: 1.25 }}>
        <Button size="small" variant="outlined" sx={{ borderStyle: 'dashed' }} onClick={() => setOpen(true)}>
          + Add to a kind…
        </Button>
        <Typography variant="caption" color="text.secondary">for a place the runs cannot find</Typography>
      </Stack>
    );
  }

  return (
    <Box sx={{ p: 1.5, bgcolor: (theme) => alpha(theme.palette.primary.main, 0.05) }}>
      <Stack spacing={1.5}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>Add to a kind</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <FormControl fullWidth size="small">
            <InputLabel id={kindLabel}>Kind</InputLabel>
            <Select
              labelId={kindLabel}
              value={kindId}
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
        {kind && (
          <Typography variant="body2">
            Readers find it in {kind.kindName} from now on: on its lists, the map and the counts. Later runs keep it
            there, even though they do not find it themselves. It can be taken out again here.
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
          <Button size="small" variant="contained" disabled={!ready || add.isPending} onClick={() => add.mutate()}>
            {kind ? `Add to ${kind.kindName}` : 'Add'}
          </Button>
          <Button size="small" disabled={add.isPending} onClick={reset}>Cancel</Button>
        </Stack>
        {add.error && <Alert severity="error" sx={{ py: 0 }}>{(add.error as Error).message}</Alert>}
      </Stack>
    </Box>
  );
}
