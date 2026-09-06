/**
 * The rows behind a count, and the truth about how many of them there are.
 *
 * A count alone is what #524 is about — "12 new works waiting, counted rather than
 * listed" asks a curator to decide about twelve things they cannot see. A list
 * alone would be worse on the other end: the catalogue's largest serial nomination
 * holds 758 points, and a card is not a place to read 758 of anything.
 *
 * So the server caps the list and keeps the count whole, and this says which is
 * which. A cap that went unsaid would read as "these are all of them", which is
 * exactly the silent truncation that makes a queue untrustworthy.
 *
 * Its own file rather than a function of `WaitingToPublish.tsx` since a row learned
 * to open: that file had reached the length the development guide splits at, and a
 * row that opens a place is a responsibility of its own. A work opens at its item
 * and its article, elsewhere; a point opens here, in the one dialog a place is
 * looked at in — and corrected, since a curator reading "49.0442, 3.9550" under
 * "9 new points waiting" cannot tell a pin on the wrong hill from the numbers.
 *
 * In `shared/` because the object's own screen lists its places the same way
 * (`CurationPlaces`): rows behind a count, capped and saying so, each opening the
 * place. Two lists of places that read differently would be two claims about what
 * a place is.
 */

import { Box, Link, Stack, Typography } from '@mui/material';

export interface ContentsRow {
  id: number;
  primary: string;
  secondary: string | null;
  /** Where the name opens, when the row has a page of its own. */
  href?: string | null;
  /** The row's article, when one can be resolved for it. */
  article?: string | null;
  /** Opens the row here — the dialog it is looked at and corrected in. */
  onOpen?: () => void;
  /**
   * What that door is called where the row already has an outbound one.
   *
   * A work's name opens the item it was imported from (#806) and must go on
   * doing so, so its way in cannot be the name: it is a trailing action beside
   * the article, named for what it does. A place has no outbound link and keeps
   * the name as its door.
   */
  openLabel?: string;
}

/** The name, as a link out, a button in, or plain text — whichever the row has. */
function Primary({ row }: { row: ContentsRow }) {
  if (row.href) {
    // `rel` on every outbound link, as `ObjectContext` does: these open somebody
    // else's site, in a new tab, because losing the queue to read about one painting
    // would cost the curator their place in it.
    return <Link href={row.href} target="_blank" rel="noopener noreferrer" color="inherit">{row.primary}</Link>;
  }
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
            {item.article && (
              <span>
                {' · '}
                {/* Named for the row: this list holds up to 25 of these, and a
                    screen reader's link list of 25 bare "Wikipedia"s says nothing
                    about which work each opens. The visible text leads the name, so
                    a voice-control user saying it still reaches the link. */}
                <Link
                  href={item.article}
                  target="_blank"
                  rel="noopener noreferrer"
                  color="inherit"
                  aria-label={`Wikipedia article for ${item.primary}`}
                >
                  Wikipedia
                </Link>
              </span>
            )}
            {/* The way in, where the name is already a way out. Named for the row
                for the reason the article link above gives: a list of 25 bare
                "Correct"s tells a screen reader nothing about which work. */}
            {item.href && item.onOpen && (
              <span>
                {' · '}
                <Link
                  component="button"
                  type="button"
                  variant="caption"
                  color="inherit"
                  onClick={item.onOpen}
                  aria-label={`${item.openLabel ?? 'Open'} ${item.primary}`}
                  sx={{ verticalAlign: 'baseline' }}
                >
                  {item.openLabel ?? 'Open'}
                </Link>
              </span>
            )}
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
