/**
 * One curator's activity, as an admin audits it (#956). An admin opens it to
 * check the curator's calls against the rule, to find what happened to one
 * place, and to see how much got done. So it opens on the last 30 days, with
 * the period's counts above the table (the calls against the rule first), a
 * search by place, and the trail itself: one act a row, a batch publish as one,
 * paged, so every row the counts announce can be reached.
 */

import { useState } from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TablePagination, TextField,
  ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { getCuratorActivity, type CuratorActivity } from '../../api/admin';
import { queryKeys } from '../../api/queryKeys';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { ActivityCounts } from './ActivityCounts';
import { CurationActivityTable } from './CurationActivityTable';

/** The periods an admin reads a trail over: the last week, the last 30 days, or everything. */
const PERIODS = { week: 7, month: 30, all: null } as const;
type Period = keyof typeof PERIODS;
const PERIOD_LABELS: Record<Period, string> = { week: '7 days', month: '30 days', all: 'All' };
const PAGE_SIZE = 50;

/** The instant a period starts at: midnight, the given number of days back. */
function sinceOf(period: Period): string | undefined {
  const days = PERIODS[period];
  if (days === null) return undefined;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days);
  return start.toISOString();
}

export function CuratorActivityDialog({ userId, name, onClose }: {
  userId: number | null;
  /** Whose trail this is, as the curator's card names them. */
  name: string | null;
  onClose: () => void;
}) {
  const [period, setPeriod] = useState<Period>('month');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const q = search.trim().length >= 2 ? search.trim() : undefined;
  const { data, isLoading, isError, isPlaceholderData } = useQuery({
    queryKey: queryKeys.admin.curatorActivity(userId, { period, q, page }),
    queryFn: () => getCuratorActivity(userId!, { since: sinceOf(period), q, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    enabled: !!userId,
    // The last answer stays while the next page or period loads, but never another
    // curator's: opening B right after A must not show A's trail under B.
    placeholderData: (previous: CuratorActivity | undefined, previousQuery) =>
      (previousQuery?.queryKey[2] === userId ? previous : undefined),
  });
  /** A period or a search is a different list, so it starts at its first page. */
  const narrow = <T,>(set: (value: T) => void) => (value: T) => { set(value); setPage(0); };

  return (
    <Dialog open={!!userId} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>{name ? `Activity of ${name}` : 'Activity of a curator'}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={period}
            onChange={(_, next: Period | null) => { if (next) narrow(setPeriod)(next); }}
            aria-label="Period"
          >
            {(Object.keys(PERIODS) as Period[]).map(key => (
              <ToggleButton key={key} value={key}>{PERIOD_LABELS[key]}</ToggleButton>
            ))}
          </ToggleButtonGroup>
          <TextField
            size="small"
            label="Find a place"
            value={search}
            onChange={(e) => narrow(setSearch)(e.target.value)}
          />
        </Box>
        {data && <ActivityCounts counts={data.counts} />}
        {/* The last answer held while the next loads is not the answer to the new filters. */}
        {(isLoading || isPlaceholderData) && <LoadingSpinner size={24} padding="12px 0" />}
        {isError && <Typography color="error" sx={{ py: 2 }}>The activity could not be read. Close and open it again.</Typography>}
        {data && !isPlaceholderData && data.total === 0 && (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            {q ? 'No act on a place of that name in this period.' : 'No curation activity in this period.'}
          </Typography>
        )}
        {data?.activity.length ? <CurationActivityTable activity={data.activity} /> : null}
        {/* Drawn whenever the period holds entries, so a page left past the end has its way back. */}
        {data && data.total > 0 && (
          <TablePagination
            component="div"
            count={data.total}
            page={page}
            onPageChange={(_, next) => setPage(next)}
            rowsPerPage={PAGE_SIZE}
            rowsPerPageOptions={[PAGE_SIZE]}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
