/**
 * A museum's holdings on its Discover panel: what it keeps, which of it this
 * reader has seen, and — for a curator — the way into correcting one.
 *
 * Its own file since #731 put a dialog behind each tile: `ExperienceDetailPanel`
 * was at the size the development guide asks a file to be split at, and this
 * section is the half of it that has nothing to do with the object itself. The
 * places went the same way in #583 (`LocationsSection`).
 */

import { useState, useMemo } from 'react';
import { Box, Button, ButtonBase, Collapse, InputAdornment, TextField, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import SearchIcon from '@mui/icons-material/Search';
import type { ExperienceTreasure } from '../../api/experiences';
import { ContentTile } from './ContentTile';

/** Shut by default past this many, which is most museums. */
const CONTENTS_COLLAPSE_THRESHOLD = 15;
const CONTENTS_INITIAL_SHOW = 20;

interface ContentsSectionProps {
  contents: ExperienceTreasure[];
  totalCount: number;
  isAuthenticated: boolean;
  viewedIds: Set<number>;
  onMarkViewed: (id: number) => void;
  onUnmarkViewed: (id: number) => void;
  /** A curator's way into correcting one of these works (#731). */
  onCorrect?: (work: ExperienceTreasure) => void;
}

/**
 * Exported for its test: what this section promises is that a museum's works can
 * be reached at all, and that is a property of the *closed* state, which no
 * caller of the panel can drive.
 */
export function ContentsSection({
  contents,
  totalCount,
  isAuthenticated,
  viewedIds,
  onMarkViewed,
  onUnmarkViewed,
  onCorrect,
}: ContentsSectionProps) {
  const shouldCollapse = totalCount > CONTENTS_COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(!shouldCollapse);
  const [showAll, setShowAll] = useState(false);
  const [searchText, setSearchText] = useState('');

  const viewedCount = contents.filter((c) => viewedIds.has(c.id)).length;
  const displayContents = useMemo(() => {
    let filtered = contents;
    if (searchText) {
      const lower = searchText.toLowerCase();
      filtered = filtered.filter((c) =>
        c.name.toLowerCase().includes(lower) ||
        // Every maker, not the first: a reader looking for Savitsky in the
        // Tretyakov must find `Morning in a Pine Forest` (#720).
        c.artists.some(maker => maker.toLowerCase().includes(lower)),
      );
    }
    if (!showAll && !searchText) {
      filtered = filtered.slice(0, CONTENTS_INITIAL_SHOW);
    }
    return filtered;
  }, [contents, showAll, searchText]);

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
          Notable Works ({totalCount})
        </Typography>
        {isAuthenticated && viewedCount > 0 && (
          <Typography variant="caption" color={viewedCount === totalCount ? 'success.main' : 'text.secondary'}>
            {viewedCount} seen
          </Typography>
        )}
        {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      </ButtonBase>

      <Collapse in={expanded} timeout="auto">
        {/* Search for large lists */}
        {totalCount > CONTENTS_COLLAPSE_THRESHOLD && (
          <TextField
            size="small"
            placeholder="Filter works..."
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
        {!showAll && !searchText && totalCount > CONTENTS_INITIAL_SHOW && (
          <Button size="small" variant="text" onClick={() => setShowAll(true)} sx={{ mt: 0.5 }}>
            Show all {totalCount} works
          </Button>
        )}
      </Collapse>
    </Box>
  );
}
