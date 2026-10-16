/**
 * A place's pages, in words: "Wikipedia", "Official website", "UNESCO page" (#1190).
 *
 * Map mode's card drew them as a bare book and a bare globe, which a visitor
 * could open but not read without hovering, and Discover's panel spelled the
 * same three in words. One component now draws them for both. They stay links,
 * so the browser's own *Copy link address* copies them; no copy button is
 * needed for a link.
 *
 * Every address passes `safeHref` where it meets the DOM: a sync writes these
 * keys through no request schema, so the write-path rule does not hold every
 * stored row, and a refused value offers no link at all. The site's own page is
 * left out where it is the Wikipedia article or the UNESCO page again.
 */

import { Button } from '@mui/material';
import WikiIcon from '@mui/icons-material/MenuBook';
import WebsiteIcon from '@mui/icons-material/Language';
import HeritagePageIcon from '@mui/icons-material/AccountBalance';
import { safeHref } from '../../utils/safeHref';

function storedHref(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key];
  return safeHref(typeof value === 'string' ? value : null);
}

/** One of the place's pages in words, or nothing where the address was refused. */
function PlaceLink({ stored, icon, words }: { stored: string | null; icon: React.ReactNode; words: string }) {
  // Through safeHref again although `storedHref` already kept it: `urlSafety.test.ts`
  // reads every href in a module that names a stored link as going through it.
  const href = safeHref(stored);
  if (!href) return null;
  return (
    // `rel` on every outbound link: this opens somebody else's site, and
    // `noopener` is what keeps that page from reaching back.
    <Button variant="text" size="small" startIcon={icon} component="a" href={href}
      target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
      {words}
    </Button>
  );
}

export function PlaceLinks({ metadata }: { metadata: Record<string, unknown> | null | undefined }) {
  const wikiUrl = storedHref(metadata, 'wikipediaUrl');
  const websiteUrl = storedHref(metadata, 'website');
  // UNESCO's page about a World Heritage site, beside the site's own (#1538).
  const unescoUrl = storedHref(metadata, 'unescoUrl');
  return (
    <>
      <PlaceLink stored={wikiUrl} icon={<WikiIcon />} words="Wikipedia" />
      <PlaceLink stored={websiteUrl !== wikiUrl && websiteUrl !== unescoUrl ? websiteUrl : null}
        icon={<WebsiteIcon />} words="Official website" />
      <PlaceLink stored={unescoUrl} icon={<HeritagePageIcon />} words="UNESCO page" />
    </>
  );
}
