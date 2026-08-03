/**
 * Says what an experience's lifecycle means, where it means something.
 *
 * Only two states are worth a chip, and only one of them is ever seen in an
 * ordinary list:
 *
 * - **Former** — the source stopped listing it, but the place is still there.
 *   Nothing else about it changes: it stays in lists and on the map, because
 *   you can still go. The chip exists so a curious visitor is not left
 *   wondering why it is missing from the official catalogue.
 * - **Lost** — it no longer exists. These are filtered out of everything that
 *   offers somewhere to go, so this chip is reached only where they survive on
 *   purpose: a visit history, or a list the reader deliberately unfiltered.
 *
 * An object a sync run merely flagged as absent renders nothing at all. That is
 * deliberate — a source outage must not change what anyone sees.
 */

import { Chip, Tooltip } from '@mui/material';

export interface LifecycleState {
  source_membership?: 'present' | 'former';
  existence?: 'extant' | 'lost';
}

/** The label and reason for a state, or null when there is nothing to say. */
export function lifecycleLabel(
  state: LifecycleState,
): { label: string; title: string; color: 'default' | 'warning' } | null {
  // Existence first: a place that is gone is gone whatever the catalogue says,
  // and labelling it "Former" would answer the less important question.
  if (state.existence === 'lost') {
    return {
      label: 'Lost',
      title: 'This no longer exists. Kept here because a visit to it still counts.',
      color: 'warning',
    };
  }
  if (state.source_membership === 'former') {
    return {
      label: 'Former',
      title: 'No longer on the official list, but still there to visit.',
      color: 'default',
    };
  }
  return null;
}

/**
 * Which verdict a row carries, for a caller offering to take one back.
 *
 * Same precedence as the label above and for the same reason — undoing
 * `former` on a row that is also `lost` would leave it hidden, since `lost` is
 * what takes it out of the lists.
 */
export function verdictOf(state: LifecycleState | null): 'lost' | 'former' | null {
  if (state?.existence === 'lost') return 'lost';
  if (state?.source_membership === 'former') return 'former';
  return null;
}

export function LifecycleChip({ state }: { state: LifecycleState }) {
  const described = lifecycleLabel(state);
  if (!described) return null;

  return (
    <Tooltip title={described.title}>
      <Chip
        label={described.label}
        size="small"
        color={described.color}
        variant="outlined"
        sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700, '& .MuiChip-label': { px: 0.5 } }}
      />
    </Tooltip>
  );
}
