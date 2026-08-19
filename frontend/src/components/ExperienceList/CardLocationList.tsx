/**
 * The places of one object, as an open card lists them.
 *
 * Split out of `ExperienceExpandedDetails`, which had grown past the size rule
 * in `docs/tech/development-guide.md`. This is the part that stands on its own:
 * two lists, two caps, and the state that lifts them.
 *
 * It owns that state rather than taking it, because the card above has no use
 * for it — and one of the two lifts happens without anyone clicking, when a
 * hover from the map names a place the cap is hiding.
 */

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Box, Button, List, Typography } from '@mui/material';
import { subscribeToHoverTarget, useHoverActions } from '../../hooks/useHoverContext';
import { LocationRow, type LocationRowData } from './LocationRow';
import {
  IN_REGION_INITIAL,
  OUT_OF_REGION_INITIAL,
  hoverRevealsCappedPlace,
} from './utils';

/**
 * "Show all 93 places", and the same control under the out-of-region list.
 *
 * A `Button` inside an `li`, not a clickable `Box`. This is the only way to the
 * places past the cap, and a `Box` carrying an `onClick` cannot be reached from
 * a keyboard at all — no focus, no Enter, no Space. The `li` is what the `List`
 * around it renders a `ul` for; a bare `div` there is a child a `ul` may not
 * have. Kept to the original height so the row still reads as a quiet footer
 * rather than a button bar.
 */
function ShowMoreRow({ label, tone, onClick }: {
  label: string;
  tone: string;
  onClick: () => void;
}) {
  return (
    <Box component="li" sx={{ listStyle: 'none' }}>
      <Button
        fullWidth
        onClick={onClick}
        sx={{
          py: 0.25,
          minHeight: 0,
          borderRadius: 0,
          textTransform: 'none',
          bgcolor: tone,
          '&:hover': { bgcolor: 'grey.200' },
        }}
      >
        <Typography variant="caption" color="primary">{label}</Typography>
      </Button>
    </Box>
  );
}

export interface CardLocationListProps {
  inRegionLocs: (LocationRowData & { longitude: number; latitude: number })[];
  outOfRegionLocs: (LocationRowData & { regionPath: string | null })[];
  showCheckbox: boolean;
  isAuthenticated: boolean;
  inRegionVisitedCount: number;
  onLocationHover: (locationId: number | null) => void;
  onLocationVisitedToggle: (locationId: number, isVisited: boolean) => void;
  registerRef: (locationId: number, element: HTMLElement | null) => void;
  /**
   * Said in the layout phase whenever a cap is lifted, so the list's virtualiser
   * hears about the card's new height before the browser paints it.
   */
  onHeightChange?: () => void;
}

