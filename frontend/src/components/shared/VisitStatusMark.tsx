import { Box } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import type { VisitedStatus } from '../../api/visited';

/** A place's visited state in words: the name its mark is read out by. */
const VISIT_STATUS_NAME: Record<VisitedStatus, string> = {
  not_visited: 'Not visited',
  visited: 'Visited',
};

interface VisitStatusMarkProps {
  status: VisitedStatus;
  /** The icon's size in pixels: 24 beside a list row's checkboxes, 20 on a Discover card. */
  size?: number;
  /** The ring of a place not visited: the row's own colour where the row has one. */
  idleColor?: string;
}

/**
 * A whole's visited state as a mark, never a control (#2120): a whole is
 * ticked by its parts, one by one, and a click on the row only opens it. A
 * full green circle once one place of it is visited (ADR-0206), an empty ring
 * otherwise, each read out by its name; how far the traveller got is the
 * row's count beside it. Not focusable, and no pointer: nothing here reads as
 * a checkbox that does not work.
 */
export function VisitStatusMark({ status, size = 24, idleColor = 'text.secondary' }: VisitStatusMarkProps) {
  const name = VISIT_STATUS_NAME[status];
  // The ring is drawn rather than an icon, the size of the circle in the
  // visited icon, so it adds no icon to the shell's chunk.
  const mark = status === 'visited'
    ? <CheckCircleIcon sx={{ fontSize: size, color: 'success.main' }} />
    : (
      <Box
        component="span"
        sx={{
          m: `${size / 12}px`,
          width: size * 5 / 6,
          height: size * 5 / 6,
          boxSizing: 'border-box',
          borderRadius: '50%',
          border: '2px solid',
          borderColor: idleColor,
        }}
      />
    );
  return (
    <Box
      component="span"
      role="img"
      aria-label={name}
      title={name}
      data-status={status}
      sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', p: '9px', cursor: 'inherit' }}
    >
      {mark}
    </Box>
  );
}
