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
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import LocationIcon from '@mui/icons-material/LocationOn';
import UnrejectIcon from '@mui/icons-material/Undo';
import CurateIcon from '@mui/icons-material/Tune';
import RemoveFromRegionIcon from '@mui/icons-material/LinkOff';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router';
import { cardImageUrl, isImagePreloaded, preloadImage } from '../../utils/imagePreload';
import { inDangerLabel } from '../../utils/dangerLabel';
import { cardUrl } from '../../utils/appUrl';
import { useAuth } from '../../hooks/useAuth';
import {
  type Experience,
  type RegionExperienceLocation,
  type ExperienceTreasure,
} from '../../api/experiences';
import type { VisitedStatus } from '../../api/visited';
import { experienceContentsQuery, experienceDetailsQuery, siteFindsQuery } from '../../api/experienceCardQueries';
import { ImageCreditLine } from '../shared/ImageCreditLine';
import { ExtentLine } from '../shared/ExtentLine';
import { CommemoratesLine } from '../shared/CommemoratesLine';
import { DescriptionText } from '../shared/DescriptionText';
import { PartOfLine } from '../shared/PartOfLine';
import { LazyPlaceParts } from '../curation/parts/LazyPlaceParts';
import { PlaceLinks } from '../shared/PlaceLinks';
import { descriptionBeyondSubtitle } from '../shared/PlaceSubtitle';
import { OpenInMapsLink } from '../shared/OpenInMapsLink';
import { ApproximateLocationNote } from '../shared/ApproximateLocationNote';
import { ShareButton } from '../shared/ShareButton';
import { ArtworksList } from './ArtworksList';
import { SiteFindsList } from './SiteFindsList';
import { VisitedStatusButton } from './VisitedStatusButton';
import { VISIT_BUTTON_LABEL, offersWholeTick } from '../shared/visitWords';
import { WholeVisitButton } from '../shared/WholeVisitButton';
import { LazyTripsSection } from '../shared/lazyVisitTrips';
import { useVisitedExperiences } from '../../hooks/useVisitedExperiences';
import { CardLocationList } from './CardLocationList';
import type { LocationRowData } from './LocationRow';
import { typeChipsFor } from './typeChips';
import { cardAsksFinds, standsInWorldHeritage } from '../../utils/placeKinds';

