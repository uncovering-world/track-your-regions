/**
 * Putting a place into a kind no run offers it in, at the foot of its Kinds
 * section (#2035).
 *
 * A run finds a place only through its kind's rule: Haus Schwarzenberg in
 * Berlin is a courtyard of street art filed under no English Wikipedia
 * category and no genre, so no run of Public art finds it. Closed, this is one
 * row that says what it is for; open, the kind, its type from the kind's own
 * vocabulary, and what the add does for readers and for later runs. The add
 * itself is picking why from an addition's reasons (#863), the curator's words
 * under "Other…", and it sends the region the curator has open. The list
 * holds only the kinds the place is not in yet, and never World Heritage Sites
 * — the server's `addable`.
 */

import { useId, useState } from 'react';
import {
  Alert, Box, Button, FormControl, InputLabel, MenuItem, Select, Stack, Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useMutation } from '@tanstack/react-query';
import { ADDITION_REASON_CODES } from '@tyr/shared/curationLog';
import { addToKind, type AddableKind } from '../../api/curation';
import { typeOptionsFor } from '../../utils/experienceTypes';
import { ReasonMenu } from './ReasonMenu';

type AdditionReason = (typeof ADDITION_REASON_CODES)[number];

export function PlaceKindAdd({ experienceId, addable, regionId, onAdded }: {
  experienceId: number;
  addable: AddableKind[];
  /** The region the curator has open, which the add's log entry names; null where none is. */
  regionId: number | null;
  onAdded: () => void;
}) {
  const kindLabel = useId();
  const typeLabel = useId();
  const [open, setOpen] = useState(false);
  const [kindId, setKindId] = useState<number | ''>('');
  const [type, setType] = useState('');
  const reset = () => { setOpen(false); setKindId(''); setType(''); };
  const add = useMutation({
    mutationFn: ({ reasonCode, note }: { reasonCode: AdditionReason; note?: string }) => addToKind(experienceId, {
      kindId: kindId as number, type: type || undefined, reasonCode, note, regionId: regionId ?? undefined,
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
        <Stack direction="row" spacing={1}>
          <ReasonMenu
            label={kind ? `Add to ${kind.kindName}` : 'Add'}
            reasons={ADDITION_REASON_CODES}
            size="small"
            variant="contained"
            color="primary"
            disabled={!ready || add.isPending}
            onChoose={(reasonCode, note) => add.mutate({ reasonCode, note })}
          />
          <Button size="small" disabled={add.isPending} onClick={reset}>Cancel</Button>
        </Stack>
        {add.error && <Alert severity="error" sx={{ py: 0 }}>{(add.error as Error).message}</Alert>}
      </Stack>
    </Box>
  );
}
