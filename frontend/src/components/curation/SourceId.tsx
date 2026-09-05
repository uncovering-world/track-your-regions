/**
 * The id the source knows this object by, made into something a curator can use.
 *
 * It was `(Q637248)` in grey — not a link, not selectable as a unit, never explained. A
 * curator's honest reaction is "what am I supposed to do with that". The first answer was
 * *copy it*: reporting a bad rule, filing an issue about one row, asking someone else to
 * look — all of them need the identifier, and typing `Q637248` off a screen is how it
 * gets typed wrong.
 *
 * The second answer is *open it*, and it is the one a curator reaches for far more
 * often: the id names a page — a Wikidata item, a World Heritage portal entry — and
 * the next move on almost every card is to read what the source actually says there.
 * The argument that the id "carried no information the card did not already have"
 * held for the portal page, linked below as the source page, and not for the
 * Wikidata item, which no link on the card opened (#806). So the id is a link where
 * a page names it, with the copy beside it as an icon: two affordances, one chip.
 */

import { useState } from 'react';
import { IconButton, Link, Stack, Tooltip, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { safeHref } from '../../utils/safeHref';
import { wikidataItemUrl } from '../../utils/wikidataLinks';

/**
 * The page that names this id, or nothing.
 *
 * A Wikidata id names its item, whatever else the row stores — the Louvre's
 * `metadata.website` is the museum's own site, which says nothing about how
 * Wikidata knows it. Any other id opens the stored source page only when that
 * page's address carries the id as a path segment: every World Heritage row's
 * `website` is `whc.unesco.org/en/list/<id>`, which is the Centre's page *about*
 * that id, while a page that merely belongs to the object is not a page about the
 * id and would send a curator to a homepage under a number. A segment and not a
 * substring, so the page of site 7380 is not offered as the page of 738.
 */
export function sourceIdHref(id: string, sourcePage: string | null | undefined): string | null {
  const item = wikidataItemUrl(id);
  if (item) return item;
  const page = safeHref(sourcePage);
  if (!page) return null;
  return new URL(page).pathname.split('/').includes(id) ? page : null;
}

export function SourceId({ id, category, sourcePage }: {
  id: string;
  category: string;
  /** The row's stored source page (`metadata.website`), for an id that page names. */
  sourcePage?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const href = sourceIdHref(id, sourcePage);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused — an insecure origin, a denied permission. The id
      // stays selectable by hand, so the failure costs the shortcut and not the number.
      setCopied(false);
    }
  };

  if (!href) {
    // Nothing names this id — a curator-created row's own, say — so the chip is what it
    // was: the id, and one click copies it.
    return (
      <Tooltip
        title={copied
          ? 'Copied'
          : `How ${category} knows this object. Click to copy — quote it when reporting a row.`}
        describeChild
      >
        <Typography
          component="button"
          type="button"
          variant="caption"
          color="text.secondary"
          onClick={copy}
          sx={{
            border: 0,
            background: 'none',
            p: 0,
            cursor: 'pointer',
            font: 'inherit',
            fontSize: '0.75rem',
            textDecoration: 'underline dotted',
          }}
        >
          {id}
        </Typography>
      </Tooltip>
    );
  }

  const site = wikidataItemUrl(id) ? 'Wikidata' : new URL(href).hostname;
  // `describeChild` on both: without it MUI writes the tooltip into the child's
  // `aria-label`, so the link would be announced as a sentence about the category
  // rather than as the id it shows, and the copy button's own name would be lost.
  return (
    <Stack direction="row" alignItems="center" spacing={0.25}>
      <Tooltip title={`How ${category} knows this object. Opens it at ${site}.`} describeChild>
        {/* `rel` on every outbound link, as `ObjectContext` does: this opens somebody
            else's site, and `noopener` is what keeps that page from reaching back. */}
        <Link
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          variant="caption"
          color="text.secondary"
          sx={{ textDecoration: 'underline dotted', '&:hover': { textDecoration: 'underline' } }}
        >
          {id}
        </Link>
      </Tooltip>
      <Tooltip title={copied ? 'Copied' : 'Copy the id — quote it when reporting a row.'} describeChild>
        <IconButton size="small" aria-label={`Copy ${id}`} onClick={copy} sx={{ p: 0.25 }}>
          <ContentCopyIcon sx={{ fontSize: 12 }} />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}
