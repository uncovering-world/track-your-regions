/**
 * A picture row's value on a review card: the picture as readers would see it, whose
 * photograph it is, and the file it is — rather than the address as a string.
 *
 * A picture row that is two Commons URLs, one per column, leaves the curator to
 * open each in a tab to learn what the card is asking (#801) — on the 86 cards
 * run 93 filed about a public-art row's picture, that is the whole question. The
 * card's own context draws the *current* picture at 96 × 72 with a way to
 * enlarge it, and not the proposed one; this draws whichever side it is handed,
 * through the same component the
 * curator dialogs preview with, so a picture that cannot be drawn — an address the
 * product may not draw from, a file that fails to load — shows no frame and no
 * credit rather than a broken one.
 *
 * The file's name is the link text, and the address is where it goes: a person
 * calls the file *Dona i Ocell.JPG*, and the 90-character address it is served
 * under is what the `Special:FilePath` link already carries. Not a bare
 * `ExternalLink` from the vocabulary: that module renders this component, and a
 * link component imported back from it would close a cycle `lint:circular` refuses.
 */

import { Box, Link, Typography } from '@mui/material';
import type { ImageCredit } from '../../api/experiences';
import { PictureWithCredit } from '../shared/PictureWithCredit';
import { safeHref } from '../../utils/safeHref';
import { PictureClassMark } from './PictureClassMark';

/**
 * The last segment of a Commons address, as the file is named: `Special:FilePath/Dona%20i%20Ocell.JPG`
 * → *Dona i Ocell.JPG*. The whole address where there is no segment to name, or where
 * it does not decode — a curator can still read it, and the link still goes there.
 */
export function fileNameOf(url: string): string {
  try {
    const name = new URL(url).pathname.split('/').filter(Boolean).pop();
    return name ? decodeURIComponent(name) : url;
  } catch {
    return url;
  }
}

export function PictureFact({ url, credit, side, experienceId }: {
  url: string;
  /** Whose photograph this side's picture is — the vocabulary reads it off the card. */
  credit: ImageCredit | null;
  side: 'before' | 'after';
  /** The place the card is about, which the class of each side's picture is asked for (#2192). */
  experienceId?: number;
}) {
  const href = safeHref(url);
  return (
    <Box>
      <PictureWithCredit url={url} credit={credit} alt={side === 'after' ? 'Proposed picture' : 'Current picture'} />
      {/* On both sides: a curator choosing between two pictures reads which is a map or a drawing (#2192).
          A row drawn with no place to ask about (a dialog's preview) carries no mark. */}
      {experienceId !== undefined && <PictureClassMark experienceId={experienceId} url={url} />}
      <Typography variant="caption" component="div" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
        {href
          ? <Link href={href} target="_blank" rel="noopener noreferrer nofollow" underline="hover">{fileNameOf(url)}</Link>
          : url}
      </Typography>
    </Box>
  );
}
