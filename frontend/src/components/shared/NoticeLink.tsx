/**
 * A quiet line under the list offering to change what it holds.
 *
 * Two of these exist — "12 more in this region — show them all" (#553) and
 * "3 in this region no longer exist — show them" — and they follow the same rule: appear
 * only when there is something behind them, say the count, and read as a
 * sentence rather than as a control. A permanent switch for a state most regions
 * never reach is noise; a line that appears when the state does explains itself.
 */

import { Box, Link } from '@mui/material';

interface NoticeLinkProps {
  label: string;
  onClick: () => void;
}

export function NoticeLink({ label, onClick }: NoticeLinkProps) {
  return (
    <Box sx={{ px: 2, pb: 1 }}>
      <Link
        component="button"
        variant="caption"
        underline="hover"
        onClick={onClick}
        sx={{ color: 'text.secondary' }}
      >
        {label}
      </Link>
    </Box>
  );
}
