/**
 * A picture enlarged, with its full credit under it (ADR-0182).
 *
 * A thumbnail answers "is there a picture"; the question a curator actually has
 * is "is this the building I think it is", which needs a size no row has room
 * for. This is where the picture is looked at, so it is the surface the whole
 * credit is drawn on (`ImageCreditLine surface="full"`). The larger copy is
 * asked at 960, a width Wikimedia's CDN already holds, so opening it costs a
 * cached fetch rather than the full file.
 *
 * A dialog: Escape closes it and focus returns to the thumbnail that opened it.
 * The failure is held as *which address* failed, since one dialog may be handed
 * another picture; the credit goes with a picture that did not arrive, and the
 * dialog says so rather than leaving an empty white box under the name.
 */

import { useState } from 'react';
import { Box, Dialog, DialogContent, DialogTitle, Typography } from '@mui/material';
import type { ImageCredit } from '../../api/experiences';
import { extractImageUrl, toThumbnailUrl } from '../../utils/imageUrl';
import { ImageCreditLine } from './ImageCreditLine';

/** The width the enlargement asks for: one of the sizes Wikimedia's CDN holds. */
export const LIGHTBOX_WIDTH = 960;

export function PictureLightbox({ open, onClose, imageUrl, title, credit }: {
  open: boolean;
  onClose: () => void;
  /** The picture as stored (`image_url`), sized here. */
  imageUrl: string | null | undefined;
  /** What the picture is of, as the dialog's title and the picture's alt text. */
  title: string;
  credit?: ImageCredit | null;
}) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const image = extractImageUrl(imageUrl ?? null);
  const src = image ? toThumbnailUrl(image, LIGHTBOX_WIDTH) : '';
  if (!src) return null;
  const failed = failedFor === src;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" onClick={(event) => event.stopPropagation()}>
      <DialogTitle sx={{ pb: 1 }}>{title}</DialogTitle>
      <DialogContent sx={{ pt: 0 }}>
        {!failed && (
          <Box
            component="img"
            // Keyed on the address: another picture mounts a fresh <img>, which
            // shows nothing until it decodes, where a reused one keeps drawing
            // the last picture meanwhile (#844).
            key={src}
            src={src}
            alt={title}
            sx={{ width: '100%', height: 'auto', display: 'block' }}
            onError={() => setFailedFor(src)}
          />
        )}
        {!failed && <ImageCreditLine credit={credit} surface="full" />}
        {failed && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            This picture could not be loaded. Its source may no longer be serving it.
          </Typography>
        )}
      </DialogContent>
    </Dialog>
  );
}
