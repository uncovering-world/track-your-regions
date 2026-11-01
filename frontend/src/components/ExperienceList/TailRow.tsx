/**
 * The row that ends a kind's group where a crowded city leaves places out
 * (ADR-0172, #2201): "37 shadowed churches", the word explained on hover. A
 * click opens the kind's tail under it, in the same list, and a second click
 * folds it.
 *
 * Second-order by its looks as by its place: a quiet caption, indented, where
 * the group's own rows are titles. The places under it are drawn by
 * `TailPlace` — the list's own cards, set apart by the same indent.
 */

import { Box, CircularProgress, ListItemButton, Tooltip, Typography } from '@mui/material';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import type { ReactNode } from 'react';
import { TAIL_FAILED, TAIL_ROW_REASON } from '../shared/tailNotice';
import type { TailSection } from './tailRows';

/** The indent and rule that set a tail apart from its group's rows. */
const TAIL_INSET = { ml: 2, borderLeft: '3px solid', borderColor: 'divider' } as const;

interface TailRowProps {
  section: TailSection;
  onToggle: (kindId: number) => void;
}

export function TailRow({ section, onToggle }: TailRowProps) {
  const loading = section.open && section.places === undefined && !section.failed;
  return (
    <Box sx={TAIL_INSET}>
      <ListItemButton
        dense
        onClick={() => onToggle(section.kindId)}
        aria-expanded={section.open}
        sx={{ py: 0.75, pl: 1.5, gap: 1 }}
      >
        <Tooltip title={TAIL_ROW_REASON} describeChild placement="top-start">
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1, fontStyle: 'italic' }}>
            {section.label}
          </Typography>
        </Tooltip>
        {loading && <CircularProgress size={14} thickness={5} sx={{ color: 'text.disabled' }} />}
        {section.open ? <ExpandLess fontSize="small" color="action" /> : <ExpandMore fontSize="small" color="action" />}
      </ListItemButton>
      {section.open && section.failed && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ px: 1.5, pb: 0.75 }}>
          {TAIL_FAILED}
        </Typography>
      )}
    </Box>
  );
}

/** One place of an open tail: the list's own row, inside the tail's indent. */
export function TailPlace({ children }: { children: ReactNode }) {
  return <Box sx={TAIL_INSET}>{children}</Box>;
}
