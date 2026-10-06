/**
 * A museum's holdings on its Discover panel: what it keeps, which of it this
 * reader has seen, and — for a curator — the way into correcting one.
 *
 * Its own file (#731): this section is the half of `ExperienceDetailPanel`
 * that has nothing to do with the object itself, and that panel is at the size
 * the development guide asks a file to be split at. The places went the same
 * way (`LocationsSection`, #583).
 */

import { useState, useMemo } from 'react';
import { Box, Button, ButtonBase, Collapse, InputAdornment, TextField, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import SearchIcon from '@mui/icons-material/Search';
import type { ExperienceTreasure } from '../../api/experiences';
import { foldLabel } from '@tyr/shared/labels';
import type { WorkKind } from '../../utils/worksByKind';
import { useWorkKinds } from '../../hooks/useWorkKinds';
import { WorkKindChips } from '../shared/WorkKindChips';
import { ContentTile } from './ContentTile';

/** Shut by default past this many, which is most museums. */
const CONTENTS_COLLAPSE_THRESHOLD = 15;
const CONTENTS_INITIAL_SHOW = 20;

interface ContentsSectionProps {
  /** The place these works are in. */
  experienceId: number;
  contents: ExperienceTreasure[];
  totalCount: number;
  isAuthenticated: boolean;
  viewedIds: Set<number>;
  onMarkViewed: (id: number) => void;
  onUnmarkViewed: (id: number) => void;
  /** A curator's way into correcting one of these works (#731). */
  onCorrect?: (work: ExperienceTreasure) => void;
  /**
   * Which kind's object this panel is showing, which decides what its holdings
   * are called and, for a place in several kinds, which kinds' works are
   * listed (#1263).
   */
  kindId?: number | null;
  /** Every kind of the place; with two or more, the works are chosen by kind. */
  placeKinds?: WorkKind[];
}

/**
 * Exported for its test: what this section promises is that a museum's works can
 * be reached at all, and that is a property of the *closed* state, which no
 * caller of the panel can drive.
 */
export function ContentsSection({
  experienceId,
  contents,
  totalCount,
  isAuthenticated,
  viewedIds,
  onMarkViewed,
  onUnmarkViewed,
  onCorrect,
  kindId,
  placeKinds,
}: ContentsSectionProps) {
  // The works of the chosen kinds, each once, for a place in several (#1263),
  // by the rule Map mode's card reads.
  const { severalKinds, chips, shown, noun, toggle } = useWorkKinds(experienceId, contents, placeKinds, kindId ?? null);
  const listedCount = severalKinds ? shown.length : totalCount;
  const shouldCollapse = totalCount > CONTENTS_COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(!shouldCollapse);
  const [showAll, setShowAll] = useState(false);
  const [searchText, setSearchText] = useState('');

  // What was seen of what is listed, so the line never says more seen than shown.
  const viewedCount = shown.filter((c) => viewedIds.has(c.id)).length;
  // Both sides folded, so a search finds what the screen shows whatever the
  // row holds: HTML collapses a run of spaces and folds nothing else, and a
  // reader types the collapsed form (#835). The fold also meets a dash typed
  // as a hyphen, and a name pasted off a wrapped line. A filter of nothing but
  // spaces folds to nothing and reads as no filter, here and for "Show all".
  const needle = foldLabel(searchText);
  const displayContents = useMemo(() => {
    let filtered = shown;
    if (needle) {
      filtered = filtered.filter((c) =>
        foldLabel(c.name).includes(needle) ||
        // Every maker, not the first: a reader looking for Savitsky in the
        // Tretyakov must find `Morning in a Pine Forest` (#720).
        c.artists.some(maker => foldLabel(maker).includes(needle)),
      );
    }
    if (!showAll && !needle) {
      filtered = filtered.slice(0, CONTENTS_INITIAL_SHOW);
    }
    return filtered;
  }, [shown, showAll, needle]);

  return (
    <Box sx={{ mb: 2 }}>
      {/* The header is the only way into this section, and the section is shut by
          default for anything past `CONTENTS_COLLAPSE_THRESHOLD` — which is most
          museums. As a `<div onClick>` it was not a tab stop, so the works grid
          inside could be operated by keyboard in principle and reached by nobody:
          `Collapse` hides its contents outright while shut, so there was no way in
          at all. A real control, then, carrying `aria-expanded` so a reader is told
          whether the thing they are about to open is open. */}
      <ButtonBase
        component="div"
        role="button"
        aria-expanded={expanded}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', mb: 1,
          width: '100%', textAlign: 'inherit',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 600, flex: 1 }}>
          {/* The kind's own noun, off the rule Map mode's list reads, so the
              same British Museum is not headed "Notable finds" there and
              "Notable Works" here — the drift the shared-patterns inventory
              exists to prevent (#885). */}
          Notable {noun} ({listedCount})
        </Typography>
        {isAuthenticated && viewedCount > 0 && (
          <Typography variant="caption" color={viewedCount === listedCount ? 'success.main' : 'text.secondary'}>
            {viewedCount} seen
          </Typography>
        )}
        {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      </ButtonBase>

      <Collapse in={expanded} timeout="auto">
        {severalKinds && <WorkKindChips chips={chips} onToggle={toggle} />}
        {/* Search for large lists */}
        {totalCount > CONTENTS_COLLAPSE_THRESHOLD && (
          <TextField
            size="small"
            placeholder={`Filter ${noun}...`}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            fullWidth
            sx={{ mb: 1 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />
        )}

        {/* Artwork grid */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
            gap: 1,
            maxHeight: 400,
            overflowY: 'auto',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            p: 1,
            bgcolor: 'background.paper',
          }}
        >
          {displayContents.map((content) => (
            <ContentTile
              key={content.id}
              content={content}
              placeKinds={severalKinds ? placeKinds : undefined}
              isViewed={viewedIds.has(content.id)}
              isAuthenticated={isAuthenticated}
              onToggleViewed={() => (viewedIds.has(content.id)
                ? onUnmarkViewed(content.id)
                : onMarkViewed(content.id))}
              onCorrect={onCorrect}
            />
          ))}
        </Box>

        {/* Show more button */}
        {!showAll && !needle && listedCount > CONTENTS_INITIAL_SHOW && (
          <Button size="small" variant="text" onClick={() => setShowAll(true)} sx={{ mt: 0.5 }}>
            Show all {listedCount} {noun}
          </Button>
        )}
      </Collapse>
    </Box>
  );
}
