/**
 * The earlier years readership keeps beside the current one, and the control
 * that asks for another (#2230): a month, and a button that keeps the twelve
 * months ending on it. Such a year stays through later builds and no run reads
 * it; the admission review derives the same bars on two years to see that a
 * bar holds over time. Only a dump dated by month that something is built from
 * has the line.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, TextField, Typography } from '@mui/material';
import { startDumpKeep, type DumpsDumpsItem } from '../../api/admin/dumps';
import { queryKeys } from '../../api/queryKeys';
import { dumpDate, inFlight } from './DumpBuildProgress';

/** `2025-09` as the panel writes a month: `Sep 2025`. */
const monthLabel = (month: string) => dumpDate(`${month}-01`, 'month');

export function DumpArchiveLine({ dump }: { dump: DumpsDumpsItem }) {
  const queryClient = useQueryClient();
  const [windowEnd, setWindowEnd] = useState('');
  const keep = useMutation({
    mutationFn: (end: string) => startDumpKeep(dump.key, 'newest', end),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.dumps }),
  });
  if (!dump.keeps || dump.datedBy !== 'month') return null;
  const { archives, newestDumpDate } = dump.keeps;
  return (
    <Typography variant="caption" color="text.secondary" component="div" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
      {archives.length > 0
        ? <>Earlier years kept beside it, each by its last month: {archives.map(monthLabel).join(', ')}</>
        : <>No earlier year kept beside it</>}
      <TextField
        type="month"
        size="small"
        variant="standard"
        value={windowEnd}
        onChange={event => setWindowEnd(event.target.value)}
        disabled={keep.isPending}
        inputProps={{ 'aria-label': 'The month the year ends on', ...(newestDumpDate ? { max: newestDumpDate.slice(0, 7) } : {}) }}
        sx={{ fontSize: 'inherit', '& input': { fontSize: 'inherit', py: 0 } }}
      />
      <Button
        size="small"
        variant="outlined"
        color="inherit"
        onClick={() => keep.mutate(windowEnd)}
        disabled={!windowEnd || keep.isPending || inFlight(dump.progress)}
      >
        Build the year ending {windowEnd ? monthLabel(windowEnd) : '…'}
      </Button>
      {keep.error && <span role="alert">{keep.error instanceof Error ? keep.error.message : 'The build could not start'}</span>}
    </Typography>
  );
}
