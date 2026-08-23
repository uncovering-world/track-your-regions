/**
 * The artwork under the pointer, thrown across the map at a size worth looking at.
 *
 * A row in the works list is 48 px of picture, which answers "is there one" and
 * not "what is it" — so resting on one paints the map over with the same file at
 * 500 px. Its own component rather than a block inside `RegionMapVT`, which the
 * complexity gate refused once the credit gave it a second condition, and which
 * has no business knowing how a photograph is captioned.
 *
 * The credit rides in on the preview object (`ArtworkPreview`) rather than being
 * looked up here: the map has no work in scope, and a 500 px Commons photograph
 * with nobody named under it is exactly what CC BY and CC BY-SA forbid. Shown
 * whole, with no `redundantWith` — the list row that opened this has the work's
 * own line to be redundant against, and this has nothing but the picture.
 */

import { useState } from 'react';
import { Box } from '@mui/material';
import { ImageCreditLine } from '../shared/ImageCreditLine';
import type { ArtworkPreview } from '../../hooks/useExperienceContext';

export function ArtworkPreviewOverlay({ preview }: { preview: ArtworkPreview | null }) {
  // Held as *which* picture failed rather than as a flag: the overlay outlives
  // one hover, and a flag would carry the last failure onto the next work.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // A picture that did not arrive draws nothing at all — not an empty sheet over
  // the map. Keeping the wrapper would darken everything for a hover that has
  // nothing to show, and since the failure is remembered per URL it would do so
  // on every later hover of the same work.
  if (!preview || failedUrl === preview.url) return null;
  const named = !!(preview.credit?.author || preview.credit?.license);

  return (
    <Box
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 5,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        pointerEvents: 'none',
      }}
    >
      <Box
        component="img"
        src={preview.url}
        alt=""
        // A credit belongs under a photograph, so a photograph that did not
        // arrive takes the whole overlay with it — the name and the sheet alike.
        onError={() => setFailedUrl(preview.url)}
        sx={{
          maxWidth: '60%',
          maxHeight: '70%',
          objectFit: 'contain',
          borderRadius: 2,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      />
      {/* Its own pale strip, because the overlay behind it is deliberately dark
          and the credit draws in the theme's secondary text colour. Absent
          entirely where the source named nobody: an empty white bar under a
          photograph is worse than no bar at all. */}
      {named && (
        <Box sx={{ mt: 1, px: 1, py: 0.25, maxWidth: '60%', borderRadius: 1, bgcolor: 'rgba(255, 255, 255, 0.85)' }}>
          <ImageCreditLine credit={preview.credit} />
        </Box>
      )}
    </Box>
  );
}
