import {
  Box,
  Checkbox,
  Chip,
  ListItem,
  ListItemIcon,
  Typography,
  styled,
} from '@mui/material';
import { Place as PlaceIcon } from '@mui/icons-material';
import { VISITED_GREEN, PARTIAL_AMBER } from '../../utils/categoryColors';

/**
 * The row's chrome as classes made once, not as `sx` objects made per row.
 *
 * A sibling file rather than a block inside the row: it is the one part of
 * that component that is not JSX, and lifting it out keeps the row itself
 * under the size rule in `docs/tech/development-guide.md`.
 *
 * `sx` is emotion at runtime: every object is serialised on each render and its
 * rule inserted when the element mounts. That is affordable for a dialog and not
 * for a row of a 661-item list, where the window mounts twenty of them at a time
 * as the reader scrolls — measured on Europe, four scrolls cost 3.0 s of blocked
 * main thread in dev. `styled()` at module scope computes the class once, when
 * this file loads, and mounting a row is then DOM plus a class name.
 *
 * What varies per row goes through a CSS variable rather than a new class: the
 * category's colour is set as `--tyr-row-color` in a plain inline style, which
 * costs nothing to serialise and — unlike an inline `color` — does not outrank
 * the `.Mui-checked` rule that turns a ticked box green.
 *
 * What varies per *state* goes through data attributes, so the class stays one
 * class: `data-selected`, `data-visited`, `data-partial`, and the `data-hovered`
 * the row writes on itself.
 */
// The generic re-declares `component`, which `styled()` drops from MUI's
// polymorphic props: this row renders a `div` for the reason given at its use.
export const RowItem = styled(ListItem)<{ component?: React.ElementType }>(({ theme }) => ({
  paddingLeft: theme.spacing(2),
  cursor: 'pointer',
  borderLeft: '0 solid',
  borderLeftColor: theme.palette.primary.main,
  borderBottom: '1px solid',
  borderBottomColor: theme.palette.divider,
  '&:hover, &[data-hovered="true"]': { backgroundColor: theme.palette.action.hover },
  // No background of its own: the row has always been marked by the border
  // alone. The `sx` it replaced asked for `primary.50`, which this theme does
  // not define — `palette.primary` carries `main` only — so it resolved to
  // nothing and the selected row was already transparent. Kept as it looks
  // today rather than quietly given a colour it never had.
  '&[data-selected="true"]': { borderLeftWidth: 4, borderBottom: 0 },
}));

export const VisitIcon = styled(ListItemIcon)({
  minWidth: 36,
  display: 'flex',
  alignItems: 'center',
  '&[data-partial="true"]': { minWidth: 72 },
});

export const VisitCheckbox = styled(Checkbox)({
  color: 'var(--tyr-row-color)',
  '&.Mui-checked': { color: VISITED_GREEN },
  '&.MuiCheckbox-indeterminate': { color: PARTIAL_AMBER },
});

export const CategoryIcon = styled(ListItemIcon)({ minWidth: 32 });

export const PlacePin = styled(PlaceIcon)({ fontSize: 20, color: 'var(--tyr-row-color)' });

export const TitleRow = styled(Box)({ display: 'flex', alignItems: 'center', gap: 8 });

export const TitleText = styled(Typography)(({ theme }) => ({
  fontWeight: 500,
  flex: 1,
  color: theme.palette.text.primary,
  '&[data-selected="true"]': { fontWeight: 600 },
  '&[data-visited="true"]': {
    textDecoration: 'line-through',
    color: theme.palette.text.secondary,
  },
}));

export const CountChip = styled(Chip)({
  height: 18,
  fontSize: '0.65rem',
  '& .MuiChip-label': { paddingLeft: 6, paddingRight: 6 },
  '&[data-foldable="false"]': { cursor: 'default' },
});
