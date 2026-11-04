/**
 * Who took the picture on screen, said as the surface it sits on allows (ADR-0182).
 *
 * The catalogue shows Wikimedia Commons photographs, and most of them are CC BY
 * or CC BY-SA, which ask one thing of a page that merely shows a picture: that
 * the author is credited. CC BY 4.0 § 3(a)(2) lets that be done "in any
 * reasonable manner based on the medium, means, and context", a link to a page
 * that holds the credit included; public domain and CC0 ask nothing. So the
 * credit is as large as the surface gives room for, and no larger:
 *
 * - `badge` — a dense row or tile (a review card's list, the crowded-city
 *   window, a works grid): a small © on the thumbnail that opens the full credit
 *   and the file page. The caller's frame around the picture is `position:
 *   relative`, since the badge sits in its corner.
 * - `line` — a card (the place card, the hover cards): one line, "© Author ·
 *   Licence", cut with an ellipsis, whole on hover and focus, the author linked
 *   to the file page.
 * - `full` — a full-size view (an enlargement, the preview over the map): the
 *   whole credit, wrapping.
 *
 * A picture whose licence asks for no credit shows none on any surface
 * (`needsCredit`). And a credit is drawn only beside the picture that is on
 * screen: every caller hangs it on its picture having arrived.
 */

import { useState, type ReactNode } from 'react';
import { Box, ButtonBase, Link, Popover, Tooltip, Typography, type TypographyProps } from '@mui/material';
import type { ImageCredit } from '../../api/experiences';
// The server already stores nothing but `http`/`https` here, and `safeHref`
// checks again: these values come from a wiki field anybody may edit, they
// reached the database through one import and could reach it through another,
// and the cost of asking twice is a `try`. A URL that fails becomes plain text
// — the credit still names whom it must, without offering a link.
import { safeHref } from '../../utils/safeHref';

/** Where a credit is drawn: on a dense row's thumbnail, as a card's line, or under a full-size view. */
export type CreditSurface = 'badge' | 'line' | 'full';

/**
 * The licences that ask for nothing in return, for a credit stored before the
 * run read Commons' own answer (`attributionRequired`).
 *
 * Written as the short names Commons answers with, because that is what is
 * stored: `LicenseShortName` is a display string, not a code. The list is
 * deliberately short and the default is the other way — an unrecognised licence
 * counts as one that asks for a name, since over-crediting costs a line and
 * under-crediting breaks the one term CC BY and CC BY-SA impose.
 */
const NO_ATTRIBUTION_REQUIRED = /^(public domain|pdm|pd-|cc0)/i;

/**
 * Whether a credit is owed for this picture at all.
 *
 * Commons says so per file (`AttributionRequired`, read by the run): false for
 * public domain and CC0. Where the stored credit predates that reading, the
 * licence's name decides. A credit naming nobody and no licence says nothing,
 * and an empty line under a picture would read as "nobody took this".
 */
export function needsCredit(credit: ImageCredit | null | undefined): credit is ImageCredit {
  if (!credit || (!credit.author && !credit.license)) return false;
  if (typeof credit.attributionRequired === 'boolean') return credit.attributionRequired;
  return !credit.license || !NO_ATTRIBUTION_REQUIRED.test(credit.license.trim());
}

/**
 * The credit as words — `author · licence` — for a place that renders text rather
 * than a component.
 *
 * The sentence the curation history prints for an edit that took a picture
 * away (#801), the one screen a removed photographer's name survives, so it is
 * said whatever the licence: it records a value, it does not credit a picture.
 * `null` where nobody is named, rather than an empty string, so a caller says
 * "(empty)" or nothing in its own words.
 */
export function creditSentence(credit?: ImageCredit | null): string | null {
  if (!credit || (!credit.author && !credit.license)) return null;
  return [credit.author, credit.license].filter(Boolean).join(' · ');
}

/** The credit as the line reads it, for its hover and the badge's name: "© Author · Licence". */
function creditWords(credit: ImageCredit): string {
  const author = credit.author ?? (safeHref(credit.detailsUrl) ? AUTHOR_ON_FILE_PAGE : null);
  return [author && `© ${author}`, credit.license].filter(Boolean).join(' · ');
}

/** What the line says where the file page names the author and the credit read none. */
const AUTHOR_ON_FILE_PAGE = 'Author on the file page';