export interface ExperienceExpandedDetailsProps {
  experience: Experience;
  /**
   * The card stands above the list's groups, over every kind of its place, so
   * it names each of them — its type there, or the kind where it has none —
   * rather than the one kind a row shows (#1262).
   */
  everyKind?: boolean;
  locations?: RegionExperienceLocation[];
  /** The batch settled — an in-region count derived from `locations` is meaningful. */
  locationsResolved: boolean;
  isLocationVisited: (locationId: number) => boolean;
  locationRefs: React.MutableRefObject<Map<number, HTMLElement>>;
  showCheckbox: boolean;
  /** Tick the place itself, or take its own tick back (#2120). */
  onTogglePlace: (experienceId: number, tick: boolean) => void;
  /** Mark or unmark a whole's places in the region (#2120). */
  onToggleAllLocations: (experienceId: number, markAsVisited: boolean) => void;
  /** A visit write is on its way, as the row's controls know it. */
  visitWritePending?: boolean;
  onLocationVisitedToggle: (locationId: number, isVisited: boolean) => void;
  onLocationHover: (locationId: number | null) => void;
  onCurate?: () => void;
  /** Open one of the places listed below on a card of its own (#1271). */
  onOpenPlace?: (pointId: number, pointName: string) => void;
  /** A curator's way into correcting one of the places listed below. */
  onCorrectPlace?: (location: LocationRowData) => void;
  /** And into correcting one of the works, which is the same rule one level over (#731). */
  onCorrectWork?: (work: ExperienceTreasure) => void;
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
  everyKind = false,
  locations,
  locationsResolved,
  isLocationVisited,
  locationRefs,
  showCheckbox,
  onTogglePlace,
  onToggleAllLocations,
  visitWritePending = false,
  onLocationVisitedToggle,
  onLocationHover,
  onCurate,
  onOpenPlace,
  onCorrectPlace,
  onCorrectWork,
  onUnreject,
  onRemoveFromRegion,
  onHeightChange,
  isRejected,
}: ExperienceExpandedDetailsProps) {
  const { isAuthenticated } = useAuth();
  const { pathname, search } = useLocation();
  const sharePath = cardUrl(pathname, search, experience);
  const shareUrl = sharePath && `${window.location.origin}${sharePath}`;

  // These two decide part of the card's height, so the card is not mounted until
  // they have answered — `useExperienceCardReady` waits on the same keys, which is
  // why the definitions live in one place (`experienceCardQueries`). By the time
  // this renders they are in cache; issuing them here is what starts them.
  const { data: details } = useQuery(experienceDetailsQuery(experience.id));
  const description = descriptionBeyondSubtitle(experience);
  const { data: contentsData } = useQuery(experienceContentsQuery(experience.id));
  // The third, for a site (#894) or a place a curator linked finds to (#2242):
  // the finds of the place and where they are shown. Decided off the row,
  // before any read, and waited on by the same gate (`cardAsksFinds`), so the
  // list is in the card the frame it opens.
  const { data: findsData } = useQuery({
    ...siteFindsQuery(experience.id),
    enabled: cardAsksFinds(experience, everyKind),
  });

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
      externalRef: loc.external_ref,
      ordinal: loc.ordinal,
      longitude: loc.longitude,
      latitude: loc.latitude,
      curatedFields: loc.curated_fields,
      approximate: loc.approximate,
      hasPicture: Boolean(loc.image_url),
      articleUrl: loc.wikipedia_url,
      isVisited: isLocationVisited(loc.id),
      inRegion: loc.in_region,
      regionPath: loc.region_path,
    }));
  }, [locations, isLocationVisited]);

  const onlyPoint = totalLocations === 1 ? locationsWithRegionInfo[0] ?? null : null;

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

  // The place's own state, the one read its row and Discover draw from (#2120).
  const visitedLocations = locationsWithRegionInfo.filter(l => l.isVisited).length;
  const { visitedStatusOf, isWholeTicked } = useVisitedExperiences();
  const visitedStatus: VisitedStatus = visitedStatusOf(experience.id);

  // Resolved once, by the same helper the row's hover preload calls, so the two
  // cannot ask for different files. It answers with an empty string for a remote
  // host the product may not draw from (ADR-0043), and an empty `src` is not nothing:
  // the browser resolves it against the current document, so the page would fetch
  // its own HTML and draw it as a broken picture.
  const thumbnailUrl = cardImageUrl(experience.image_url);

  // The box is given its 250 px only once the bytes are actually here, because
  // a picture can fail to arrive and a reserved box taken back moves every row
  // below. Every stored picture is a Commons file (ADR-0043, #557), so a
  // failure is the exception; the rule stays anyway, because a card that moves
  // once is a card that moves.
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
  // A whole lists its places even where it shows one, since they are what a
  // traveller ticks it by (#2120).
  const listsPlaces = isMultiLocation || experience.has_parts;
  // A whole's places in this region, marked or unmarked together; its places
  // elsewhere are left alone (#2120).
  const inRegionActions = experience.has_parts
    ? {
      onMarkAllInRegion: () => onToggleAllLocations(experience.id, true),
      onUnmarkAllInRegion: () => onToggleAllLocations(experience.id, false),
    }
    : {};

  // The row's own type, or every kind of the place beside its type on the card
  // above the groups (#1915) — built where the two cards' rule is stated once.
  const typeChips = typeChipsFor(experience, everyKind);

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
            // background colour is for.
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
          <ImageCreditLine credit={experience.image_credit} surface="line" />
        </Box>
      )}

      {/* Kind & Country chips */}
      <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        {typeChips.map(chip => (
          <Chip
            key={chip.key}
            label={chip.label}
            size="small"
            sx={{ bgcolor: chip.style.bg, color: chip.style.text, fontWeight: 500 }}
          />
        ))}
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

      {/* Description: the paragraph; the subtitle is on the row above the card */}
      <DescriptionText text={description} source={experience.description_source} adapted={experience.description_adapted} />
      {/* The whole it is a part of, and how many places that is (#2118). */}
      <PartOfLine partOf={details?.part_of} />

      {/* Date inscribed */}
      {details?.date_inscribed != null && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Inscribed: {details.date_inscribed}
        </Typography>
      )}

      {/* Whom or what it commemorates (#2144), and the people and figures the
          work shows (#2404, #2436), from the same detail read. */}
      <CommemoratesLine subjects={details?.commemorates} />
      <CommemoratesLine subjects={details?.depicts} word="Depicts" />

      {/* How much ground it covers, and whose map says so (ADR-0059). Rendered
          from the detail read the card already issues. */}
      <ExtentLine areaKm2={details?.area_km2} />

      {/* The place's pages, in words, on a line of their own (#1190). */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1, ml: -0.5, '&:empty': { display: 'none' } }}>
        <PlaceLinks metadata={details?.metadata} />
        {/* A place of one point goes to a maps app from here; a place of several,
            from each place's row (#1194). */}
        {onlyPoint && <OpenInMapsLink point={onlyPoint} label={experience.name} />}
      </Box>
      {/* Where the maps link leads only roughly, the card says so (#1912). */}
      <ApproximateLocationNote reason={onlyPoint?.approximate} />

      {/* What comes from this site and where a traveller sees it — a site's
          counterpart of the works list below, which a site never has. */}
      {findsData && findsData.finds.length > 0 && (
        <SiteFindsList finds={findsData.finds} />
      )}

      {/* Artworks / Contents list */}
      {contentsData && contentsData.treasures.length > 0 && (
        <ArtworksList
          contents={contentsData.treasures}
          total={contentsData.total}
          experienceId={experience.id}
          kindId={everyKind ? null : experience.kind_id}
          placeKinds={experience.kinds}
          onCorrect={onCorrectWork}
        />
      )}

      {/* Multi-location list */}
      {listsPlaces && locationsWithRegionInfo.length > 0 && (
        <CardLocationList
          objectName={experience.name}
          inRegionLocs={inRegionLocs}
          outOfRegionLocs={outOfRegionLocs}
          showCheckbox={showCheckbox}
          isAuthenticated={isAuthenticated}
          inRegionVisitedCount={inRegionVisitedCount}
          {...inRegionActions}
          visitWritePending={visitWritePending}
          onLocationHover={onLocationHover}
          onLocationVisitedToggle={onLocationVisitedToggle}
          registerRef={registerLocationRef}
          onHeightChange={onHeightChange}
          onOpen={onOpenPlace}
          onCorrect={onCorrectPlace}
        />
      )}

      {/* A curator's Parts and Part of, on the card itself (#2118). */}
      {onCurate && !isRejected && (
        <LazyPlaceParts
          experienceId={experience.id}
          regionId={null}
          isSite={standsInWorldHeritage(experience)}
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
        {/* The place's own tick, the row checkbox's (#2120). */}
        {isAuthenticated && showCheckbox && !listsPlaces && (
          <Button
            variant={visitedStatus === 'not_visited' ? 'contained' : 'outlined'}
            size="small"
            disabled={visitWritePending}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePlace(experience.id, visitedStatus === 'not_visited');
            }}
            startIcon={visitedStatus === 'visited' ? <CheckCircleIcon /> : null}
            color={visitedStatus === 'visited' ? 'success' : 'primary'}
          >
            {VISIT_BUTTON_LABEL[visitedStatus]}
          </Button>
        )}
        {/* And withheld entirely rather than shown as `0/N Visited`, which is
            the same confident zero the ratio chip above no longer states. */}
        {isAuthenticated && showCheckbox && listsPlaces && locationsResolved && (
          <VisitedStatusButton
            visitedStatus={visitedStatus}
            visitedCount={visitedLocations}
            totalCount={totalLocations}
            castPoints={experience.cast_points}
          />
        )}
        {/* A whole ticked without naming a part, on its card and never its row. */}
        {isAuthenticated && showCheckbox && offersWholeTick(experience, details) && (
          <WholeVisitButton
            disabled={visitWritePending}
            ticked={isWholeTicked(experience.id)}
            onToggle={() => onTogglePlace(experience.id, !isWholeTicked(experience.id))}
          />
        )}
        {/* The visitor's second verb, beside the first: send the place (#1192).
            Only where the page's address can name this card. */}
        {shareUrl && <ShareButton url={shareUrl} title={experience.name} />}

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

      {/* The trips of the traveller's own visit, newest first, each with its date (#2120). */}
      {isAuthenticated && showCheckbox && <LazyTripsSection experienceId={experience.id} />}
    </Box>
  );
}

export const ExperienceExpandedDetails = memo(ExperienceExpandedDetailsComponent);
