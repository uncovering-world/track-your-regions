/**
 * The experiences half of the navigation pane's search (#592).
 *
 * A visitor who knows the name — "Alhambra", "Rijksmuseum" — types it here, and
 * the search answers about the whole catalogue. What it does *not* do is move
 * anyone between world views: a world view is the lens the reader chose, and a
 * search result is not a reason to change it. So a row is a link only where the
 * world view already open places the object, and every other answer is still
 * shown, quietly, with the reason it cannot be opened:
 *
 * - placed in some other published world view → "not in this world view"
 * - placed nowhere → "not on a map yet", which is the matcher gap (#469, #470)
 *   rather than a gap in the catalogue: the Great Barrier Reef, the Wadden Sea
 *   and 26 others on 2026-09-01
 *
 * Answering "no results" for those would tell a reader the catalogue does not
 * hold what it does hold, which is the one thing a search must never say.
 *
 * No pictures here, deliberately: a picture brings the credit line it must be
 * shown with (`ImageCreditLine`), and a row of a jump-to list is not where a
 * photograph earns the two lines that costs. The card the row opens carries
 * both.
 */

import { Box, List, ListItem, ListItemButton, ListItemText, ListSubheader, Typography } from '@mui/material';
import type { ExperienceRegionRef, ExperienceSearchResult } from '../api/experiences';
import { LifecycleChip } from './shared/LifecycleChip';
import { openableRegion } from '../utils/openableRegion';

interface ExperienceSearchResultsProps {
  results: ExperienceSearchResult[];
  /** The world view the reader is in, or null where it is the default one. */
  worldViewId: number | null;
  onSelect: (result: ExperienceSearchResult, region: ExperienceRegionRef) => void;
}

/** Why a row is not a link, for a reader who can see it is not one. */
function unreachableReason(result: ExperienceSearchResult): string {
  return result.regions.length > 0 ? 'not in this world view' : 'not on a map yet';
}

/** Kind, then the countries it is in — what tells two same-named sites apart. */
function context(result: ExperienceSearchResult): string {
  return [result.kind_name, result.country_names?.join(', ')].filter(Boolean).join(' · ');
}

export function ExperienceSearchResults({ results, worldViewId, onSelect }: ExperienceSearchResultsProps) {
  if (results.length === 0) return null;

  return (
    <List
      dense
      subheader={<ListSubheader disableSticky sx={{ lineHeight: '28px' }}>Experiences</ListSubheader>}
    >
      {results.map((result) => {
        // Where this row would open, by the one rule every link from one card
        // to another shares (`openableRegion`, ADR-0042 decision 4).
        const region = openableRegion(result.regions, worldViewId);
        const body = (
          <ListItemText
            disableTypography
            primary={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                <Typography
                  variant="body2"
                  noWrap
                  color={region ? 'text.primary' : 'text.secondary'}
                >
                  {result.name}
                </Typography>
                <LifecycleChip state={result} />
              </Box>
            }
            secondary={
              <>
                <Typography variant="caption" color="text.secondary" noWrap display="block">
                  {context(result)}
                </Typography>
                {/* Its own line, and never truncated: the reason is the whole
                    of why this row is here rather than a link, and in a 320 px
                    pane it is the first thing an ellipsis eats. */}
                {!region && (
                  <Typography
                    variant="caption"
                    color="text.disabled"
                    display="block"
                    sx={{ fontStyle: 'italic' }}
                  >
                    {unreachableReason(result)}
                  </Typography>
                )}
              </>
            }
          />
        );

        return region ? (
          <ListItemButton key={result.id} onClick={() => onSelect(result, region)}>
            {body}
          </ListItemButton>
        ) : (
          <ListItem key={result.id}>{body}</ListItem>
        );
      })}
    </List>
  );
}
