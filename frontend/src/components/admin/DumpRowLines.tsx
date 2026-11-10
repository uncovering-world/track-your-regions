/**
 * The lines under a dump's name in *For developers* (`DumpsPanel.tsx`): the
 * copy kept from it, the local copy of its file, the sample and the last trial,
 * and, for a dump only a copy's build reads, which copy that is (#2415). A
 * trial's step times sit behind an expander: they are what a trial is for, and
 * a long line beside the row.
 */

import { useState } from 'react';
import { Box, Button, Collapse, Typography } from '@mui/material';
import type { DumpBuild, DumpsDumpsItem } from '../../api/admin/dumps';
import { formatRelativeTime } from '../../utils/dateFormat';
import { dumpDate, size } from './DumpBuildProgress';

/** A build's outcome: the chip a row shows, and the word a line gives a build that has no chip. */
export const OUTCOME: Record<DumpBuild['status'], { label: string; color: 'success' | 'error' | 'default' }> = {
  success: { label: 'Verified', color: 'success' },
  failed: { label: 'Failed', color: 'error' },
  cancelled: { label: 'Cancelled', color: 'default' },
  running: { label: 'Running', color: 'default' },
};

const ended = (status: DumpBuild['status']) => OUTCOME[status].label.toLowerCase();

/** The newest local copy of the dump, which a build can read instead of downloading the newest file. */
export function LocalCopy({ dump }: { dump: DumpsDumpsItem }) {
  if (!dump.localCopy) return null;
  return (
    <Typography variant="caption" color="text.secondary" display="block">
      Local copy: {dumpDate(dump.localCopy.date, dump.datedBy)}, {size(dump.localCopy.bytes)}
    </Typography>
  );
}

/**
 * The sample a trial reads, and how the last trial ended: what it kept and
 * how long each step took, which is what a trial is for (#1527).
 */
export function SampleLine({ dump, tried }: { dump: DumpsDumpsItem; tried: DumpBuild | undefined }) {
  if (!dump.sample && !tried) return null;
  return (
    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
      {dump.sample && <>Sample: the first part of the {dumpDate(dump.sample.date, dump.datedBy)} copy, {size(dump.sample.bytes)}</>}
      {tried && <TrialLine tried={tried} />}
    </Typography>
  );
}

/** What is built from the dump, from which dump the build in place was made, and when it was last derived again (#1526). */
export function Kept({ dump, derived }: { dump: DumpsDumpsItem; derived: DumpBuild | undefined }) {
  if (!dump.keeps) return null;
  const { title, built } = dump.keeps;
  return (
    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
      {built
        ? <>{title}: {dump.keeps.currentTo ? 'current to' : 'built from the dump of'} {dumpDate(built.dumpDate, dump.datedBy)}, swapped in {formatRelativeTime(built.swappedAt)}</>
        : <>{title}: not built yet</>}
      {derived && (
        <Box component="span" display="block">
          Last derived again {formatRelativeTime(derived.finishedAt ?? derived.startedAt)}
          {derived.status !== 'success' && ` (${ended(derived.status)})`}
        </Box>
      )}
    </Typography>
  );
}

/** A trial's outcome, what it kept first and its step times behind an expander: a trial's outcome names every step it took. */
function TrialLine({ tried }: { tried: DumpBuild }) {
  const [open, setOpen] = useState(false);
  const [said, steps] = (tried.outcome ?? 'ended well').split(/; steps: /);
  return (
    <Box component="span" display="block">
      Last trial {formatRelativeTime(tried.finishedAt ?? tried.startedAt)}
      {tried.status === 'success' ? `: ${said}` : ` (${ended(tried.status)})`}
      {tried.status === 'success' && steps && (
        <>
          {' '}
          <Button size="small" variant="text" sx={{ p: 0, minWidth: 0, fontSize: 'inherit', verticalAlign: 'baseline' }} onClick={() => setOpen(!open)}>
            {open ? 'Hide step times' : 'Step times'}
          </Button>
          <Collapse in={open}>{steps.split(', ').map(step => <Box key={step} component="span" display="block">{step}</Box>)}</Collapse>
        </>
      )}
    </Box>
  );
}

/** For a dump only a copy's build reads: which copy that is, in place of a build of its own (#2415). */
export function InputOfLine({ dump, copy }: { dump: DumpsDumpsItem; copy: DumpsDumpsItem | undefined }) {
  if (!dump.inputOf) return null;
  return (
    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
      Read by the build of {copy?.keeps?.title ?? 'its copy'}, with its own dump of the same date
    </Typography>
  );
}
