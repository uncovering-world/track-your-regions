/**
 * One filter of the review feed: a chip that says what it filters by, and a menu
 * of the values it could filter by with the count each one would leave.
 *
 * The count is the whole point of the control. A curator picking a source or a
 * question wants to know what is behind the choice *before* making it, so every
 * row carries the facet count the server computed under the other filters — and
 * a row counting zero is dimmed rather than dropped, because a chip that quietly
 * loses its rows tells a curator nothing about why the value they expected is
 * not on offer.
 *
 * A row toggles the filter on the click. There is no Apply button: the chip is
 * the filter, not a draft of one.
 */

import { useState } from 'react';
import {
  Box, Checkbox, Chip, Menu, MenuItem, Typography,
} from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import type { SxProps, Theme } from '@mui/material';

/** One value a chip may filter by, already counted and already answered. */
export interface FilterOption {
  /** What `onToggle` gets back — the address's own word for the value. */
  key: string;
  label: string;
  /** The facet count: what picking this row would leave. */
  count: number;
  checked: boolean;
  /** The question's own colour, where the list has one (`KIND_COLOR`). */
  swatch?: string;
}

/**
 * A count, in the column it shares with every other count in the menu.
 * `tabular-nums` so the digits line up down the list rather than wobbling.
 */
export const COUNT_SX: SxProps<Theme> = {
  ml: 'auto',
  pl: 2,
  color: 'text.secondary',
  fontVariantNumeric: 'tabular-nums',
};

export function FilterChip({
  label, value, active, options, onToggle, pending = false,
}: {
  label: string;
  /** The values currently picked, as the chip says them; `''` when none are. */
  value: string;
  active: boolean;
  options: FilterOption[];
  onToggle: (key: string) => void;
  /**
   * True while the facets have not arrived. An empty list means two different
   * things — nothing counted yet, or counted and there is nothing to filter by
   * — and only the caller knows which.
   */
  pending?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  return (
    <>
      <Chip
        size="small"
        variant={active ? 'filled' : 'outlined'}
        color={active ? 'primary' : 'default'}
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        label={(
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box component="span" sx={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {value ? `${label}: ${value}` : label}
            </Box>
            <ArrowDropDownIcon fontSize="small" />
          </Box>
        )}
      />
      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={() => setAnchor(null)}
        slotProps={{ list: { dense: true } }}
      >
        {options.length === 0 && (
          <MenuItem disabled>{pending ? 'Counting…' : 'Nothing to filter by'}</MenuItem>
        )}
        {options.map(option => (
          <MenuItem
            key={option.key}
            role="menuitemcheckbox"
            aria-checked={option.checked}
            onClick={() => onToggle(option.key)}
            sx={{ opacity: option.count === 0 && !option.checked ? 0.55 : 1 }}
          >
            <Checkbox
              size="small"
              checked={option.checked}
              disableRipple
              readOnly
              sx={{ p: 0, mr: 1 }}
              // The row carries the checkbox semantics (menuitemcheckbox); the
              // box itself is the indicator, and naming it again would read the
              // label twice.
              inputProps={{ tabIndex: -1, 'aria-hidden': true }}
            />
            {option.swatch && (
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  flex: 'none',
                  mr: 1,
                  bgcolor: option.swatch,
                }}
              />
            )}
            <Typography variant="body2">{option.label}</Typography>
            <Typography variant="body2" sx={COUNT_SX}>
              {option.count.toLocaleString('en')}
            </Typography>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
