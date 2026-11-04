/**
 * A dense row's picture: a small thumbnail with its credit as a © badge, which
 * opens enlarged (ADR-0182).
 *
 * For the rows that list places or works with a picture each — a review card's
 * lists, the crowded-city window, a works preview, the search behind Add. A row
 * has room for a thumbnail and nothing under it, so the credit is the badge on
 * the picture (`ImageCreditLine surface="badge"`), and a press on the picture
 * (a click, Enter or Space) opens it at 960 px with the full credit
 * (`PictureLightbox`) — 64 px tells a curator little about which building it is.
 *
 * The badge and the press hang on the picture that is on screen: a thumbnail
 * that failed to load takes both with it. The failure is held as which address
 * failed, so a row handed another picture draws it afresh. Where there is no
 * picture, the frame's room is kept when `reserve` asks for it, so the rows of a
 * list line up.
 */

import { useState } from 'react';
import { Box, ButtonBase } from '@mui/material';
import type { ImageCredit } from '../../api/experiences';
import { extractImageUrl, toThumbnailUrl } from '../../utils/imageUrl';
import { ImageCreditLine } from './ImageCreditLine';
import { PictureLightbox } from './PictureLightbox';

export function DenseThumbnail({ imageUrl, title, credit, width = 64, height = 56, reserve = false, enlarge = true }: {
  /** The picture as stored (`image_url`), sized here. */
  imageUrl: string | null | undefined;
  /** What the picture is of: the enlargement's title, and the press's name. */
  title: string;
  credit?: ImageCredit | null;
  width?: number;
  height?: number;
  /** Keep the frame's room where there is no picture, so the rows of a list line up. */
  reserve?: boolean;
  /**
   * Whether a press opens the picture enlarged. Off where the row itself sits
   * on a transient surface — a tooltip — which would take the dialog along.
   */
  enlarge?: boolean;
}) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const image = extractImageUrl(imageUrl ?? null);
  const src = image ? toThumbnailUrl(image, 120) : '';
  if (!src || failedFor === src) return reserve ? <Box sx={{ width, flexShrink: 0 }} /> : null;
  const picture = (
    <Box
      component="img"
      key={src}
      src={src}
      alt={title}
      loading="lazy"
      onError={() => setFailedFor(src)}
      sx={{ width, height, objectFit: 'cover', borderRadius: 0.5, display: 'block' }}
    />
  );
  return (
    <Box sx={{ position: 'relative', width, height, flexShrink: 0 }}>
      {enlarge ? (
        <ButtonBase
          aria-label={`${title} — enlarge the picture`}
          onClick={(event) => {
            // The row answers a click of its own (a crowded-city row brings its dot into view).
            event.stopPropagation();
            setOpen(true);
          }}
          sx={{ borderRadius: 0.5, cursor: 'zoom-in', display: 'block' }}
        >
          {picture}
        </ButtonBase>
      ) : picture}
      <ImageCreditLine credit={credit} surface="badge" />
      {enlarge && (
        <PictureLightbox open={open} onClose={() => setOpen(false)} imageUrl={imageUrl} title={title} credit={credit} />
      )}
    </Box>
  );
}
