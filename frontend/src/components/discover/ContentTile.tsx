import { useState } from 'react';
import { Box, ButtonBase, Tooltip, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import type { ExperienceTreasure } from '../../api/experiences';
import { toThumbnailUrl } from '../../utils/imageUrl';
import { creditLabel, ImageCreditLine } from '../shared/ImageCreditLine';
import { VISITED_GREEN } from '../../utils/categoryColors';

/**
 * One work in the grid: its picture, whether this reader has seen it, and whose photograph it is.
 *
 * Extracted from the grid rather than nested inside it because the credit gave
 * each cell a second child, and a tile is a thing rather than a shape the loop
 * happens to make.
 */
export function ContentTile({ content, isViewed, isAuthenticated, onToggleViewed }: {
  content: ExperienceTreasure;
  isViewed: boolean;
  isAuthenticated: boolean;
  onToggleViewed: () => void;
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
    content.artist ? ` - ${content.artist}` : '',
    content.year ? ` (${content.year})` : '',
    // Whose photograph, always — the tile itself only draws the credit where it
    // carries something the row does not, and a reader wondering about a picture
    // should not have to guess which rule kept it off. Silent where there is no
    // picture drawn, for the reason the credit below gives.
    thumbUrl ? creditLabel(content.image_credit) : '',
  ].join('');

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
              color: VISITED_GREEN,
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
          py: 0.25,
        }}
      >
        <Typography variant="caption" sx={{ color: 'white', fontSize: '0.55rem', lineHeight: 1.2 }} noWrap>
          {content.name}
        </Typography>
      </Box>
    </>
  );

  return (
    <Box>
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
          Bound there, the artist, the year and the credit were shown to a pointer
          and to nobody else — on a tile this branch had just made a focus stop. The
          strip is `noWrap` besides, so a long name is cut there too.
          `describeChild` because the tile already carries an `aria-label` saying
          what the press will do: without it MUI writes the title into that
          attribute, and the announcement becomes the description instead of the
          action. */}
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
      {/* Under the tile rather than over it: the picture is 100 px square with the
          work’s name already across its foot, and a second line in that strip
          would be a photographer’s name clipped mid-word, which credits nobody.
          `redundantWith` for the same reason the list rows use it — most of these
          are photographs of paintings, free to reuse and credited to the painter
          the tooltip already names.
          Hung on `thumbUrl` and not on the credit: `toThumbnailUrl` answers with an
          empty string for a host we do not trust, and the tile then draws the name
          placeholder above — a photographer named under a picture nobody is looking
          at is credited for nothing. Every treasure image stored today is a
          `Special:FilePath` URL, so this guards the next source, not this one. */}
      {thumbUrl && <ImageCreditLine credit={content.image_credit} redundantWith={content.artist} />}
    </Box>
  );
}
