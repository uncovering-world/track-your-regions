import { Box } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import type { VisitedStatus } from '../../api/visited';
import { PARTIAL_AMBER } from '../../utils/kindColors';

/** A place's visited state in words: the name its mark is read out by. */
const VISIT_STATUS_NAME: Record<VisitedStatus, string> = {
  not_visited: 'Not visited',
  partial: 'Partly visited',
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
 * ticked by its parts, one by one, so its row says how far the traveller got
 * and a click on the row only opens it. A full green circle for visited, a
 * half-filled amber ring for partly visited, an empty ring for not visited,
 * each read out by its name. Not focusable, and no pointer: nothing here
 * reads as a checkbox that does not work.
 */
export function VisitStatusMark({ status, size = 24, idleColor = 'text.secondary' }: VisitStatusMarkProps) {
  const name = VISIT_STATUS_NAME[status];
  // The two rings are drawn rather than icons, the size of the circle in the
  // visited icon, so they add no icon to the shell's chunk.
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
          borderColor: status === 'partial' ? PARTIAL_AMBER : idleColor,
          background: status === 'partial' ? `linear-gradient(90deg, ${PARTIAL_AMBER} 50%, transparent 50%)` : 'none',
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
