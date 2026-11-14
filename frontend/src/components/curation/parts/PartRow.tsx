/**
 * One row of the card's *Parts* or *Part of* section (#2118): the other place,
 * whose word makes it a part, and the curator's way to take it out or put it
 * back.
 *
 * Taking out asks first and says what it does: a place a source still names
 * (UNESCO's list, a Wikidata statement) is kept out, and no later run puts it
 * back; one only a curator named simply leaves. A kept-out row stays, greyed,
 * at the foot of the list with *Put it back*.
 */

import { useState } from 'react';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import type { PartRow as Row } from '../../../api/parts';
import { DenseThumbnail } from '../../shared/DenseThumbnail';
import { claimLines, keptOutLine, placeLine, sourceNames } from './partWords';

/** What a row outside the caller's scope says in place of its buttons. */
const ANSWERED_ELSEWHERE = 'Outside the regions you curate';

/** The row's ground: tinted while it asks, greyed once kept out. */
function rowGround(theme: Theme, asking: boolean, keptOut: boolean): string | undefined {
  if (asking) return alpha(theme.palette.error.main, 0.05);
  return keptOut ? theme.palette.action.hover : undefined;
}

export function PartRow({ row, wholeName, side, pending, onTakeOut, onPutBack }: {
  row: Row;
  /** The whole the row is in, as the take-out names it. */
  wholeName: string;
  /** `parts`: the row is a part of this place; `wholes`: a whole this place is a part of. */
  side: 'parts' | 'wholes';
  pending: boolean;
  onTakeOut: (note: string) => void;
  onPutBack: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const keptOut = !row.standing;
  const named = sourceNames(row);
  const source = row.list ? 'UNESCO’s list' : 'Wikidata';
  const from = side === 'parts' ? 'this whole' : wholeName;
  const leaving = named
    ? `It leaves ${from} and its visit count now. ${source} still names it, so later runs keep it out until it is put back here.`
    : `No source names it, so it simply leaves ${from}. Visits to it stay with the place.`;

  return (
    <Box
      sx={{
        p: 1.25, borderBottom: 1, borderColor: 'divider', '&:last-of-type': { borderBottom: 0 },
        bgcolor: (theme) => rowGround(theme, asking, keptOut),
      }}
    >
      <Stack direction="row" spacing={1.25} alignItems="flex-start">
        <DenseThumbnail imageUrl={row.place.image_url} title={row.place.name} credit={row.place.image_credit} reserve />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, color: keptOut ? 'text.secondary' : undefined }}>
            {row.place.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            {placeLine(row.place)}
            {row.place.waiting && <Box component="span" sx={{ color: 'warning.main' }}> · waiting for a curator</Box>}
          </Typography>
          {claimLines(row).map(line => (
            <Typography key={line} variant="caption" display="block" color={line.startsWith('Added') ? 'success.main' : 'text.secondary'}>
              {line}
            </Typography>
          ))}
          {keptOut && (
            <>
              <Typography variant="caption" display="block" color="warning.main">{keptOutLine(row)}</Typography>
              {named && (
                <Typography variant="caption" display="block" color="text.secondary">
                  {source} still names it. Later runs keep it out.
                </Typography>
              )}
            </>
          )}
          {!row.in_scope && (
            <Typography variant="caption" color="text.secondary" display="block">{ANSWERED_ELSEWHERE}</Typography>
          )}
          {row.curator?.note && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ fontStyle: 'italic' }}>
              “{row.curator.note}”
            </Typography>
          )}
        </Box>
        {keptOut && row.in_scope && (
          <Button size="small" variant="outlined" disabled={pending} onClick={onPutBack} sx={{ flexShrink: 0 }}>
            Put it back
          </Button>
        )}
        {!keptOut && !asking && row.in_scope && (
          <Button size="small" variant="outlined" color="error" onClick={() => setAsking(true)} sx={{ flexShrink: 0 }}>
            Take out…
          </Button>
        )}
      </Stack>

      {asking && (
        <Stack spacing={1.25} sx={{ mt: 1.25 }}>
          <Typography variant="body2">{leaving}</Typography>
          <TextField
            label="Why"
            helperText="Optional, kept in both places’ history"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            size="small"
            fullWidth
            inputProps={{ maxLength: 1000 }}
          />
          <Stack direction="row" spacing={1}>
            <Button
              size="small" variant="contained" color="error" disabled={pending}
              onClick={() => { onTakeOut(note.trim()); setAsking(false); setNote(''); }}
            >
              Take out of {from}
            </Button>
            <Button size="small" disabled={pending} onClick={() => { setAsking(false); setNote(''); }}>Cancel</Button>
          </Stack>
        </Stack>
      )}
    </Box>
  );
}

/** A refusal or a failure under the rows, in the backend's words. */
export function PartFailure({ error }: { error: unknown }) {
  if (!error) return null;
  return <Alert severity="error" sx={{ py: 0, mt: 1 }}>{(error as Error).message}</Alert>;
}