export function CardLocationList({
  inRegionLocs,
  outOfRegionLocs,
  showCheckbox,
  isAuthenticated,
  inRegionVisitedCount,
  onLocationHover,
  onLocationVisitedToggle,
  registerRef,
  onHeightChange,
}: CardLocationListProps) {
  const { store: hoverStore } = useHoverActions();
  const [outOfRegionExpanded, setOutOfRegionExpanded] = useState(false);
  const [inRegionExpanded, setInRegionExpanded] = useState(false);
  const shownInRegionLocs = inRegionExpanded
    ? inRegionLocs
    : inRegionLocs.slice(0, IN_REGION_INITIAL);

  /**
   * A pin hovered on the map opens the rest of the list if its place is in it.
   *
   * The cap costs nothing a reader can see until the hover comes from the *map*:
   * that hover names a place, the place's row draws it, and a row that was never
   * mounted draws nothing. See `hoverRevealsCappedPlace` for the rule and why a
   * hover from the list can never need it.
   */
  useEffect(() => {
    const ids = inRegionLocs.map(loc => loc.id);
    return subscribeToHoverTarget(hoverStore, ({ hoveredLocationId, hoverSource }) => {
      if (hoverRevealsCappedPlace(ids, hoveredLocationId, hoverSource)) {
        setInRegionExpanded(true);
      }
    });
  }, [hoverStore, inRegionLocs]);

  // Lifting either cap changes the card's height, and the row that holds the
  // card cannot see this state — so the report is made from here.
  useLayoutEffect(() => {
    onHeightChange?.();
  }, [inRegionExpanded, outOfRegionExpanded, onHeightChange]);

  /**
   * Where an out-of-region place is, minus what every one of them shares: if all
   * of them sit in Europe, "Europe > " helps nobody and costs the width the
   * useful part needs. One left alone keeps its full path — there is nothing to
   * have in common with.
   */
  const outOfRegionDisplayPaths = useMemo(() => {
    const paths = outOfRegionLocs.map(l => l.regionPath);
    if (paths.length <= 1) {
      // Single location or none — show full path
      return new Map(outOfRegionLocs.map(l => [l.id, l.regionPath]));
    }
    // Split into segments and find common prefix length
    const segmented = paths.map(p => p?.split(' > ') ?? []);
    const firstSegs = segmented[0];
    let commonLen = 0;
    for (let i = 0; i < firstSegs.length; i++) {

      if (segmented.every(s => s[i] === firstSegs[i])) {
        commonLen = i + 1;
      } else {
        break;
      }
    }
    return new Map(outOfRegionLocs.map((l, idx) => {

      const segs = segmented[idx];
      const trimmed = segs.slice(commonLen).join(' > ');
      return [l.id, trimmed || l.regionPath];
    }));
  }, [outOfRegionLocs]);

  const inRegionCount = inRegionLocs.length;

  return (
    <Box sx={{ mb: 2 }}>
      {isAuthenticated && showCheckbox && (
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
          In this region: {inRegionVisitedCount}/{inRegionCount} visited
        </Typography>
      )}
      {!isAuthenticated && (
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
          {inRegionCount} location{inRegionCount !== 1 ? 's' : ''} in this region
        </Typography>
      )}
      <List
        dense
        disablePadding
        sx={{ bgcolor: 'white', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
        onMouseLeave={() => onLocationHover(null)}
      >
        {/* In-region locations. Capped until asked, because a serial site mounts
            every one of them into an open card: the Historic Centre of Saint
            Petersburg carries 112, and mounting them cost 432 ms and made
            hovering the card feel stuck. Discover's panel answers the same
            problem by virtualising; here the card's height is measured by the
            list's own virtualiser, so a cap with a way past it is the honest
            version — the out-of-region list below has used exactly this shape
            all along. */}
        {shownInRegionLocs.map((loc) => (
          <LocationRow
            key={loc.id}
            location={loc}
            showCheckbox={isAuthenticated && showCheckbox}
            onHover={onLocationHover}
            onVisitedToggle={onLocationVisitedToggle}
            registerRef={registerRef}
          />
        ))}
        {inRegionLocs.length > IN_REGION_INITIAL && (
          <ShowMoreRow
            tone="grey.50"
            onClick={() => setInRegionExpanded(!inRegionExpanded)}
            label={inRegionExpanded
              ? 'Show fewer places'
              : `Show all ${inRegionLocs.length} places`}
          />
        )}

        {/* Out-of-region locations (collapsible) */}
        {outOfRegionLocs.length > 0 && (
          <>
            {/* An `li`, like every other child of this `List`: the heading is one
                item of the list rather than a `div` a `ul` may not have. */}
            <Box
              component="li"
              sx={{
                listStyle: 'none',
                px: 1.5,
                py: 0.5,
                bgcolor: 'grey.100',
                borderTop: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                {outOfRegionLocs.length} outside region
              </Typography>
            </Box>
            {(outOfRegionExpanded ? outOfRegionLocs : outOfRegionLocs.slice(0, OUT_OF_REGION_INITIAL)).map((loc) => (
              <LocationRow
                key={loc.id}
                location={loc}
                showCheckbox={false}
                outOfRegion
                regionPath={outOfRegionDisplayPaths.get(loc.id)}
                onHover={onLocationHover}
                onVisitedToggle={onLocationVisitedToggle}
                registerRef={registerRef}
              />
            ))}
            {outOfRegionLocs.length > OUT_OF_REGION_INITIAL && (
              <ShowMoreRow
                tone="grey.100"
                onClick={() => setOutOfRegionExpanded(!outOfRegionExpanded)}
                label={outOfRegionExpanded
                  ? 'Show less'
                  : `Show ${outOfRegionLocs.length - OUT_OF_REGION_INITIAL} more`}
              />
            )}
          </>
        )}
      </List>
    </Box>
  );
}
