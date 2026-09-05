/**
 * The open card: everything about one experience that does not fit its row.
 *
 * Memoised, and its props are chosen so the memo can hold. The row above it
 * re-renders whenever the pointer enters or leaves it, and this is the tallest
 * thing the list draws — 1749 px on the Historic Centre of Saint Petersburg,
 * measured in the browser. Re-rendering it for a hover on its own row rebuilt
 * the picture, the chips, the works list and every place inside it, which is
 * some 600 fibers per mouse move. Nothing here draws the hover: the places
 * subscribe to it themselves (`LocationRow`).
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Button,
  Chip,
  Tooltip,
  Alert,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  MenuBook as WikiIcon,
  Language as WebsiteIcon,
  LocationOn as LocationIcon,
  Undo as UnrejectIcon,
  Tune as CurateIcon,
  LinkOff as RemoveFromRegionIcon,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { cardImageUrl, isImagePreloaded, preloadImage } from '../../utils/imagePreload';
import { inDangerLabel } from '../../utils/dangerLabel';
import { useAuth } from '../../hooks/useAuth';
import {
  type Experience,
  type ExperienceLocation,
  type VisitedStatus,
} from '../../api/experiences';
import { experienceContentsQuery, experienceDetailsQuery } from '../../api/experienceCardQueries';
import { ImageCreditLine } from '../shared/ImageCreditLine';
import { ArtworksList } from './ArtworksList';
import { VisitedStatusButton } from './VisitedStatusButton';
import { computeVisitedStatus } from './utils';
import { CardLocationList } from './CardLocationList';
import { experienceColors } from '../../utils/categoryColors';

export interface ExperienceExpandedDetailsProps {
  experience: Experience;
  locations?: ExperienceLocation[];
  /** The batch settled — an in-region count derived from `locations` is meaningful. */
  locationsResolved: boolean;
  isLocationVisited: (locationId: number) => boolean;
  isFullyVisited: boolean;
  locationRefs: React.MutableRefObject<Map<number, HTMLElement>>;
  showCheckbox: boolean;
  onToggleAllLocations: (experienceId: number, markAsVisited: boolean) => void;
  onLocationVisitedToggle: (locationId: number, isVisited: boolean) => void;
  onLocationHover: (locationId: number | null) => void;
  onCurate?: () => void;
  onUnreject?: () => void;
  onRemoveFromRegion?: () => void;
  /**
   * Called in the layout phase whenever something inside this card changes its
   * height — the picture arriving, either cap on the places lifting — so the
   * virtualiser hears about it before the browser paints. The card opening is reported by the row; everything that happens
   * inside an open one is reported from here or from `CardLocationList`, which
   * this is handed to, because none of that state is visible above.
   */
  onHeightChange?: () => void;
  isRejected?: boolean;
}

