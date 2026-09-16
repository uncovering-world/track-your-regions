/**
 * The world layer's chrome: which kind the map draws, and whether a serial site
 * is its places or one pin (#910).
 *
 * One file and one component, because the two chips answer one question
 * together — what is on this map — and `RegionMapVT` is already the map's
 * chrome, its four tile sources and its loading states.
 *
 * The question the world layer exists to answer is "where in the world is this
 * kind of place", so the control is the kinds themselves rather than a menu:
 * each chip carries the colour its pins are drawn in, which is what makes *All
 * kinds* readable — a map of five colours is a map of five kinds, and the
 * legend is the control.
 *
 * The count beside a name is the kind's own (`GET /api/experiences/kinds`) and
 * is the number of **objects**, which is what the catalogue is counted in
 * everywhere a reader meets a count. The map draws places, and a serial site is
 * one object and hundreds of them; the two numbers are different questions and
 * the chip answers the one the rest of the product answers.
 *
 * Top left, where a region's own card sits once one is selected — the two are
 * never on screen together, because choosing a region is what takes this layer
 * off the map.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Box, Chip } from '@mui/material';
import type { ExperienceKind } from '../../api/experiences';
import { kindColor, shortKindName } from '../../utils/kindColors';
import { FoldChip } from '../experienceMarkers/FoldPlacesControl';
import type { WorldLayerState } from './useWorldLayer';

export function WorldLayerControls({ world }: { world: WorldLayerState }) {
  return (
    <WorldKindControl kinds={world.kinds} selected={world.kindId} onSelect={world.setKind}>
      {/* The same chip the per-object fold uses, in this layer's own row rather
          than floating at the top centre. What it says is about the map rather
          than about one object — the world map's answer to the Rock Art of the
          Mediterranean Basin drawing 734 of the pins in Aragón — and it belongs
          beside the kinds for the same reason: together they are what this map
          is showing.

          Also the only arrangement in which the two cannot collide. Floated, the
          chip is centred and the kind box is 340 px from the left, so they
          overlapped on any map pane under about 873 px — measured at 820, where
          the chip sat over "Art Museums 124" and, being the higher z-index, took
          the click with it. A row that wraps has no such width. */}
      <FoldChip
        inline
        folded={world.folded}
        label={world.folded ? 'Show every place' : 'Show one pin per site'}
        onToggle={world.toggleFold}
      />
    </WorldKindControl>
  );
}

/**
 * How far down the map's own chrome reaches, as a CSS variable on the map pane.
 *
 * The hover preview card places itself in the top-left corner whenever the
 * pointer is in the bottom-right one, and the number it cleared was the region
 * card's fixed height. This band is not fixed: seven small chips capped at
 * 340 px wrap to three rows at *every* pane width, so its bottom edge is 96 px
 * where the region card's is 78 — and the card, at the higher z-index, landed
 * on the row that says which kind is on the map.
 *
 * Published rather than agreed on, so neither side carries the other's number:
 * the band measures itself and the card reads whatever is there, falling back
 * to the region card's height when nothing is.
 */
const CHROME_BOTTOM_VAR = '--tyr-map-chrome-bottom';

/**
 * The one band the world layer's controls sit in: top left, where a region's own
 * card sits once one is selected — the two are never on screen together, because
 * choosing a region is what takes this layer off the map.
 *
 * It wraps, and everything in it wraps with it, which is what keeps the controls
 * from ever overlapping each other however narrow the map pane is. The 96 px
 * held back on the right is the zoom controls' corner.
 */
const CONTROL_BAND = {
  position: 'absolute',
  top: 16,
  left: 16,
  zIndex: 2,
  maxWidth: 'min(340px, calc(100% - 96px))',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 0.5,
} as const;

interface WorldKindControlProps {
  kinds: ExperienceKind[];
  /** null is every kind at once. */
  selected: number | null;
  onSelect: (kindId: number | null) => void;
  /** Whatever else belongs in this band — today the fold chip. */
  children?: ReactNode;
}

function WorldKindControl({ kinds, selected, onSelect, children }: WorldKindControlProps) {
  const band = useRef<HTMLDivElement>(null);

  // Measured rather than computed: the band's height follows the kind count,
  // the pane's width and the chips' own text, none of which this file decides.
  useEffect(() => {
    const element = band.current;
    const pane = element?.offsetParent as HTMLElement | null;
    if (!element || !pane) return undefined;
    const publish = () => {
      pane.style.setProperty(CHROME_BOTTOM_VAR, `${Math.round(element.offsetTop + element.offsetHeight)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      // The region card is what stands here once a region is chosen, and it has
      // its own height; leaving this behind would hold the card down for it.
      pane.style.removeProperty(CHROME_BOTTOM_VAR);
    };
  }, [kinds.length]);

  // The fold still has something to say with no kinds to choose between, and a
  // read that has not answered yet is not a reason to take it off the map.
  if (kinds.length === 0) return <Box ref={band} sx={CONTROL_BAND}>{children}</Box>;

  return (
    <Box ref={band} role="group" aria-label="Kinds of place on the map" sx={CONTROL_BAND}>
      <KindChip
        label="All kinds"
        color="#475569"
        selected={selected === null}
        onClick={() => onSelect(null)}
      />
      {kinds.map(kind => (
        <KindChip
          key={kind.id}
          label={`${shortKindName(kind.name)} ${kind.experience_count}`}
          color={kindColor(kind.id)}
          selected={selected === kind.id}
          onClick={() => onSelect(kind.id)}
        />
      ))}
      {children}
    </Box>
  );
}

interface KindChipProps {
  label: string;
  color: string;
  selected: boolean;
  onClick: () => void;
}

/**
 * One chip. Selected, it is filled in its kind's colour; unselected, it is the
 * map's own translucent white with that colour as its border — so the palette
 * is legible whichever chip is on, and the unselected chips never compete with
 * the pins underneath them.
 */
function KindChip({ label, color, selected, onClick }: KindChipProps) {
  return (
    <Chip
      label={label}
      size="small"
      onClick={onClick}
      aria-pressed={selected}
      sx={{
        cursor: 'pointer',
        fontWeight: selected ? 700 : 500,
        color: selected ? '#fff' : 'text.primary',
        backgroundColor: selected ? color : 'rgba(255,255,255,0.95)',
        border: `1px solid ${selected ? color : 'rgba(0,0,0,0.10)'}`,
        borderLeft: `3px solid ${color}`,
        backdropFilter: 'blur(8px)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
        '&:hover': { backgroundColor: selected ? color : 'rgba(255,255,255,1)' },
      }}
    />
  );
}
