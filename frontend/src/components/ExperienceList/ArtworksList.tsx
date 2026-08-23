import { useState } from 'react';
import { Box, ButtonBase, Typography, Checkbox } from '@mui/material';
import { useExperienceContext, toThumbnailUrl } from '../../hooks/useExperienceContext';
import { useAuth } from '../../hooks/useAuth';
import { useViewedTreasures } from '../../hooks/useVisitedExperiences';
import type { ExperienceTreasure } from '../../api/experiences';
import type { ArtworkPreview } from '../../hooks/useExperienceContext';
import { ImageCreditLine } from '../shared/ImageCreditLine';
import { VISITED_GREEN } from '../../utils/categoryColors';
import { ARTWORKS_INITIAL_LIMIT } from './utils';

/**
 * One work in the list: its picture, whether this reader has seen it, and whose photograph it is.
 *
 * A component rather than a block inside the loop because the row now holds
 * state: whether its picture actually arrived. `onError` used to hide the `<img>`
 * and leave everything else standing, which after this change would leave a
 * photographer credited under nothing — and on some sources a picture failing to
 * load is the common case rather than the edge one (#557).
 */
function ArtworkRow({ content, isViewed, isAuthenticated, onToggleViewed, setArtworkPreview }: {
  content: ExperienceTreasure;
  isViewed: boolean;
  isAuthenticated: boolean;
  onToggleViewed: (e: React.MouseEvent) => void;
  setArtworkPreview: (preview: ArtworkPreview | null) => void;
}) {
  const [failed, setFailed] = useState(false);
  // The normalised URL, not the stored one, decides whether there is a picture:
  // `toThumbnailUrl` answers with an empty string for a host we do not trust, and
  // `src=""` is not "no image" — the browser resolves it against the page and
  // draws a broken thumbnail in a 48×48 frame. The same rule `ObjectContext` and
  // `WorksPreview` state; it guards the next source rather than this one, since
  // every treasure image stored today is a Commons `Special:FilePath` URL.
  const url = content.image_url ? toThumbnailUrl(content.image_url) : '';

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
      {isAuthenticated && (
        <Checkbox
          size="small"
          checked={isViewed}
          // Named for the reason the places list states: unlabelled, this is
          // announced as "checkbox, not checked" and names neither the work nor
          // what ticking it says about it.
          inputProps={{
            'aria-label': isViewed
              ? `${content.name} — mark as not seen`
              : `${content.name} — mark as seen`,
          }}
          onClick={onToggleViewed}
          sx={{ p: 0.25, flexShrink: 0, '&.Mui-checked': { color: VISITED_GREEN } }}
        />
      )}
      {/* The frame is hung on the URL and not on whether the picture arrived, so
          that a failure cannot unmount the element carrying `onMouseLeave` — which
          would leave the map's overlay painted open with nothing to close it. Only
          the `<img>` and the credit answer to `failed`. */}
      {url && (
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
            cursor: failed ? 'default' : 'pointer',
            opacity: isViewed ? 0.5 : 1,
          }}
          // The credit travels with the picture: the overlay is drawn on the map,
          // which has no work in scope to look one up from. Not offered at all once
          // the thumbnail has failed — the larger copy is the same file.
          onMouseEnter={failed ? undefined : () => setArtworkPreview({
            url: toThumbnailUrl(content.image_url!, 500),
            credit: content.image_credit,
          })}
          // Unconditional, including after a failure: clearing a preview that is
          // not open costs nothing, and this is the only thing that closes one.
          onMouseLeave={() => setArtworkPreview(null)}
        >
          {!failed && (
            <Box
              component="img"
              src={url}
              alt={content.name}
              loading="lazy"
              sx={{ maxWidth: 48, maxHeight: 48, objectFit: 'contain', borderRadius: 0.5 }}
              // State rather than `style.display = 'none'`: hiding the element left
              // the credit below it standing under a picture that is not there.
              onError={() => setFailed(true)}
            />
          )}
        </Box>
      )}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="body2"
          sx={{
            fontWeight: 500,
            lineHeight: 1.3,
            textDecoration: isViewed ? 'line-through' : 'none',
            color: isViewed ? 'text.secondary' : 'text.primary',
          }}
          noWrap
        >
          {content.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {[content.artist, content.year, content.treasure_type].filter(Boolean).join(' · ')}
        </Typography>
        {/* `redundantWith` because the line above already names the artist, and
            Commons names the painter as the author of a photograph of a painting —
            so on most rows this would repeat the artist and add a licence that asks
            for nothing. It draws where it carries something: a CC BY or CC BY-SA
            photograph, or a photographer who is not the artist. See
            `creditAddsBeyond`. Hung on the picture that is actually on screen. */}
        {url && !failed && (
          <ImageCreditLine credit={content.image_credit} redundantWith={content.artist} />
        )}
      </Box>
    </Box>
  );
}

interface ArtworksListProps {
  contents: ExperienceTreasure[];
  total: number;
  experienceId: number;
}

export function ArtworksList({ contents, total, experienceId }: ArtworksListProps) {
  const { setArtworkPreview } = useExperienceContext();
  const { isAuthenticated } = useAuth();
  const { viewedIds, viewedCount, markViewed, unmarkViewed } = useViewedTreasures(experienceId);
  // Showing every work does not change the row's height, and so reports nothing:
  // this list is a 300 px scroller, and the link that reveals the rest only exists
  // once there are more than ten of them — which already overflows it. The box is
  // at its cap before the click and at its cap after.
  const [showAll, setShowAll] = useState(false);
  const displayContents = showAll ? contents : contents.slice(0, ARTWORKS_INITIAL_LIMIT);
  const hasMore = total > ARTWORKS_INITIAL_LIMIT;

  const handleToggleViewed = (treasureId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (viewedIds.has(treasureId)) {
      unmarkViewed(treasureId);
    } else {
      markViewed({ treasureId, experienceId });
    }
  };

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', fontWeight: 600 }}>
        Notable works ({total}){isAuthenticated && viewedCount > 0 && ` · ${viewedCount} seen`}
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
        {displayContents.map((content) => (
          <ArtworkRow
            key={content.id}
            content={content}
            isViewed={viewedIds.has(content.id)}
            isAuthenticated={isAuthenticated}
            onToggleViewed={(e) => handleToggleViewed(content.id, e)}
            setArtworkPreview={setArtworkPreview}
          />
        ))}
        {hasMore && !showAll && (
          // A real control, like its Discover twin: works past the first ten are not
          // rendered at all until this is pressed, so as a `<div onClick>` it capped a
          // keyboard reader at ten of a museum's holdings with no way past. The role,
          // the tab stop, the Enter/Space handlers and the theme's focus ring all come
          // with `ButtonBase`; `component="div"` because this sits inside a list.
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
              Show all {total} works
            </Typography>
          </ButtonBase>
        )}
      </Box>
    </Box>
  );
}