function ExperienceExpandedDetailsComponent({
  experience,
  locations,
  locationsResolved,
  isLocationVisited,
  isFullyVisited,
  locationRefs,
  showCheckbox,
  onToggleAllLocations,
  onLocationVisitedToggle,
  onLocationHover,
  onCurate,
  onUnreject,
  onRemoveFromRegion,
  onHeightChange,
  isRejected,
}: ExperienceExpandedDetailsProps) {
  const { isAuthenticated } = useAuth();

  // These two decide part of the card's height, so the card is not mounted until
  // they have answered — `useExperienceCardReady` waits on the same keys, which is
  // why the definitions live in one place (`experienceCardQueries`). By the time
  // this renders they are in cache; issuing them here is what starts them.
  const { data: details } = useQuery(experienceDetailsQuery(experience.id));
  const { data: contentsData } = useQuery(experienceContentsQuery(experience.id));

  // Use batch locations from parent + global isLocationVisited
  const totalLocations = locations?.length ?? (experience.location_count ?? 0);

  // One stable callback for every row's ref, so a memoised row is not
  // invalidated by a fresh closure on each render.
  const registerLocationRef = useCallback((locationId: number, element: HTMLElement | null) => {
    if (element) locationRefs.current.set(locationId, element);
    else locationRefs.current.delete(locationId);
  }, [locationRefs]);

  // Build location display data with visited + in_region info from shared data
  const locationsWithRegionInfo = useMemo(() => {
    if (!locations || locations.length === 0) return [];
    return locations.map(loc => ({
      id: loc.id,
      name: loc.name,
      ordinal: loc.ordinal,
      longitude: loc.longitude,
      latitude: loc.latitude,
      isVisited: isLocationVisited(loc.id),
      inRegion: loc.in_region !== false,
      regionPath: loc.region_path ?? null,
    }));
  }, [locations, isLocationVisited]);

  // Split into in-region and out-of-region
  const inRegionLocs = useMemo(
    () => locationsWithRegionInfo.filter(l => l.inRegion),
    [locationsWithRegionInfo],
  );
  const outOfRegionLocs = useMemo(
    () => locationsWithRegionInfo.filter(l => !l.inRegion),
    [locationsWithRegionInfo],
  );
  // Count in-region locations
  const inRegionCount = inRegionLocs.length;
  const inRegionVisitedCount = inRegionLocs.filter(l => l.isVisited).length;

  // Compute visited status for multi-location badge
  const visitedLocations = locationsWithRegionInfo.filter(l => l.isVisited).length;
  const visitedStatus: VisitedStatus = computeVisitedStatus(visitedLocations, totalLocations);

  // Resolved once, by the same helper the row's hover preload calls, so the two
  // cannot ask for different files. It answers with an empty string for a remote
  // host the product may not draw from (ADR-0043), and an empty `src` is not nothing:
  // the browser resolves it against the current document, so the page would fetch
  // its own HTML and draw it as a broken picture.
  const thumbnailUrl = cardImageUrl(experience.image_url);

  // The box is given its 250 px only once the bytes are actually here, because
  // a picture can fail to arrive and a reserved box taken back moves every row
  // below. That used to be the ordinary outcome — 1260 of 1604 cards pointed at
  // a portal photograph that answered 403 — and reserving space for all of them
  // shuffled four cards in five. Since ADR-0043 every stored picture is a Commons
  // file (#557), so the failure is the exception again; the rule stays, because
  // a card that moves once is a card that moves.
  //
  // Usually the answer is already known, because hovering the row started the
  // fetch (`imagePreload.ts`), and hovering is what precedes opening. Then this
  // renders at its final size in the first frame and nothing moves afterwards. A
  // card opened without a hover — keyboard, touch, a marker click — falls back to
  // waiting, which is a late 250 px rather than a wrong 250 px.
  // Derived from the url in hand, never stored as a bare yes — the same shape
  // `useExperienceCardReady` uses, and for the same reason. A card whose picture is
  // edited to another one arrives here with a new url while a stored yes still says
  // ready, so the render before the effect corrects it would draw the *new* file
  // under the old permission: a 250 px box holding nothing, then emptied when the
  // effect runs, then filled when the bytes land. Three movements of every row
  // below, from a value that was true of a different picture.
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const imageReady = !!thumbnailUrl && (readyUrl === thumbnailUrl || isImagePreloaded(thumbnailUrl));
  useEffect(() => {
    if (!thumbnailUrl || isImagePreloaded(thumbnailUrl)) return;
    let cancelled = false;
    preloadImage(thumbnailUrl).then(ok => { if (ok && !cancelled) setReadyUrl(thumbnailUrl); });
    return () => { cancelled = true; };
  }, [thumbnailUrl]);
  // The picture, reported before paint. The row cannot do it: readiness is state
  // of this component, so React re-renders from here downward and nothing above
  // is asked to measure. The two caps report their own lifts from
  // `CardLocationList`, which is where that state lives now — and theirs is by far
  // the larger movement: lifting the in-region cap adds 73 rows on the Historic
  // Centre's ninety-three, where the picture is 266 px. The picture is reported
  // from here because it moves on two paths the gate does not cover: a card
  // opened by the cap with the bytes still in flight, and a curator editing an open
  // card's picture, where `capReached` short-circuits ahead of the image term so
  // the card cannot close to be re-gated.
  useLayoutEffect(() => {
    onHeightChange?.();
  }, [imageReady, onHeightChange]);

  const isMultiLocation = totalLocations > 1;

  // The type chip in the colour every other surface draws this object in —
  // one rule, `experienceColors`, rather than a third copy of the palette (#814).
  const typeStyle = experienceColors(experience.category_id, experience.type);

  return (
    <Box
      // A stable handle for the layout smoke spec, which has to tell "the card is
      // open" from "the row is merely tall": a wrapped title is 85 px and an opened
      // fixture card is 81.
      data-experience-card=""
      sx={{
        pl: 2,
        pr: 2,
        py: 1.5,
        bgcolor: 'grey.50',
        borderBottom: '1px solid',
        borderColor: 'divider',
        // No entrance animation, deliberately, and it was tried twice.
        //
        // A card opens at its final height with its content already loaded, so
        // anything that fades or wipes that content in leaves the space it will
        // occupy standing empty first. Frame-by-frame at 60 fps on a 600 px card,
        // a 260 ms `clip-path` reveal reads as the panel blinking: rows below drop
        // away, a large pale area stands there for four frames, then the picture
        // slides down into it. What looks graceful slowed down eight times is a
        // flash at speed, because the eye reads "large area changed" long before
        // it reads "content arriving".
        //
        // Height cannot be animated either — the row's height is measured, so
        // every intermediate value repositions every row below it, which is where
        // this started (five heights in 290 ms, stepping at about 17 fps).
        //
        // So the card is simply there, complete, in the frame it appears. The only
        // motion left is the rows below moving down once to make room for it.
      }}
    >
      {/* Image */}
      {thumbnailUrl && imageReady && (
        <Box
          component="img"
          src={thumbnailUrl}
          alt={experience.name}
          sx={{
            width: '100%',
            // A fixed height, not a maximum: by the time this renders the bytes
            // are already in cache, so the box takes its size in the frame it
            // appears and never changes it again. Measured before the picture was
            // loaded first, the row grew 282 px some 80 ms after opening, and a
            // measured row growing means every row below it moves — the reader
            // watched the list settle twice. `contain` letterboxes a wide picture
            // against the grey rather than cropping it, which is what this
            // background colour was always for.
            height: 250,
            objectFit: 'contain',
            borderRadius: 1,
            mb: 2,
            bgcolor: 'grey.100',
          }}
        />
      )}
      {/* Only with the picture: this row renders before the bytes arrive, and a
          credit under nothing would be a line about an image the reader cannot see. */}
      {thumbnailUrl && imageReady && (
        <Box sx={{ mt: -1.5, mb: 1.5 }}>
          <ImageCreditLine credit={experience.image_credit} />
        </Box>
      )}

      {/* Category & Country chips */}
      <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        {experience.type && (
          <Chip
            label={experience.type}
            size="small"
            sx={{
              bgcolor: typeStyle.bg,
              color: typeStyle.text,
              fontWeight: 500,
              textTransform: 'capitalize',
            }}
          />
        )}
        {experience.country_names?.[0] && (
          <Chip label={experience.country_names[0]} size="small" variant="outlined" />
        )}
        {experience.in_danger && (
          <Chip label={inDangerLabel(experience.danger_since)} size="small" color="error" />
        )}
        {/* Only once the batch has settled. `inRegionCount` comes from it while
            `totalLocations` falls back to `experience.location_count`, so before
            it resolves the two disagree by construction and the chip states a
            zero it has no evidence for. */}
        {isMultiLocation && locationsResolved && (
          <Chip
            label={`${inRegionCount}/${totalLocations} in region`}
            size="small"
            icon={<LocationIcon fontSize="small" />}
            variant="outlined"
            color="info"
          />
        )}
      </Box>

      {/* Description */}
      {experience.short_description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {experience.short_description}
        </Typography>
      )}

      {/* Date inscribed */}
      {details?.metadata?.dateInscribed != null && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Inscribed: {String(details.metadata.dateInscribed as string | number)}
        </Typography>
      )}

      {/* Museum description */}
      {details?.description && !experience.short_description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {details.description}
        </Typography>
      )}

      {/* Artworks / Contents list */}
      {contentsData && contentsData.treasures.length > 0 && (
        <ArtworksList contents={contentsData.treasures} total={contentsData.total} experienceId={experience.id} />
      )}

      {/* Multi-location list */}
      {isMultiLocation && locationsWithRegionInfo.length > 0 && (
        <CardLocationList
          inRegionLocs={inRegionLocs}
          outOfRegionLocs={outOfRegionLocs}
          showCheckbox={showCheckbox}
          isAuthenticated={isAuthenticated}
          inRegionVisitedCount={inRegionVisitedCount}
          onLocationHover={onLocationHover}
          onLocationVisitedToggle={onLocationVisitedToggle}
          registerRef={registerLocationRef}
          onHeightChange={onHeightChange}
        />
      )}

      {/* Rejection reason (when viewing rejected item) */}
      {isRejected && experience.rejection_reason && (
        <Alert severity="warning" sx={{ mb: 1.5, py: 0 }} variant="outlined">
          <Typography variant="caption">
            Rejected: {experience.rejection_reason}
          </Typography>
        </Alert>
      )}

      {/* Actions */}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Disabled until the batch settles, for the same reason as the row
            checkbox and with the same consequence: `isFullyVisited` comes from
            `inRegionVisitedStatus`, which an unresolved batch short-circuits to
            'not_visited'. The button would then read "Mark Visited" for an
            experience already visited, and pass `!isFullyVisited` — always
            true — so it could be re-marked and never unmarked, and the click
            would look inert. This is the single-location path, which is most
            rows: `totalLocations` falls back to `experience.location_count`, so
            it renders long before any location has arrived. */}
        {isAuthenticated && showCheckbox && !isMultiLocation && (
          <Button
            variant={isFullyVisited ? 'outlined' : 'contained'}
            size="small"
            disabled={!locationsResolved}
            onClick={(e) => {
              e.stopPropagation();
              onToggleAllLocations(experience.id, !isFullyVisited);
            }}
            startIcon={isFullyVisited ? <CheckCircleIcon /> : null}
            color={isFullyVisited ? 'success' : 'primary'}
          >
            {isFullyVisited ? 'Visited' : 'Mark Visited'}
          </Button>
        )}
        {/* And withheld entirely rather than shown as `0/N Visited`, which is
            the same confident zero the ratio chip above no longer states. */}
        {isAuthenticated && showCheckbox && isMultiLocation && locationsResolved && (
          <VisitedStatusButton
            visitedStatus={visitedStatus}
            visitedCount={visitedLocations}
            totalCount={totalLocations}
          />
        )}
        {(() => {
          const metadata = details?.metadata;
          const wikiUrl = typeof metadata?.wikipediaUrl === 'string' && metadata.wikipediaUrl ? metadata.wikipediaUrl : null;
          const websiteUrl = typeof metadata?.website === 'string' && metadata.website ? metadata.website : null;

          return (
            <>
              {wikiUrl && (
                <IconButton size="small" component="a" href={wikiUrl} target="_blank" rel="noopener noreferrer" title="Wikipedia">
                  <WikiIcon fontSize="small" />
                </IconButton>
              )}
              {websiteUrl && websiteUrl !== wikiUrl && (
                <IconButton size="small" component="a" href={websiteUrl} target="_blank" rel="noopener noreferrer" title="Official website">
                  <WebsiteIcon fontSize="small" />
                </IconButton>
              )}
            </>
          );
        })()}

        {/* Curator actions */}
        {onCurate && !isRejected && (
          <Tooltip title="Edit, reject, or manage this experience">
            <Button
              size="small"
              variant="outlined"
              startIcon={<CurateIcon />}
              onClick={(e) => { e.stopPropagation(); onCurate(); }}
              sx={{ ml: 'auto' }}
            >
              Curate
            </Button>
          </Tooltip>
        )}
        {onUnreject && isRejected && (
          <Button
            size="small"
            variant="outlined"
            color="success"
            startIcon={<UnrejectIcon />}
            onClick={(e) => { e.stopPropagation(); onUnreject(); }}
            sx={{ ml: 'auto' }}
          >
            Unreject
          </Button>
        )}
        {onRemoveFromRegion && isRejected && (
          <Tooltip title="Remove from this region entirely">
            <IconButton
              size="small"
              color="error"
              onClick={(e) => { e.stopPropagation(); onRemoveFromRegion(); }}
            >
              <RemoveFromRegionIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {onCurate && isRejected && (
          <Tooltip title="Edit or manage this experience">
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); onCurate(); }}
            >
              <CurateIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Box>
  );
}

export const ExperienceExpandedDetails = memo(ExperienceExpandedDetailsComponent);
