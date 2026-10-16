/**
 * Curation Activity
 *
 * Every curator's acts on the catalogue in one feed, newest first (#611): what was
 * published, refused, edited or merged this week, by whom and where. An admin narrows it
 * by action, curator, region and dates instead of opening one curator's log at a time.
 * The curator menu is everyone the log names as having acted — an admin with no assignment
 * row, and a curator whose scope was revoked, whose trail is often what an audit is about.
 */

import { useMemo, useState } from 'react';
import {
  Box, FormControl, InputLabel, MenuItem, Paper, Select, TablePagination, TextField, Typography,
} from '@mui/material';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { CurationLogAction } from '@tyr/shared/curationLog';
import { getCurationActivity, type CurationActivityFilters } from '../../api/admin';
import type { RegionSearchResult } from '../../api/regions';
import { queryKeys } from '../../api/queryKeys';
import { displayNameOf } from '../../utils/displayName';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { ACTION_LABELS } from '../shared/curationLog';
import { CurationActivityTable } from './CurationActivityTable';
import { RegionSearchPicker } from './RegionSearchPicker';

const PAGE_SIZES = [25, 50, 100, 200];

/**
 * The instant a local day starts, `days` after the date a date field holds, or nothing
 * while the field holds no whole date: typing a year, the field reports 0002, 0020 and
 * 0202 on the way to 2026, and none of them is a day anyone means.
 */
function midnightOf(date: string, days = 0): string | undefined {
  if (!/^(19|20)\d\d-\d\d-\d\d$/.test(date)) return undefined;
  const day = new Date(`${date}T00:00:00`);
  day.setDate(day.getDate() + days);
  return day.toISOString();
}

/** The actions an admin picks from, by the name the History gives each. */
const ACTIONS = (Object.entries(ACTION_LABELS) as Array<[CurationLogAction, { label: string }]>)
  .sort(([, a], [, b]) => a.label.localeCompare(b.label));

export function CurationActivityPanel() {
  const [action, setAction] = useState<CurationLogAction | ''>('');
  const [curatorId, setCuratorId] = useState<number | ''>('');
  const [region, setRegion] = useState<RegionSearchResult | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  const filters = useMemo<CurationActivityFilters>(() => ({
    limit: pageSize,
    offset: page * pageSize,
    action: action || undefined,
    curatorId: curatorId || undefined,
    regionId: region?.id,
    // The days an admin picks are their own: from the start of the first to the end of the last.
    since: midnightOf(from),
    before: midnightOf(to, 1),
  }), [action, curatorId, region, from, to, page, pageSize]);

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.admin.curationActivity(filters),
    queryFn: () => getCurationActivity(filters),
    placeholderData: keepPreviousData,
  });

  /** A filter is a different list, so it starts at its first page. */
  const narrow = <T,>(set: (value: T) => void) => (value: T) => { set(value); setPage(0); };

  return (
    <Box>
      <Typography variant="h5" gutterBottom>Curation Activity</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        What every curator did to the catalogue, newest first.
      </Typography>

      <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id="activity-action">Action</InputLabel>
          <Select
            labelId="activity-action"
            value={action}
            label="Action"
            onChange={(e) => narrow(setAction)(e.target.value as CurationLogAction | '')}
          >
            <MenuItem value="">Any action</MenuItem>
            {ACTIONS.map(([value, { label }]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id="activity-curator">Curator</InputLabel>
          <Select
            labelId="activity-curator"
            value={curatorId}
            label="Curator"
            onChange={(e) => narrow(setCuratorId)(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <MenuItem value="">Any curator</MenuItem>
            {(data?.curators ?? []).map((actor) => (
              <MenuItem key={actor.id} value={actor.id}>
                {displayNameOf(actor.name) ?? `User #${actor.id}`}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          label="From" type="date" size="small" value={from}
          onChange={(e) => narrow(setFrom)(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          label="To" type="date" size="small" value={to}
          onChange={(e) => narrow(setTo)(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Box sx={{
          display: 'flex', gap: 1, flex: '1 1 100%',
          '& > .MuiFormControl-root': { flex: '0 0 170px' },
        }}
        >
          <RegionSearchPicker value={region} onChange={narrow(setRegion)} size="small" />
        </Box>
      </Paper>

      {isLoading && <LoadingSpinner size={24} padding="12px 0" />}
      {isError && <Typography color="error">The activity could not be read.</Typography>}
      {data && !data.activity.length && (
        <Typography color="text.secondary" sx={{ py: 2 }}>
          No curation activity matches these filters.
        </Typography>
      )}
      {data && data.activity.length > 0 && (
        <Paper variant="outlined">
          <CurationActivityTable activity={data.activity} showCurator />
          <TablePagination
            component="div"
            count={data.total}
            page={page}
            onPageChange={(_, next) => setPage(next)}
            rowsPerPage={pageSize}
            rowsPerPageOptions={PAGE_SIZES}
            onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
          />
        </Paper>
      )}
    </Box>
  );
}
