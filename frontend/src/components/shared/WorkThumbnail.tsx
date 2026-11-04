import { useState } from 'react';
import { Box, ButtonBase } from '@mui/material';
import type { ImageCredit } from '../../api/experiences';
import type { ArtworkPreview } from '../../hooks/useExperienceContext';
import { ImageCreditLine } from './ImageCreditLine';
import { PictureLightbox } from './PictureLightbox';

/**
 * A work's 48 px picture in a list row, and the larger copy it opens over the
 * map while the pointer rests on it.
 *
 * Lifted out of `ArtworkRow` when a site's card began listing the finds dug up
 * there (#894, `SiteFinds`), which draw the same picture the museum's row does
 * — on both surfaces, which is why this is shared rather than the list's. The frame is
 * hung on the URL and not on whether the picture arrived, so that a failure
 * cannot unmount the element carrying `onMouseLeave` — the only thing that
 * closes the map's overlay. Only the `<img>` answers to `failed`.
 *
 * A dense row, so the picture's credit is the © badge on it, and a press on
 * the picture opens it enlarged with the full credit where the row hands over
 * the stored address (`enlargeUrl`, ADR-0182). Both go with a picture that
 * failed to load: a photographer named beside a picture that did not arrive
 * credits nobody (#557). `failed` is the row's state, so the row can answer to
 * the same failure.
 */
export function WorkThumbnail({ url, previewUrl, alt, credit, failed, onFailed, onPreview, dim, enlargeUrl }: {
  /**
   * The normalised URL — `toThumbnailUrl`'s answer, never the stored one — or
   * `''` for a host the product may not draw from, which renders nothing:
   * `src=""` is not "no image", the browser resolves it against the page and
   * draws a broken thumbnail in the frame.
   */
  url: string;
  /**
   * The larger copy the overlay draws — `toThumbnailUrl(stored, 500)`, derived
   * by the caller from the **stored** value, never from `url`: `toThumbnailUrl`
   * appends its `?width=` unconditionally, so sizing an answer again yields
   * `?width=120?width=500`, and the overlay gets the thumbnail scaled up — or
   * the unsized original #557 took off the catalogue. Absent, nothing opens.
   */
  previewUrl?: string;
  alt: string;
  /** Whose photograph: the badge on the thumbnail, the enlargement and the overlay drawn on the map say so. */
  credit?: ImageCredit | null;
  failed: boolean;
  onFailed: () => void;
  /**
   * Where a surface has an overlay to open the picture in — Map mode's
   * `setArtworkPreview`. Absent, the thumbnail is a picture and nothing more.
   */
  onPreview?: (preview: ArtworkPreview | null) => void;
  /** Drawn faded — a work this reader has already seen. */
  dim?: boolean;
  /** The picture as stored: given, a press on the thumbnail opens it enlarged (`PictureLightbox`). */
  enlargeUrl?: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (!url) return null;
  const previews = !!onPreview && !!previewUrl && !failed;
  const picture = !failed && (
    <Box
      component="img"
      src={url}
      alt={alt}
      loading="lazy"
      sx={{ maxWidth: 48, maxHeight: 48, objectFit: 'contain', borderRadius: 0.5, display: 'block' }}
      // State rather than `style.display = 'none'`: hiding the element left
      // the credit standing beside a picture that is not there.
      onError={onFailed}
    />
  );
  return (
    <Box
      sx={{
        width: 48,
        height: 48,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        bgcolor: 'grey.100',
        borderRadius: 0.5,
        cursor: previews ? 'pointer' : 'default',
        opacity: dim ? 0.5 : 1,
      }}
      // The credit travels with the picture: the overlay is drawn on the map,
      // which has no work in scope to look one up from. Not offered at all once
      // the thumbnail has failed — the larger copy is the same file.
      onMouseEnter={previews ? () => onPreview({ url: previewUrl, credit }) : undefined}
      // Unconditional, including after a failure: clearing a preview that is
      // not open costs nothing, and this is the only thing that closes one.
      onMouseLeave={onPreview ? () => onPreview(null) : undefined}
    >
      {picture && enlargeUrl ? (
        <ButtonBase aria-label={`${alt} — enlarge the picture`} onClick={() => setOpen(true)}
          sx={{ borderRadius: 0.5, cursor: 'zoom-in' }}>
          {picture}
        </ButtonBase>
      ) : picture}
      {picture && <ImageCreditLine credit={credit} surface="badge" />}
      {picture && enlargeUrl && (
        <PictureLightbox open={open} onClose={() => setOpen(false)} imageUrl={enlargeUrl} title={alt} credit={credit} />
      )}
    </Box>
  );
}
