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
 * the filter, not a draft of one. A chip whose values exclude each other — the
 * address carries one region — says so: its rows are radios, read out as such,
 * where the multi-select chips' rows are checkboxes.
 */

import { useState } from 'react';
import {
  Box, Checkbox, Chip, Menu, MenuItem, Radio, TextField, Typography,
} from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import type { SxProps, Theme } from '@mui/material';

/** One value a chip may filter by, already counted and already answered. */
export interface FilterOption {
  /** What `onToggle` gets back — the address's own word for the value. */
  key: string;
  label: string;
  /**
   * The facet count: what picking this row would leave. Absent on a row the
   * search found (#1920), which is not counted: counting a region walks its
   * subtree, and the feed's own total answers once it is picked.
   */
  count?: number;
  checked: boolean;
  /** The question's own colour, where the list has one (`KIND_COLOR`). */
  swatch?: string;
  /** A second line under the label: a found region's path and world view (#1920). */
  detail?: string;
}

/** The search a chip may offer at the top of its menu (#1920): the text typed, and what it found. */
export interface ChipSearch {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** The rows the text found, shown above the counted options; empty while nothing is typed or found. */
  found: FilterOption[];
  /** True while a typed text is being looked up, or has not yet been sent. */
  searching: boolean;
  /** What the menu says of a settled text that found nothing: the chip is generic, the words are the caller's. */
  nothingFound: string;
  /** True when the last request failed: said as such, never as "nothing found". */
  failed: boolean;
}

/** The keys the menu itself answers — closing, leaving, moving down the rows — which the field must not keep. */
const MENU_KEYS = new Set(['Escape', 'Tab', 'ArrowDown', 'ArrowUp']);

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
  label, value, active, options, onToggle, pending = false, single = false, search,
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
  /** One value at most: the rows are a radio set (`menuitemradio`) rather than checkboxes. */
  single?: boolean;
  /** A search field at the top of the menu, whose rows join the counted ones (#1920). */
  search?: ChipSearch;
}) {
  const Indicator = single ? Radio : Checkbox;

  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const typed = search !== undefined && search.value.trim().length >= 2;
  // A found row the menu offers already — a root, or the picked region — is
  // not listed twice; the counted row stands.
  const offered = new Set(options.map(option => option.key));
  const rows = typed ? [...search.found.filter(found => !offered.has(found.key)), ...options] : options;
  const row = (option: FilterOption) => (
    <MenuItem
      key={option.key}
      role={single ? 'menuitemradio' : 'menuitemcheckbox'}
      aria-checked={option.checked}
      onClick={() => onToggle(option.key)}
      sx={{ opacity: option.count === 0 && !option.checked ? 0.55 : 1 }}
    >
      <Indicator
        size="small"
        checked={option.checked}
        disableRipple
        readOnly
        sx={{ p: 0, mr: 1 }}
        // The row carries the semantics (menuitemcheckbox or
        // menuitemradio); the control itself is the indicator, and naming
        // it again would read the label twice.
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
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2">{option.label}</Typography>
        {option.detail && (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ whiteSpace: 'normal' }}>
            {option.detail}
          </Typography>
        )}
      </Box>
      {option.count !== undefined && (
        <Typography variant="body2" sx={COUNT_SX}>
          {option.count.toLocaleString('en')}
        </Typography>
      )}
    </MenuItem>
  );

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
        {search && (
          // Typing in a menu would otherwise drive MUI's type-ahead over the
          // rows, so the field keeps the keys that type — and lets the menu's
          // own through, or Escape could not close it nor the arrows reach a
          // row. Autofocus, since the menu was just opened to type into it.
          <Box sx={{ px: 2, pt: 1, pb: 0.5 }} onKeyDown={(e) => { if (!MENU_KEYS.has(e.key)) e.stopPropagation(); }}>
            <TextField
              size="small"
              autoFocus
              fullWidth
              value={search.value}
              placeholder={search.placeholder}
              onChange={(e) => search.onChange(e.target.value)}
              // On the <input> itself: `slotProps.input` names the wrapper, which no reader reads as the field.
              slotProps={{ htmlInput: { 'aria-label': search.placeholder } }}
            />
          </Box>
        )}
        {typed && search.searching && <MenuItem disabled>Searching…</MenuItem>}
        {typed && !search.searching && search.failed && <MenuItem disabled>Search failed — try again</MenuItem>}
        {typed && !search.searching && !search.failed && search.found.length === 0 && <MenuItem disabled>{search.nothingFound}</MenuItem>}
        {rows.length === 0 && !typed && (
          <MenuItem disabled>{pending ? 'Counting…' : 'Nothing to filter by'}</MenuItem>
        )}
        {rows.map(row)}
      </Menu>
    </>
  );
}
