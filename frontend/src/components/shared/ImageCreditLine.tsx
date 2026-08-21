/**
 * Who took the picture above this line.
 *
 * The catalogue shows ~1600 photographs it does not host — UNESCO's and Wikimedia
 * Commons' — and most of the Commons ones are CC BY or CC BY-SA, licences whose
 * single condition is that the author is named wherever the work appears. Until
 * this component existed the catalogue named nobody, which is not a styling gap:
 * it is the one term those licences ask for.
 *
 * Deliberately quiet. A credit is an obligation to the photographer, not a
 * caption for the reader, so it sits under the image in the smallest type the
 * theme has and never competes with the object's own name.
 */

import { Box, Link, Typography } from '@mui/material';
import type { ImageCredit } from '../../api/experiences';

/**
 * A URL only if a reader may safely be sent to it.
 *
 * The server already stores nothing but `http`/`https` here, and this checks
 * again: these values come from a wiki field anybody may edit, they reached the
 * database through one import and could reach it through another, and the cost
 * of asking twice is a `try`. A URL that fails becomes plain text — the credit
 * still names whom it must, without offering a link.
 */
function safeHref(value: string | null): string | null {
  if (!value) return null;
  try {
    // No base URL. With one, a *relative* value from somebody else's metadata
    // would resolve against our own origin and the credit would link back to
    // this site — a credit pointing at us credits nobody. An absolute URL with a
    // scheme is unaffected by a base either way, so dropping it costs nothing
    // and closes that case.
    const parsed = new URL(value);
    // `http` as well as `https`: these are licence URLs from wiki metadata, some
    // of them old, and a licence is a fact about the picture rather than a link
    // the catalogue vouches for. The schemes that execute are what matter here,
    // and neither of these is one.
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * The licence, linked to its own terms where the source gave a URL.
 *
 * `rel="noopener"` and `nofollow` because the URL comes from an outside source:
 * Commons hands us the licence URL from the file's own metadata, and a link the
 * catalogue did not choose is not a link the catalogue vouches for.
 */
function License({ credit }: { credit: ImageCredit }) {
  if (!credit.license) return null;
  const href = safeHref(credit.licenseUrl);
  return href
    ? (
      <Link
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        color="inherit"
        underline="hover"
      >
        {credit.license}
      </Link>
    )
    : <>{credit.license}</>;
}

export function ImageCreditLine({ credit }: { credit?: ImageCredit | null }) {
  // Nothing to say is said by saying nothing: an empty credit line under a
  // picture would read as "nobody took this".
  if (!credit || (!credit.author && !credit.license)) return null;

  const detailsHref = safeHref(credit.detailsUrl);
  const author = credit.author && (detailsHref
    ? (
      <Link
        href={detailsHref}
        target="_blank"
        rel="noopener noreferrer nofollow"
        color="inherit"
        underline="hover"
      >
        {credit.author}
      </Link>
    )
    : credit.author);

  return (
    <Typography
      variant="caption"
      component={Box}
      color="text.secondary"
      sx={{ display: 'block', mt: 0.5, lineHeight: 1.3, wordBreak: 'break-word' }}
    >
      {author}
      {author && credit.license ? ' · ' : null}
      <License credit={credit} />
    </Typography>
  );
}