/**
 * A stored URL as a link, or its words alone where `safeHref` refuses it.
 * `nofollow` and `noopener`, because Commons hands us the URL from the file's
 * own metadata, and a link the catalogue did not choose is not one it vouches for.
 */
function OutsideLink({ url, children }: { url: string | null | undefined; children: ReactNode }) {
  const href = safeHref(url);
  if (!href) return <>{children}</>;
  return (
    <Link href={href} target="_blank" rel="noopener noreferrer nofollow" color="inherit" underline="hover"
      onClick={(event) => event.stopPropagation()}>
      {children}
    </Link>
  );
}

/**
 * "© Author · Licence": the author linked to the file page, the licence to its
 * terms. Where the credit read no author but the file page states one, the line
 * points there in its place — the link is the credit CC 4.0 accepts.
 */
function CreditWords({ credit }: { credit: ImageCredit }) {
  const authorText = credit.author ?? (safeHref(credit.detailsUrl) ? AUTHOR_ON_FILE_PAGE : null);
  return (
    <>
      {authorText && <>© <OutsideLink url={credit.detailsUrl}>{authorText}</OutsideLink></>}
      {authorText && credit.license ? ' · ' : null}
      {credit.license && <OutsideLink url={credit.licenseUrl}>{credit.license}</OutsideLink>}
    </>
  );
}

/**
 * The © on a dense row's thumbnail, and the full credit it opens.
 *
 * A button rather than a hover: a touch screen has no hover, and a keyboard
 * reaches a button. The popover holds the credit with its links and the file
 * page, and Escape or a click outside closes it. Its clicks stop at the badge,
 * because the rows it sits on answer a click of their own (a crowded-city row
 * brings its dot into view, a tile marks a work seen).
 */
function CreditBadge({ credit }: { credit: ImageCredit }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <ButtonBase
        aria-label={`Picture credit: ${creditWords(credit)}`}
        aria-haspopup="dialog"
        aria-expanded={anchor ? 'true' : 'false'}
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(event.currentTarget);
        }}
        sx={{
          position: 'absolute', right: 2, bottom: 2, zIndex: 1, width: 16, height: 16, borderRadius: '50%',
          fontSize: 11, lineHeight: 1, color: 'common.white', bgcolor: 'rgba(0, 0, 0, 0.55)',
          '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.75)' },
        }}
      >
        ©
      </ButtonBase>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        onClick={(event) => event.stopPropagation()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 1, maxWidth: 280 } } }}
      >
        <Typography variant="caption" component="div" sx={{ wordBreak: 'break-word' }}>
          <CreditWords credit={credit} />
        </Typography>
        {safeHref(credit.detailsUrl) && (
          <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
            <OutsideLink url={credit.detailsUrl}>The file on Wikimedia Commons</OutsideLink>
          </Typography>
        )}
      </Popover>
    </>
  );
}

interface ImageCreditLineProps {
  credit?: ImageCredit | null;
  /** The surface the picture sits on; see the file's header. */
  surface: CreditSurface;
  /**
   * What to paint the line, for a surface that is not the page's own background.
   *
   * The default is the theme's quietest text, which is unreadable on a dark
   * surface; such a caller passes `inherit`, and every part of the line — its
   * links included — follows the surface's own colour.
   */
  color?: TypographyProps['color'];
}

export function ImageCreditLine({ credit, surface, color = 'text.secondary' }: ImageCreditLineProps) {
  if (!needsCredit(credit)) return null;
  if (surface === 'badge') return <CreditBadge credit={credit} />;
  const words = <CreditWords credit={credit} />;
  if (surface === 'full') {
    return (
      <Typography variant="caption" component={Box} color={color}
        sx={{ display: 'block', mt: 0.5, lineHeight: 1.3, wordBreak: 'break-word' }}>
        {words}
      </Typography>
    );
  }
  // A line with no link inside takes the focus itself, so a keyboard still
  // reaches the whole text the ellipsis cut.
  const linked = !!safeHref(credit.detailsUrl) || (!!credit.license && !!safeHref(credit.licenseUrl));
  return (
    <Tooltip title={creditWords(credit)} describeChild>
      <Typography variant="caption" component={Box} color={color} tabIndex={linked ? undefined : 0}
        sx={{ display: 'block', mt: 0.5, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {words}
      </Typography>
    </Tooltip>
  );
}
