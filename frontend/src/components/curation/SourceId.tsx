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

import { Link, Stack, Tooltip, Typography } from '@mui/material';
import { CopyButton } from '../shared/CopyButton';
import { safeHref } from '../../utils/safeHref';
import { wikidataItemUrl } from '../../utils/wikidataLinks';

/**
 * The page that names this id, or nothing.
 *
 * A Wikidata id names its item, whatever else the row stores — the Louvre's
 * `metadata.website` is the museum's own site, which says nothing about how
 * Wikidata knows it. Any other id opens the stored source page only when that
 * page's address carries the id as a path segment: every World Heritage row's
 * `unescoUrl` is `whc.unesco.org/en/list/<id>`, which is the Centre's page *about*
 * that id, while a page that merely belongs to the object is not a page about the
 * id and would send a curator to a homepage under a number. A segment and not a
 * substring, so the page of site 7380 is not offered as the page of 738. The
 * World Heritage page is `metadata.unescoUrl` since #1538, and the card hands
 * it in before the site's own website.
 */
export function sourceIdHref(id: string, sourcePage: string | null | undefined): string | null {
  const item = wikidataItemUrl(id);
  if (item) return item;
  const page = safeHref(sourcePage);
  if (!page) return null;
  return new URL(page).pathname.split('/').includes(id) ? page : null;
}

/**
 * The World Heritage list's table of a property's parts (#2183): reference,
 * name, country, coordinates and area of each component and its buffer zone,
 * at `whc.unesco.org/en/list/<id>/maps/`. The property's own page names no
 * component (Western Tien-Shan's names "Mount Chatkal" alone), so a question
 * about a component — a lost place, a candidate item, a point placed roughly —
 * is decided off this table. Built here and nowhere else, and only from a
 * World Heritage number: the property's ("1209"), a component's reference
 * ("1209-002", or "829ter-001" — an inscription extended or revised carries
 * a suffix on the number, and its table is under the number alone), or the
 * property's page on the list ("https://whc.unesco.org/en/list/1209"), the
 * one a row whose own id is a Wikidata item still carries. A Wikidata id, a
 * curator's own id or any other page answers null.
 */
export function worldHeritagePartsHref(idOrPage: string | null | undefined): string | null {
  if (!idOrPage) return null;
  const property = /^(\d+)[a-z]*(?:-\d+)?$/i.exec(idOrPage)?.[1]
    ?? /^https?:\/\/whc\.unesco\.org\/en\/list\/(\d+)(?:[a-z]*)(?:\/|$)/i.exec(idOrPage)?.[1];
  return property ? `https://whc.unesco.org/en/list/${property}/maps/` : null;
}

export function SourceId({ id, kind, sourcePage }: {
  id: string;
  kind: string;
  /** The row's stored source page (`metadata.unescoUrl`, else `metadata.website`), for an id that page names. */
  sourcePage?: string | null;
}) {
  // Through safeHref although sourceIdHref answers only an https literal or a page
  // safeHref already kept: the rule is declared once, and `urlSafety.test.ts` reads
  // every href in a module that carries a stored link as going through it.
  const href = safeHref(sourceIdHref(id, sourcePage));
  const copy = (
    <CopyButton text={id} label={`Copy ${id}`} tooltip="Copy the id — quote it when reporting a row." compact />
  );

  if (!href) {
    // Nothing names this id — a curator-created row's own, say — so the chip is the
    // id, selectable as text, and the copy beside it.
    return (
      <Stack direction="row" alignItems="center" spacing={0.25}>
        <Tooltip title={`How ${kind} knows this object — quote it when reporting a row.`} describeChild>
          <Typography variant="caption" color="text.secondary" sx={{ textDecoration: 'underline dotted' }}>
            {id}
          </Typography>
        </Tooltip>
        {copy}
      </Stack>
    );
  }

  const site = wikidataItemUrl(id) ? 'Wikidata' : new URL(href).hostname;
  // `describeChild` on both: without it MUI writes the tooltip into the child's
  // `aria-label`, so the link would be announced as a sentence about the kind
  // rather than as the id it shows, and the copy button's own name would be lost.
  return (
    <Stack direction="row" alignItems="center" spacing={0.25}>
      <Tooltip title={`How ${kind} knows this object. Opens it at ${site}.`} describeChild>
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
      {copy}
    </Stack>
  );
}
