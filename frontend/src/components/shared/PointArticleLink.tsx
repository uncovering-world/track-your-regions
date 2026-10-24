/**
 * A part's own Wikipedia article, as a word on its row (#1963).
 *
 * A part of a serial site resolved to its own Wikidata item carries that item's
 * English article, which a run stores on the part (`wikipedia_url`); a work's
 * row links its article the same way (`ArtworksList.tsx`). Nothing is drawn
 * where the part has none, so no row offers a link that leads nowhere. The word
 * stays on screen and the link is named for the part (WCAG 2.5.3): a site's
 * list holds dozens of parts, and a links list of "Wikipedia" alone names none.
 * The address passes `safeHref` where it meets the DOM, and a click on it opens
 * the article without opening the part's card the row opens.
 */

import { Link } from '@mui/material';
import { safeHref } from '../../utils/safeHref';

export function PointArticleLink({ href, name }: { href: string | null | undefined; name: string }) {
  const article = safeHref(href ?? null);
  if (!article) return null;
  return (
    <Link
      href={article}
      target="_blank"
      rel="noopener noreferrer"
      variant="caption"
      aria-label={`${name} on Wikipedia`}
      onClick={(event) => event.stopPropagation()}
      sx={{ flexShrink: 0, mr: 0.5 }}
    >
      Wikipedia
    </Link>
  );
}
