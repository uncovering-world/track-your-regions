/**
 * The kinds a place's works are listed by, and the kinds each work is held by
 * (#1263): a chip per kind of the place over the list, and a dot per kind on
 * each work. Shared by Map mode's card (`ArtworksList`) and Discover's panel
 * (`ContentsSection`), so one museum's works read the same on both.
 */

import { Box, Chip, Tooltip } from '@mui/material';
import type { KindChip, WorkKind } from '../../utils/worksByKind';
import { experienceColors } from '../../utils/kindColors';

/**
 * A chip per kind: a chosen one says how many works it holds, another how many
 * it would add — "Archaeology +7" on the Louvre opened from Art Museums.
 */
export function WorkKindChips({ chips, onToggle }: { chips: KindChip[]; onToggle: (kindId: number) => void }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1 }}>
      {chips.map(chip => {
        const colors = experienceColors(chip.kind.kind_id, chip.kind.type);
        const label = chip.selected ? `${chip.kind.kind_name} · ${chip.count}` : `${chip.kind.kind_name} +${chip.adds}`;
        return (
          <Chip
            key={chip.kind.kind_id}
            label={label}
            size="small"
            clickable
            aria-pressed={chip.selected}
            onClick={(e) => { e.stopPropagation(); onToggle(chip.kind.kind_id); }}
            variant={chip.selected ? 'filled' : 'outlined'}
            sx={{
              fontWeight: 500,
              color: colors.text,
              borderColor: colors.primary,
              bgcolor: chip.selected ? colors.bg : 'transparent',
            }}
          />
        );
      })}
    </Box>
  );
}

/** A dot per kind that holds the work, in each kind's colour, named for a screen reader. */
export function WorkKindDots({ kindIds, placeKinds }: { kindIds: number[]; placeKinds: WorkKind[] }) {
  const kinds = placeKinds.filter(kind => kindIds.includes(kind.kind_id));
  if (kinds.length === 0) return null;
  const names = kinds.map(kind => kind.kind_name).join(' and ');
  return (
    <Tooltip title={names}>
      <Box
        component="span"
        role="img"
        aria-label={`Held by ${names}`}
        sx={{ display: 'inline-flex', gap: 0.375, mr: 0.75, verticalAlign: 'middle' }}
      >
        {kinds.map(kind => (
          <Box
            key={kind.kind_id}
            component="span"
            sx={{
              width: 8, height: 8, borderRadius: '50%',
              bgcolor: experienceColors(kind.kind_id, kind.type).primary,
            }}
          />
        ))}
      </Box>
    </Tooltip>
  );
}
