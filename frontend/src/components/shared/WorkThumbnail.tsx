import { Box } from '@mui/material';
import type { ImageCredit } from '../../api/experiences';
import type { ArtworkPreview } from '../../hooks/useExperienceContext';

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
 * `failed` is the row's state rather than this component's, because the credit
 * line the row draws beside the name has to answer to the same failure: a
 * photographer named under a picture that did not arrive credits nobody (#557).
 */
export function WorkThumbnail({ url, previewUrl, alt, credit, failed, onFailed, onPreview, dim }: {
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
  /** Whose photograph, so the overlay drawn on the map can say so. */
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
}) {
  if (!url) return null;
  const previews = !!onPreview && !!previewUrl && !failed;
  return (
    <Box
      sx={{
        width: 48,
        height: 48,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
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
      {!failed && (
        <Box
          component="img"
          src={url}
          alt={alt}
          loading="lazy"
          sx={{ maxWidth: 48, maxHeight: 48, objectFit: 'contain', borderRadius: 0.5 }}
          // State rather than `style.display = 'none'`: hiding the element left
          // the credit below it standing under a picture that is not there.
          onError={onFailed}
        />
      )}
    </Box>
  );
}
