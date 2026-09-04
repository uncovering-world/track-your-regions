/**
 * A picture and the credit it owes, drawn together or not at all.
 *
 * For a form that edits a picture by its address: the curator typing into the
 * Image URL box needs to see what the address draws, and the licence rule needs
 * the photographer named wherever the picture appears (ADR-0043) — the curator
 * screens included, since working on the catalogue rather than publishing it
 * does not change whose photograph it is. Both dialogs used to disagree on this:
 * the create dialog drew a thumbnail with no credit to give, and the curation
 * dialog drew nothing (#801).
 *
 * What it refuses is as much the point as what it draws. `toThumbnailUrl`
 * answers with an empty string for an address the product may not draw from —
 * a host outside the trusted list, a Commons *page* rather than a file — and
 * `src=""` is not "no picture": the browser resolves it against the page and
 * draws a broken frame. A picture that then fails to load takes its credit
 * with it, because a photographer named under an empty frame is a claim about
 * a person made where the thing that would justify it is not.
 *
 * The failure is held as *which address* failed, not that one did. A dialog
 * outlives many pictures — the curation dialog is mounted for as long as the
 * list is, and a new object reconciles into the same instance — so a flag would
 * carry one address's refusal onto the next and hide a picture that is there;
 * and a curator who retypes the address after a failure is asking again, which
 * a different key lets them do. The same finding as `ObjectContext`, same shape.
 */

import { useState } from 'react';
import { Box } from '@mui/material';
import type { ImageCredit } from '../../api/experiences';
import { extractImageUrl, toThumbnailUrl } from '../../utils/imageUrl';
import { ImageCreditLine } from './ImageCreditLine';

interface PictureWithCreditProps {
  /** The address as the form holds it — a stored `image_url` or one being typed. Sized here, never handed to an `<img>` raw. */
  url: string;
  /**
   * Whose photograph it is. Pass the stored credit for the stored picture and
   * nothing for an address not yet saved: no credit exists for one until the
   * save resolves it, and a credit is never shown under somebody else's picture.
   */
  credit?: ImageCredit | null;
  /** What the picture is, for a reader who cannot see it. */
  alt: string;
  /** One of the widths Wikimedia's own CDN holds (120, 250, 330, 500, 960, 1280). */
  width?: number;
}

export function PictureWithCredit({ url, credit, alt, width = 250 }: PictureWithCreditProps) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  // Normalised before it is sized, as every other read of a stored picture is
  // (`ObjectContext`, the search rows): `extractImageUrl` reads the legacy
  // JSON-encoded shape the column once held, so a picture readers see is not
  // a picture this preview refuses, and puts a stored `/images/…` path on the
  // API's origin rather than the page's — which `toThumbnailUrl` then answers
  // as no picture, the same photoless card the queue draws for such a row.
  const src = toThumbnailUrl(extractImageUrl(url) ?? '', width);
  if (!src || failedFor === src) return null;
  return (
    <Box sx={{ mt: 1 }}>
      <Box
        component="img"
        src={src}
        alt={alt}
        sx={{ display: 'block', maxWidth: 200, maxHeight: 120, borderRadius: 1, objectFit: 'cover' }}
        onError={() => setFailedFor(src)}
      />
      {/* Under the picture that is on screen and under nothing else: the early
          return above is what keeps this line off a frame that did not arrive. */}
      <ImageCreditLine credit={credit} />
    </Box>
  );
}
