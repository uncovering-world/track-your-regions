import { useState } from 'react';
import { Box, ButtonBase, Typography, Checkbox, IconButton, Tooltip } from '@mui/material';
import EditNoteIcon from '@mui/icons-material/EditNote';
import { useExperienceContext, toThumbnailUrl } from '../../hooks/useExperienceContext';
import { useAuth } from '../../hooks/useAuth';
import { useViewedTreasures } from '../../hooks/useVisitedExperiences';
import type { ExperienceTreasure } from '../../api/experiences';
import type { ArtworkPreview } from '../../hooks/useExperienceContext';
import { ImageCreditLine } from '../shared/ImageCreditLine';
import { WorkThumbnail } from '../shared/WorkThumbnail';
import { PlaceLink } from '../shared/PlaceLink';
import { creatorsBrief } from '../../utils/creatorList';
import { yearLabel } from '../../utils/yearLabel';
import { claimLabel } from '../../utils/workClaims';
import { holdingsNoun } from '../../utils/experienceTypes';
import { VISITED_GREEN } from '../../utils/kindColors';
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
function ArtworkRow({ content, isViewed, isAuthenticated, onToggleViewed, setArtworkPreview, onCorrect }: {
  content: ExperienceTreasure;
  isViewed: boolean;
  isAuthenticated: boolean;
  onToggleViewed: (e: React.MouseEvent) => void;
  setArtworkPreview: (preview: ArtworkPreview | null) => void;
  /** A curator's way into correcting this work; absent for everyone else. */
  onCorrect?: (work: ExperienceTreasure) => void;
}) {
  const [failed, setFailed] = useState(false);
  // The normalised URL, not the stored one, decides whether there is a picture:
  // `toThumbnailUrl` answers with an empty string for a host we do not trust, and
  // `WorkThumbnail` draws nothing for that. The same rule `ObjectContext` and
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
        // The row's own action, shown when the row is: a quiet list of a
        // museum's holdings is what a reader wants, and a curator meets the
        // control by reaching the row they were going to correct anyway.
        '&:hover .work-correct, &:focus-within .work-correct': { opacity: 1 },
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
      <WorkThumbnail
        url={url}
        // From the stored value, not from `url`: sizing an answer again
        // double-sizes it (the note on `previewUrl`).
        previewUrl={content.image_url ? toThumbnailUrl(content.image_url, 500) : ''}
        alt={content.name}
        credit={content.image_credit}
        failed={failed}
        onFailed={() => setFailed(true)}
        onPreview={setArtworkPreview}
        dim={isViewed}
      />
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
          {[creatorsBrief(content.artists, content.artists_curated),
            // Not the stored integer: the Borghese Gladiator was carved around
            // 100 BC, and this row used to print "-100" while the works preview
            // beside it printed "100 BC" (`yearLabel`).
            yearLabel(content.year), content.treasure_type]
            .filter(Boolean).join(' · ')}
        </Typography>
        {/* Where it was dug up, for the works that were: an archaeology
            museum's holdings are objects taken from somewhere, and a row naming
            only the museum tells a traveller the smaller half of what the thing
            is (ADR-0058). Its own line rather than another term in the row
            above, which is the makers-and-date line a painting fills and a find
            usually leaves empty. */}
        {content.found_at?.label && (
          <Typography variant="caption" color="text.secondary" display="block" noWrap>
            {/* A way to the site where the catalogue holds it (#894); its
                name where it does not — a city, a region, a spot no site
                door has written. */}
            found at {content.found_at_site
              ? <PlaceLink place={content.found_at_site} />
              : content.found_at.label}
          </Typography>
        )}
        {/* `redundantWith` because the line above already names the makers, and
            Commons names the painter as the author of a photograph of a painting —
            so on most rows this would repeat a maker and add a licence that asks
            for nothing. It draws where it carries something: a CC BY or CC BY-SA
            photograph, or a photographer who is none of them. See
            `creditAddsBeyond`. Hung on the picture that is actually on screen. */}
        {url && !failed && (
          <ImageCreditLine credit={content.image_credit} redundantWith={content.artists} />
        )}
        {/* The word that says a curator already answered for one of this work's
            fields — without it a title somebody fixed reads as the source's. */}
        {claimLabel(content.curated_fields) && (
          <Typography variant="caption" color="primary" sx={{ display: 'block' }}>
            {claimLabel(content.curated_fields)}
          </Typography>
        )}
      </Box>
      {onCorrect && (
        <Tooltip title="Correct this work">
          <IconButton
            size="small"
            className="work-correct"
            aria-label={`Correct ${content.name}`}
            onClick={(e) => { e.stopPropagation(); onCorrect(content); }}
            sx={{ opacity: 0, transition: 'opacity .12s', flexShrink: 0 }}
          >
            <EditNoteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

interface ArtworksListProps {
  contents: ExperienceTreasure[];
  total: number;
  experienceId: number;
  /** Which kind's row this box sits on, which decides what its holdings are called. */
  kindId?: number | null;
  /** A curator's way into correcting one of these works (#731); absent for everyone else. */
  onCorrect?: (work: ExperienceTreasure) => void;
}

export function ArtworksList({ contents, total, experienceId, kindId, onCorrect }: ArtworksListProps) {
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
  // What this box calls what it holds, decided once and shared with Discover:
  // the heading and the control that opens the rest of the list name the same
  // things, and the same museum opened on the other surface names them that way
  // too (`holdingsNoun`, #885).
  const holdings = holdingsNoun(kindId);

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
        Notable {holdings} ({total})
        {isAuthenticated && viewedCount > 0 && ` · ${viewedCount} seen`}
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
            onCorrect={onCorrect}
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
              Show all {total} {holdings}
            </Typography>
          </ButtonBase>
        )}
      </Box>
    </Box>
  );
}
