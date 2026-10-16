/**
 * Sends someone the place a card shows (#1192).
 *
 * An open card has an address — `/wv/5/r/6782-vlaanderen/e/850-historic-centre-of-brugge`
 * opens Vlaanderen with that card expanded — and nothing on the card said so; on
 * a phone the address bar is often hidden. Where the browser has a system share
 * sheet (`navigator.share`: phones, Safari, Chromium on Windows) the button hands
 * it the address and the place's name; elsewhere it copies the address and says
 * "Link copied".
 *
 * A share the visitor cancels says nothing. One that fails for another reason does
 * not copy in its place — the sheet has already spent the click's user activation,
 * which Safari's clipboard asks for — so it says "Could not share" and offers
 * *Copy link*, a fresh click. Every answer is said in a polite live region too.
 */

import { useEffect, useRef, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import ShareIcon from '@mui/icons-material/Share';
import { SPOKEN_ONLY, writeToClipboard } from './CopyButton';

const SAID_MS = 2000;
export const LINK_COPIED_TEXT = 'Link copied';
export const COULD_NOT_SHARE_TEXT = 'Could not share';
export const COULD_NOT_COPY_LINK_TEXT = 'Could not copy the link';

type Outcome = 'copied' | 'share-failed' | 'copy-failed' | null;

export function ShareButton({ url, title }: {
  /** The address to send, absolute. */
  url: string;
  /** The place's name, the shared item's title. */
  title: string;
}) {
  const [outcome, setOutcome] = useState<Outcome>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const say = (next: Outcome, fades: boolean) => {
    setOutcome(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = fades ? setTimeout(() => setOutcome(null), SAID_MS) : null;
  };
  const copy = async () => {
    say(await writeToClipboard(url) ? 'copied' : 'copy-failed', true);
  };

  const share = async (event: React.MouseEvent) => {
    // The row under the card opens and closes it; sharing does neither.
    event.stopPropagation();
    if (typeof navigator.share !== 'function') {
      await copy();
      return;
    }
    try {
      await navigator.share({ title, url });
      say(null, false);
    } catch (error) {
      // A cancel is the visitor's own answer: it says nothing, and clears what was said before.
      say(error instanceof DOMException && error.name === 'AbortError' ? null : 'share-failed', false);
    }
  };

  let said: string | null = null;
  if (outcome === 'copied') said = LINK_COPIED_TEXT;
  else if (outcome === 'share-failed') said = COULD_NOT_SHARE_TEXT;
  else if (outcome === 'copy-failed') said = COULD_NOT_COPY_LINK_TEXT;

  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      <Button variant="outlined" size="small" startIcon={<ShareIcon />} onClick={share}>
        Share
      </Button>
      {said && (
        <Typography variant="caption" color={outcome === 'copied' ? 'text.secondary' : 'error'} aria-hidden>
          {said}
        </Typography>
      )}
      {outcome === 'share-failed' && (
        <Button size="small" onClick={(event) => { event.stopPropagation(); copy(); }}>
          Copy link
        </Button>
      )}
      <Box component="span" role="status" sx={SPOKEN_ONLY}>{said}</Box>
    </Stack>
  );
}
