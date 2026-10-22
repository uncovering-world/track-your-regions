/**
 * How often the dump worker brings what is kept forward by itself, which an
 * admin may change (the OpenStreetMap layer, ADR-0134 decision 6): every 1 to
 * 30 days, or off, when updates are started by hand.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MenuItem, Select, Typography } from '@mui/material';
import { setDumpSchedule, type DumpsDumpsItem } from '../../api/admin/dumps';
import { queryKeys } from '../../api/queryKeys';

const OFF = 'off';
const DAYS = Array.from({ length: 30 }, (_, index) => index + 1);

export function DumpScheduleLine({ dump }: { dump: DumpsDumpsItem }) {
  const queryClient = useQueryClient();
  const schedule = dump.keeps?.schedule;
  const save = useMutation({
    mutationFn: (everyDays: number | null) => setDumpSchedule(dump.key, everyDays),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.dumps }),
  });
  if (!schedule) return null;
  const value = schedule.everyDays === null ? OFF : String(schedule.everyDays);
  return (
    <Typography variant="caption" color="text.secondary" component="div" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
      Updates itself
      <Select
        size="small"
        variant="standard"
        value={value}
        disabled={save.isPending}
        onChange={event => save.mutate(event.target.value === OFF ? null : Number(event.target.value))}
        inputProps={{ 'aria-label': 'How often the worker updates it by itself' }}
        sx={{ fontSize: 'inherit' }}
      >
        <MenuItem value={OFF}>never (started by hand)</MenuItem>
        {DAYS.map(days => (
          <MenuItem key={days} value={String(days)}>
            every {days === 1 ? 'day' : `${days} days`}{days === schedule.defaultEveryDays ? ' (default)' : ''}
          </MenuItem>
        ))}
      </Select>
      {save.error && <span role="alert">{save.error instanceof Error ? save.error.message : 'Not saved'}</span>}
    </Typography>
  );
}
