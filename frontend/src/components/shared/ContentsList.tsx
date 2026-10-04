/**
 * The rows behind a count, and the truth about how many of them there are.
 *
 * A count alone asks a curator to decide about things they cannot see; a list
 * alone would be worse on the other end: the catalogue's largest serial
 * nomination holds 758 points, and a screen is not a place to read 758 of
 * anything. So the list is capped and the count kept whole, and this says which
 * is which. A cap that went unsaid would read as "these are all of them".
 *
 * A row opens in the one dialog a place is looked at in — and corrected, since a
 * curator reading "49.0442, 3.9550" cannot tell a pin on the wrong hill from the
 * numbers. The object's own screen lists its places this way (`CurationPlaces`).
 */

import { Box, Link, Stack, Typography } from '@mui/material';

export interface ContentsRow {
  id: number;
  primary: string;
  secondary: string | null;
  /** Opens the row here — the dialog it is looked at and corrected in. */
  onOpen?: () => void;
}

/** The name, as a button in or as plain text — whichever the row has. */
function Primary({ row }: { row: ContentsRow }) {
  if (row.onOpen) {
    // A button, not a clickable span: it is the only way to the place, and a span
    // with an `onClick` cannot be reached from a keyboard at all.
    return (
      <Link component="button" type="button" variant="caption" color="inherit" onClick={row.onOpen} sx={{ verticalAlign: 'baseline' }}>
        {row.primary}
      </Link>
    );
  }
  return <>{row.primary}</>;
}

export function ContentsList({ items, total, shown, noun }: {
  items: ContentsRow[];
  total: number;
  shown: number;
  noun: string;
}) {
  if (items.length === 0) return null;
  return (
    <Box sx={{ mt: 0.5 }}>
      <Stack component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }} spacing={0.25}>
        {items.map(item => (
          <Typography key={item.id} component="li" variant="caption" color="text.secondary">
            <Primary row={item} />
            {item.secondary && <span> — {item.secondary}</span>}
          </Typography>
        ))}
      </Stack>
      {shown < total && (
        <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
          {`showing ${shown} of ${total} ${noun}s`}
        </Typography>
      )}
    </Box>
  );
}
