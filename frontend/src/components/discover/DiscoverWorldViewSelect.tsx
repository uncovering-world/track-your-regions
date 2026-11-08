/**
 * Discover's *World View* select, at the top of its panel, offered where the
 * page can show more than one world view.
 *
 * It holds its own height from the first paint (#2378). It used to appear only
 * once the world views had loaded, and the breadcrumbs, the kinds' counts and
 * the region tree below it moved 54 px down under the reader: Discover's whole
 * layout shift. So it is drawn empty and disabled while they load, and stays
 * once they have: a page with one world view shows it disabled, naming that
 * one, rather than taking it away and moving the panel back up 54 px. Only a
 * catalogue with no world view shows none.
 */

import { Box, MenuItem, Select } from '@mui/material';
import type { WorldView } from '../../api/worldViews';

interface DiscoverWorldViewSelectProps {
  /** The world views this page can show (`worldViewsHere`). */
  worldViews: WorldView[];
  selected: WorldView | null;
  /** Whether the world views are still loading. */
  loading: boolean;
  onChange: (worldView: WorldView) => void;
}

export function DiscoverWorldViewSelect({ worldViews, selected, loading, onChange }: DiscoverWorldViewSelectProps) {
  const offered = worldViews.length > 1;
  if (worldViews.length === 0 && !loading) return null;
  const shown = selected && worldViews.some(w => w.id === selected.id) ? selected.id : '';
  return (
    <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Select
        disabled={!offered}
        value={shown}
        onChange={(e) => {
          const worldView = worldViews.find(w => w.id === e.target.value);
          if (worldView) onChange(worldView);
        }}
        size="small"
        fullWidth
        inputProps={{ 'aria-label': 'World View' }}
        sx={{ fontSize: '0.85rem' }}
      >
        {worldViews.map(worldView => (
          <MenuItem key={worldView.id} value={worldView.id} sx={{ fontSize: '0.85rem' }}>
            {worldView.name}
          </MenuItem>
        ))}
      </Select>
    </Box>
  );
}
