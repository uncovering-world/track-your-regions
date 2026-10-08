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
import { Box, Button, Chip, List, TextField, Typography } from '@mui/material';
import { ExpandMore, ChevronRight } from '@mui/icons-material';
import { foldLabel } from '@tyr/shared/labels';
import { filterParts, groupParts } from '../../utils/partGroups';
import { locationLabelWithRef, pointOfRow } from '../../utils/locationLabel';
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

/**
 * Above this many places a card offers a search, a "with a photo" filter and
 * groups for the places outside the region (#1271): Prehistoric Pile Dwellings
 * around the Alps lists 111, and a flat list of 109 outside Aargau is a list
 * nobody reads. At ten or fewer, the list is already all of it.
 */
export const CARD_BROWSE_THRESHOLD = 10;

/** The places a group shows before "Show all", as the in-region list does. */
const GROUP_INITIAL = IN_REGION_INITIAL;

/**
 * A place's region path below its group, which already names the rest: a part
 * in the Andalucía group reads its province, and nothing where Andalucía is
 * the deepest level the path has.
 */
function pathBelow(path: string | null | undefined, group: string): string | null {
  const levels = (path ?? '').split(' > ');
  const at = levels.indexOf(group);
  return at === -1 ? (path ?? null) : levels.slice(at + 1).join(' > ');
}

/** What the search reads of a place: its name, or its reference where it has none, and the reference. */
const searchText = (loc: LocationRowData) => locationLabelWithRef(pointOfRow(loc));

export interface CardLocationListProps {
  /** The object these places belong to, which each one's copied full name begins with. */
  objectName: string;
  inRegionLocs: LocationRowData[];
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
  /** Open a place on a card of its own (#1271), handed to every row unchanged. */
  onOpen?: (pointId: number, pointName: string) => void;
  /** A curator's way into correcting a place, handed to every row unchanged. */
  onCorrect?: (location: LocationRowData) => void;
}

