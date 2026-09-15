import { Fragment, useState } from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import type { SiteFind } from '../../api/experiences';
import type { ArtworkPreview } from '../../hooks/useExperienceContext';
import { toThumbnailUrl } from '../../utils/imageUrl';
import { yearLabel } from '../../utils/yearLabel';
import { ImageCreditLine } from './ImageCreditLine';
import { PlaceLink } from './PlaceLink';
import { WorkThumbnail } from './WorkThumbnail';

/**
 * How many finds a site's card mounts before asking — the works list's number,
 * for the same reason: the box scrolls, and the control that reveals the rest
 * only exists once there are more than this, which already overflows it.
 */
const FINDS_INITIAL_LIMIT = 10;

/**
 * What was dug up at a site, and where a traveller can see it (#894).
 *
 * A traveller at Mycenae reads "Mask of Agamemnon — shown at the National
 * Archaeological Museum of Athens", with the museum a way there where the
 * reader's world view places it (`PlaceLink`). Both halves were in the
 * catalogue — a find's `foundAt` from the museum door, the site row from the
 * site door — and nothing joined them until this list.
 *
 * Shared by Map mode's card and Discover's panel, so one site is not described
 * two ways; only the larger picture differs, since Discover has no overlay to
 * open one in (`onPreview`). Renders nothing for an empty list rather than an
 * empty heading: a site with no find above the finds' line says so by having
 * nothing to list.
 */
export function SiteFinds({ finds, total, onPreview }: {
  finds: SiteFind[];
  total: number;
  /** Map mode's overlay for the larger picture; absent on Discover. */
  onPreview?: (preview: ArtworkPreview | null) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (finds.length === 0) return null;
  const shown = showAll ? finds : finds.slice(0, FINDS_INITIAL_LIMIT);
  const hasMore = total > FINDS_INITIAL_LIMIT;

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', fontWeight: 600 }}>
        Finds dug up here ({total})
      </Typography>
      <Box
        sx={{
          bgcolor: 'white',
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider',
          maxHeight: 300,
          overflowY: 'auto',
        }}
      >
        {shown.map((find) => (
          <FindRow key={find.id} find={find} onPreview={onPreview} />
        ))}
        {hasMore && !showAll && (
          // A real control, as the works list's is: rows past the first ten are
          // not rendered until this is pressed, and a `<div onClick>` would cap a
          // keyboard reader at ten with no way past.
          <ButtonBase
            component="div"
            onClick={() => setShowAll(true)}
            sx={{
              display: 'block',
              width: '100%',
              textAlign: 'center',
              py: 0.5,
              cursor: 'pointer',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Typography variant="caption" color="primary">
              Show all {total} finds
            </Typography>
          </ButtonBase>
        )}
      </Box>
    </Box>
  );
}

/**
 * One find: its picture, its name, what it is and when, and the museums that
 * show it — each a link where it can be one.
 */
function FindRow({ find, onPreview }: {
  find: SiteFind;
  onPreview?: (preview: ArtworkPreview | null) => void;
}) {
  // The row's state, not the thumbnail's: the credit under the name answers to
  // the same failure (#557), and a photographer named under nothing credits nobody.
  const [failed, setFailed] = useState(false);
  const url = find.image_url ? toThumbnailUrl(find.image_url) : '';

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 1.5,
        py: 1,
        borderBottom: '1px solid',
        borderColor: 'divider',
        '&:last-child': { borderBottom: 0 },
      }}
    >
      <WorkThumbnail
        url={url}
        previewUrl={find.image_url ? toThumbnailUrl(find.image_url, 500) : ''}
        alt={find.name}
        credit={find.image_credit}
        failed={failed}
        onFailed={() => setFailed(true)}
        onPreview={onPreview}
      />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.3 }} noWrap>
          {find.name}
        </Typography>
        {/* The date through the shared rule, as every surface prints a work's
            year: the Mask of Agamemnon is "1600 BC", never "-1600". */}
        <Typography variant="caption" color="text.secondary" noWrap>
          {[find.treasure_type, yearLabel(find.year)].filter(Boolean).join(' · ')}
        </Typography>
        {/* Where a traveller sees it. One museum on nearly every find; the
            Parthenon Frieze is in London and in Athens, and both are named. */}
        <Typography variant="caption" color="text.secondary" display="block" noWrap>
          shown at {find.shown_at.map((venue, index) => (
            <Fragment key={venue.id}>
              {index > 0 && (index === find.shown_at.length - 1 ? ' and ' : ', ')}
              <PlaceLink place={venue} />
            </Fragment>
          ))}
        </Typography>
        {/* Hung on the picture that is actually on screen. No `redundantWith`:
            a find has no maker the row names, so a credit never repeats one. */}
        {url && !failed && <ImageCreditLine credit={find.image_credit} />}
      </Box>
    </Box>
  );
}
