import { useState } from 'react';
import { Box, ButtonBase, IconButton, Tooltip, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EditNoteIcon from '@mui/icons-material/EditNote';
import type { ExperienceTreasure } from '../../api/experiences';
import { toThumbnailUrl } from '../../utils/imageUrl';
import { ImageCreditLine, needsCredit } from '../shared/ImageCreditLine';
import { FindOriginLine } from '../shared/FindOriginLine';
import { creatorsBrief } from '../../utils/creatorList';
import { yearLabel } from '../../utils/yearLabel';
import type { WorkKind } from '../../utils/worksByKind';
import { WorkKindDots } from '../shared/WorkKindChips';

/**
 * One work in the grid: its picture, whether this reader has seen it, and whose photograph it is.
 *
 * Extracted from the grid rather than nested inside it because the credit gave
 * each cell a second child, and a tile is a thing rather than a shape the loop
 * happens to make.
 */
export function ContentTile({ content, placeKinds, isViewed, isAuthenticated, onToggleViewed, onCorrect }: {
  content: ExperienceTreasure;
  /** The place's kinds, where it has several: the tile is marked with those that hold the work (#1263). */
  placeKinds?: WorkKind[];
  isViewed: boolean;
  isAuthenticated: boolean;
  onToggleViewed: () => void;
  /** A curator's way into correcting this work (#731); absent for everyone else. */
  onCorrect?: (work: ExperienceTreasure) => void;
}) {
  // State rather than `style.display = 'none'` on the image: hiding the element
  // left the tile's own name overlay and the credit below it standing under a
  // picture that is not there, and on some sources a failed request is the
  // common case rather than the edge one (#557).
  const [failed, setFailed] = useState(false);
  const thumbUrl = !failed && content.image_url ? toThumbnailUrl(content.image_url, 120) : null;

  // Shared by both shapes below, so the tile looks the same whether or not it is
  // a control.
  const frame = {
    position: 'relative',
    display: 'block',
    width: '100%',
    textAlign: 'inherit',
    borderRadius: 1,
    overflow: 'hidden',
    opacity: isViewed ? 0.5 : 1,
    transition: 'opacity 0.2s',
    '&:hover': { opacity: 1 },
    // The focus ring itself is the theme's (`MuiButtonBase`), since `ButtonBase`
    // clears the browser's outline everywhere rather than only here. Worth saying
    // that it is load-bearing on this grid in particular: the hover cue cannot
    // stand in for it, because `opacity: 1` is already an unviewed tile's resting
    // value, so without a ring these are twenty identical squares a keyboard
    // reader moves through blind.
  } as const;

  const tip = [
    content.name,
    creatorsBrief(content.artists, content.artists_curated)
      ? ` - ${creatorsBrief(content.artists, content.artists_curated)}` : '',
    // Through the shared rule, like every other surface that prints a work's
    // year: the raw column hovered the Borghese Gladiator as "(-100)" beside a
    // dialog that reads "100 BC" (#731).
    yearLabel(content.year) ? ` (${yearLabel(content.year)})` : '',
  ].join('');
  // The credit is the badge on the picture (ADR-0182), so the name strip leaves it room.
  const badged = !!thumbUrl && needsCredit(content.image_credit);

  const face = (
    <>
        {thumbUrl ? (
          <Box
            component="img"
            src={thumbUrl}
            alt={content.name}
            loading="lazy"
            sx={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
            onError={() => setFailed(true)}
          />
        ) : (
          <Box
            sx={{
              width: '100%',
              aspectRatio: '1',
              bgcolor: 'grey.100',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.55rem', textAlign: 'center', px: 0.5 }}>
              {content.name}
            </Typography>
          </Box>
        )}
        {isAuthenticated && isViewed && (
          <CheckCircleIcon
            sx={{
              position: 'absolute',
              top: 2,
              right: 2,
              fontSize: 16,
              color: 'success.main',
              bgcolor: 'white',
              borderRadius: '50%',
            }}
          />
        )}
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          bgcolor: 'rgba(0,0,0,0.6)',
          px: 0.5,
          pr: badged ? 2.5 : 0.5,
          py: 0.25,
        }}
      >
        <Typography variant="caption" sx={{ color: 'white', fontSize: '0.55rem', lineHeight: 1.2 }} noWrap>
          {placeKinds && <WorkKindDots kindIds={content.kind_ids} placeKinds={placeKinds} />}
          {content.name}
        </Typography>
      </Box>
    </>
  );

  return (
    <Box sx={{
      position: 'relative',
      // The curator's control is shown when the tile is reached, so a reader's
      // grid stays a grid of pictures. Focus counts as reaching it, or the
      // button would exist for a pointer alone.
      '&:hover .work-correct, &:focus-within .work-correct': { opacity: 1 },
    }}>
      {/* Top left, because the top right is where a work already says it has been
          seen — and a claim word does not fit on a 100 px tile, so what a curator
          has corrected is said inside the dialog this opens. */}
      {onCorrect && (
        <Tooltip title="Correct this work">
          <IconButton
            size="small"
            className="work-correct"
            aria-label={`Correct ${content.name}`}
            onClick={() => onCorrect(content)}
            sx={{
              position: 'absolute', top: 2, left: 2, zIndex: 1, p: 0.25,
              bgcolor: 'background.paper', boxShadow: 1,
              opacity: 0, transition: 'opacity .12s',
              '&:hover': { bgcolor: 'background.paper' },
            }}
          >
            <EditNoteIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
      {/* A `ButtonBase` and not a `<Box onClick>` — but only for a reader who can
          actually record anything. Marking a work seen is the tile's whole purpose
          and there is no other affordance for it on this screen, so as a plain
          `<div onClick>` a keyboard reader could read every work in the Louvre and
          record none of them: that is the same decision `ObjectContext` states for
          its thumbnail, and for the same reason — `jsx-a11y` is not installed, so
          nothing in the gate would have said so. `component="div"` because the tile
          holds block content, which is not valid inside a `<button>`; the role, the
          tab stop and the key handlers come with `ButtonBase` regardless. The label
          names what the press will *do*, since that is what a reader hears before
          pressing.
          Offered to nobody else: `/discover` is a public route, and the write behind
          this needs a session — so for a signed-out visitor the control would be a
          tab stop on every tile announcing an action that answers 401 in silence.
          The sibling surface makes the same call for the same data: `ArtworksList`
          renders its checkbox only when there is somebody to record for. */}
      {/* On the outer element, not on the name strip: `Tooltip` binds its listeners
          to its own child, and the strip is a plain `<div>` that never takes focus.
          Bound there, the artist and the year are shown to a pointer
          and to nobody else — on a tile that is itself a focus stop. The
          strip is `noWrap` besides, so a long name is cut there too.
          `describeChild` because the tile already carries an `aria-label` saying
          what the press will do: without it MUI writes the title into that
          attribute, and the announcement becomes the description instead of the
          action. */}
      <Box sx={{ position: 'relative' }}>
      <Tooltip title={tip} describeChild>
      {isAuthenticated ? (
        <ButtonBase
          component="div"
          aria-label={isViewed
            ? `${content.name} — mark as not seen`
            : `${content.name} — mark as seen`}
          sx={{ ...frame, cursor: 'pointer' }}
          onClick={onToggleViewed}
        >
          {face}
        </ButtonBase>
      ) : (
        <Box sx={frame}>{face}</Box>
      )}
      </Tooltip>
      {/* Beside the tile's own control, not inside it: the tile is a button that
          marks the work seen, and the badge is a button of its own. Hung on
          `thumbUrl`, so a picture that failed or a host we do not trust draws
          no credit beside the name placeholder. */}
      {thumbUrl && <ImageCreditLine credit={content.image_credit} surface="badge" />}
      </Box>
      {/* Where it comes from, in the words Map mode's row uses (#885): an
          archaeology museum's holdings are objects taken from somewhere, and a
          tile naming only the museum tells a traveller the smaller half of what
          the thing is (ADR-0058). Under the tile and not inside it: the square
          is 100 px with the name already across its foot. */}
      <FindOriginLine content={content} sx={{ fontSize: '0.6rem', mt: 0.25 }} />
    </Box>
  );
}