export function CardLocationList({
  objectName,
  inRegionLocs,
  outOfRegionLocs,
  showCheckbox,
  isAuthenticated,
  inRegionVisitedCount,
  onLocationHover,
  onLocationVisitedToggle,
  registerRef,
  onHeightChange,
  onOpen,
  onCorrect,
}: CardLocationListProps) {
  const { store: hoverStore } = useHoverActions();
  const [outOfRegionExpanded, setOutOfRegionExpanded] = useState(false);
  const [inRegionExpanded, setInRegionExpanded] = useState(false);
  // Browsing many places (#1271): a search, a "with a photo" filter, and the
  // places outside the region in groups that open one at a time.
  const [search, setSearch] = useState('');
  const [photoOnly, setPhotoOnly] = useState(false);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const [allShownGroups, setAllShownGroups] = useState<ReadonlySet<string>>(new Set());
  const browsable = inRegionLocs.length + outOfRegionLocs.length > CARD_BROWSE_THRESHOLD;
  const filtering = browsable && (search.trim() !== '' || photoOnly);
  const visibleInRegion = useMemo(
    () => (browsable ? filterParts(inRegionLocs, search, photoOnly, foldLabel, searchText) : inRegionLocs),
    [browsable, inRegionLocs, search, photoOnly],
  );
  const visibleOutOfRegion = useMemo(
    () => (browsable ? filterParts(outOfRegionLocs, search, photoOnly, foldLabel, searchText) : outOfRegionLocs),
    [browsable, outOfRegionLocs, search, photoOnly],
  );
  const groups = useMemo(() => (browsable ? groupParts(visibleOutOfRegion) : []), [browsable, visibleOutOfRegion]);
  const withPhotoCount = useMemo(
    () => inRegionLocs.filter(l => l.hasPicture).length + outOfRegionLocs.filter(l => l.hasPicture).length,
    [inRegionLocs, outOfRegionLocs],
  );
  const toggleIn = (set: ReadonlySet<string>, label: string) => {
    const next = new Set(set);
    if (next.has(label)) next.delete(label); else next.add(label);
    return next;
  };
  const shownInRegionLocs = inRegionExpanded || filtering
    ? visibleInRegion
    : visibleInRegion.slice(0, IN_REGION_INITIAL);

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
  }, [inRegionExpanded, outOfRegionExpanded, search, photoOnly, openGroups, allShownGroups, onHeightChange]);

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
      {browsable && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder="Find a place"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            slotProps={{ htmlInput: { 'aria-label': 'Find a place' } }}
            sx={{ flex: 1, minWidth: 140 }}
          />
          {withPhotoCount > 0 && (
            <Chip
              size="small"
              label={`With a photo · ${withPhotoCount}`}
              color={photoOnly ? 'primary' : 'default'}
              variant={photoOnly ? 'filled' : 'outlined'}
              onClick={() => setPhotoOnly(!photoOnly)}
              aria-pressed={photoOnly}
            />
          )}
        </Box>
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
            objectName={objectName}
            showCheckbox={isAuthenticated && showCheckbox}
            onHover={onLocationHover}
            onVisitedToggle={onLocationVisitedToggle}
            registerRef={registerRef}
            onOpen={onOpen}
            onCorrect={onCorrect}
          />
        ))}
        {!filtering && inRegionLocs.length > IN_REGION_INITIAL && (
          <ShowMoreRow
            tone="grey.50"
            onClick={() => setInRegionExpanded(!inRegionExpanded)}
            label={inRegionExpanded
              ? 'Show fewer places'
              : `Show all ${inRegionLocs.length} places`}
          />
        )}

        {/* Outside the region, in groups that open one at a time where there are
            many places (#1271): the countries of the pile dwellings, the
            communities of the rock art. A search or the photo filter opens them
            all, since what it left is what the reader asked for. */}
        {browsable && visibleOutOfRegion.length > 0 && (
          <>
            <Box
              component="li"
              sx={{ listStyle: 'none', px: 1.5, py: 0.5, bgcolor: 'grey.100', borderTop: '1px solid', borderColor: 'divider' }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                {visibleOutOfRegion.length} outside region
              </Typography>
            </Box>
            {groups.map((group) => {
              const open = filtering || openGroups.has(group.label);
              const allShown = allShownGroups.has(group.label);
              const shown = allShown ? group.parts : group.parts.slice(0, GROUP_INITIAL);
              return (
                <Box component="li" key={group.label} sx={{ listStyle: 'none' }}>
                  <Button
                    fullWidth
                    onClick={(event) => {
                      const header = event.currentTarget;
                      setOpenGroups(toggleIn(openGroups, group.label));
                      // The browser anchors the scroll to whatever sits below,
                      // so a group opening above it pushes its own header out of
                      // view; bring the header back to where the reader is.
                      requestAnimationFrame(() => header.scrollIntoView?.({ block: 'nearest' }));
                    }}
                    aria-expanded={open}
                    startIcon={open ? <ExpandMore fontSize="small" /> : <ChevronRight fontSize="small" />}
                    sx={{
                      justifyContent: 'flex-start', textTransform: 'none', borderRadius: 0, py: 0.25,
                      borderTop: '1px solid', borderColor: 'divider', color: 'text.primary',
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 500, flex: 1, textAlign: 'left' }}>
                      {group.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {group.parts.length}{group.withPicture > 0 ? ` · ${group.withPicture} with a photo` : ''}
                    </Typography>
                  </Button>
                  {open && (
                    <Box component="ul" sx={{ p: 0, m: 0 }}>
                      {shown.map((loc) => (
                        <LocationRow
                          key={loc.id}
                          location={loc}
                          objectName={objectName}
                          showCheckbox={false}
                          outOfRegion
                          regionPath={pathBelow(loc.regionPath, group.label)}
                          onHover={onLocationHover}
                          onVisitedToggle={onLocationVisitedToggle}
                          registerRef={registerRef}
                          onOpen={onOpen}
                          onCorrect={onCorrect}
                        />
                      ))}
                      {group.parts.length > GROUP_INITIAL && (
                        <ShowMoreRow
                          tone="grey.100"
                          onClick={() => setAllShownGroups(toggleIn(allShownGroups, group.label))}
                          label={allShown ? 'Show fewer' : `Show all ${group.parts.length} in ${group.label}`}
                        />
                      )}
                    </Box>
                  )}
                </Box>
              );
            })}
          </>
        )}
        {browsable && filtering && visibleInRegion.length === 0 && visibleOutOfRegion.length === 0 && (
          <Box component="li" sx={{ listStyle: 'none', px: 1.5, py: 1 }}>
            <Typography variant="caption" color="text.secondary">No place matches</Typography>
          </Box>
        )}

        {/* Out-of-region locations (collapsible) */}
        {!browsable && outOfRegionLocs.length > 0 && (
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
                objectName={objectName}
                showCheckbox={false}
                outOfRegion
                regionPath={outOfRegionDisplayPaths.get(loc.id)}
                onHover={onLocationHover}
                onVisitedToggle={onLocationVisitedToggle}
                registerRef={registerRef}
                onOpen={onOpen}
                onCorrect={onCorrect}
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
