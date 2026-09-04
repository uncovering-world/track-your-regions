/**
 * Who took the picture above this line.
 *
 * The catalogue shows photographs it does not host — UNESCO's and Wikimedia
 * Commons', on the objects and on the works inside them — and a share of the
 * Commons ones are CC BY or CC BY-SA, which of a page that merely shows a picture
 * ask one thing: that the author is named wherever the work appears (ShareAlike
 * binds adaptations, which showing a photograph is not). Until this component existed the
 * catalogue named nobody, which is not a styling gap: it is the one term those
 * licences ask for.
 *
 * Deliberately quiet. A credit is an obligation to the photographer, not a
 * caption for the reader, so it sits under the image in the smallest type the
 * theme has and never competes with the object's own name.
 */

import { Box, Link, Typography, type TypographyProps } from '@mui/material';
import type { ImageCredit } from '../../api/experiences';
// The server already stores nothing but `http`/`https` here, and `safeHref`
// checks again: these values come from a wiki field anybody may edit, they
// reached the database through one import and could reach it through another,
// and the cost of asking twice is a `try`. A URL that fails becomes plain text
// — the credit still names whom it must, without offering a link.
import { safeHref } from '../../utils/safeHref';

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

/**
 * The licences that ask for nothing in return.
 *
 * Written as the short names Commons answers with, because that is what is
 * stored: `LicenseShortName` is a display string, not a code. The list is
 * deliberately short and the default is the other way — an unrecognised licence
 * counts as one that asks for a name, since over-crediting costs a line and
 * under-crediting breaks the one term CC BY and CC BY-SA impose.
 */
const NO_ATTRIBUTION_REQUIRED = /^(public domain|pdm|pd-|cc0)/i;

/**
 * Whether this credit tells a dense row something its own text does not.
 *
 * Most of the Commons files behind the artworks are public-domain reproductions
 * of paintings, and for one of those Commons names the *painter* as the file's
 * author — so the credit under *The Night Watch* would read "Rembrandt · Public
 * domain" beside a line that already says "Rembrandt · 1642 · painting". A row
 * repeating itself teaches a reader to stop reading the line, which is the last
 * thing an attribution should do.
 *
 * So on the dense surfaces the line appears where it carries something: a
 * licence that asks to be honoured — the minority that are CC BY or CC BY-SA —
 * or a photographer who is not the artist already named. The large views take no
 * `redundantWith` and always show it: there the picture is the subject, and
 * there is room.
 *
 * A work names every one of its makers (#720), so the question is whether the
 * credit names somebody the row does not — **any** of them, not the first. The
 * Baptism of Christ is Leonardo and Verrocchio, and a photograph credited to
 * Verrocchio beside a row reading "Leonardo da Vinci and Andrea del Verrocchio"
 * repeats the row exactly as the single-name case did.
 */
export function creditAddsBeyond(
  credit: ImageCredit | null | undefined,
  artist: string | readonly string[] | null | undefined,
): boolean {
  if (!credit || (!credit.author && !credit.license)) return false;
  if (!credit.license || !NO_ATTRIBUTION_REQUIRED.test(credit.license.trim())) return true;
  // A free licence and no new name says nothing the row needs. Compared loosely,
  // because "Leonardo da Vinci" and "leonardo  da vinci" are one person.
  const same = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const named = (typeof artist === 'string' ? [artist] : artist ?? []).map(same);
  return !!credit.author && !named.includes(same(credit.author));
}

/**
 * The credit as words — `author · licence` — for a place that renders text rather
 * than a component.
 *
 * The one sentence the line below renders, so that a credit reads the same
 * wherever it is said: under the picture, in a tooltip, and in the history line
 * that records an edit taking the picture away (#801) — which used to print the
 * stored object through `String()` as `[object Object]`, on the one screen a
 * removed photographer's name survives. `null` where nobody is named, rather
 * than an empty string, so a caller says "(empty)" or nothing in its own words.
 */
export function creditSentence(credit?: ImageCredit | null): string | null {
  if (!credit || (!credit.author && !credit.license)) return null;
  return [credit.author, credit.license].filter(Boolean).join(' · ');
}

/**
 * The same credit as a fragment of plain text, for somewhere a component cannot go.
 *
 * One caller today: the tooltip on Discover's 100 px contents tile, which is
 * already a string and is the only place that picture's photographer can be
 * named — the tile itself is a square of image with the work's name across its
 * foot, and a second line there would be a name clipped mid-word. Carries its
 * own separator, and is empty where there is nobody to name, so a caller can
 * concatenate it unconditionally.
 */
export function creditLabel(credit?: ImageCredit | null): string {
  const sentence = creditSentence(credit);
  return sentence ? ` — image: ${sentence}` : '';
}

interface ImageCreditLineProps {
  credit?: ImageCredit | null;
  /**
   * The work's own makers, where the surface already names them.
   *
   * **Passing the prop at all** opts this line into the "only where it adds" rule
   * above — the dense lists do, the large views do not. Presence and not value:
   * `redundantWith={row.artists}` on a row whose makers are `undefined` is still
   * a dense row asking for the rule, and reading the value would have made it a
   * large view by accident, printing the repetition `creditAddsBeyond` exists to
   * remove.
   *
   * A list or one name: a work carries every maker the source names (#720), and
   * the object-level surfaces that pass this still have a single string.
   */
  redundantWith?: string | readonly string[] | null;
  /**
   * What to paint the line, for a surface that is not the page's own background.
   *
   * The default is the theme's quietest text, which is the whole point of this
   * component — and is unreadable on a dark one. `WorksPreview` renders its rows
   * inside a MUI `Tooltip`, whose default surface is `grey[700]` at 92% with
   * white text and which this theme does not override; `text.secondary` there is
   * near-black on near-black, so that caller passes `inherit` and every part of
   * the line — the author link and the licence link included, both already
   * `color="inherit"` — follows the tooltip's own colour.
   */
  color?: TypographyProps['color'];
}

export function ImageCreditLine(props: ImageCreditLineProps) {
  const { credit, color = 'text.secondary' } = props;
  // Nothing to say is said by saying nothing: an empty credit line under a
  // picture would read as "nobody took this".
  if (!credit || (!credit.author && !credit.license)) return null;
  // `in` and not `!== undefined`: the two differ exactly where a caller passes an
  // artist that happens to be undefined, and there the caller is a dense row that
  // asked for the rule. See the prop's own note.
  if ('redundantWith' in props && !creditAddsBeyond(credit, props.redundantWith)) return null;

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
      color={color}
      sx={{ display: 'block', mt: 0.5, lineHeight: 1.3, wordBreak: 'break-word' }}
    >
      {author}
      {author && credit.license ? ' · ' : null}
      <License credit={credit} />
    </Typography>
  );
}
