/**
 * The admin's card for a copy the catalogue builds from a dump (#1583, #2415):
 * its name and what reads it, which dump it was built from and when it was
 * swapped in, the dumps its build reads beside its own, how often it updates
 * itself, and a notice only when something needs doing, naming the one action.
 * How a file is read sits behind the info mark. The development tools for the
 * same dump (verify, build from the file on disk, derive again, the sample and
 * the trial) sit in the page's *For developers* section.
 */

import { Alert, Box, Button, IconButton, Paper, Tooltip, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cancelDumpBuild, startDumpKeep, startDumpRederive, type DumpsDumpsItem } from '../../api/admin/dumps';
import { queryKeys } from '../../api/queryKeys';
import { elapsedText } from '@tyr/shared/durations';
import { formatRelativeTime } from '../../utils/dateFormat';
import { BuildProgressDetails, dumpDate } from './DumpBuildProgress';
import { DumpScheduleLine } from './DumpScheduleLine';

type Needs = NonNullable<DumpsDumpsItem['keeps']>['needs'];

/**
 * What the last build of the copy from a newer dump cost, from its own
 * history: the honest figure for the next one. A build that only brought the
 * copy forward (the layer's daily diffs) takes minutes, and says nothing of it.
 */
export function lastBuildTook(dump: DumpsDumpsItem): string | null {
  const last = dump.builds.find(build => build.kind === 'keep' && build.status === 'success' && !build.broughtForward && build.finishedAt);
  return last?.finishedAt ? elapsedText((new Date(last.finishedAt).getTime() - new Date(last.startedAt).getTime()) / 1000) : null;
}

/** What kind of copy a notice is about: one brought forward past its dump, or one that follows another copy. */
type CopyKind = Pick<NonNullable<DumpsDumpsItem['keeps']>, 'currentTo' | 'followsInputs' | 'inputsMoved' | 'schedule'>;

/** What each state asks of the admin: the sentence, the button, and what pressing it costs. */
export function noticeOf(
  needs: Needs, built: boolean, newest: string | null, datedBy: DumpsDumpsItem['datedBy'], took: string | null, kind: CopyKind,
) {
  const meanwhile = 'The catalogue keeps working as usual meanwhile.';
  if (needs === 'newer-dump') {
    // The next build is the kind the last was, except for a copy brought forward past its dump: the
    // OpenStreetMap layer's *Update* takes the daily changes, minutes where its last planet build took hours.
    const costs = took && !kind.currentTo ? `The last build took ${took}. ${meanwhile}` : meanwhile;
    const of = newest ? ` of ${dumpDate(newest, datedBy)}` : '';
    return { says: `A newer dump${of} is out.`, action: 'Update', costs };
  }
  if (needs === 'recompute') {
    return { says: 'The app was updated, and the copy\'s tables need recomputing.', action: 'Recompute', costs: 'Takes a few minutes. Nothing is downloaded.' };
  }
  return needs === 'rebuild' ? rebuildNotice(built, kind, meanwhile) : null;
}

/**
 * Why a copy needs a rebuild, in the words of its cause: no copy yet; a copy
 * that follows another whose input moved, read as it stood meanwhile; one with
 * a part missing; or an update of the app.
 */
function rebuildNotice(built: boolean, kind: CopyKind, meanwhile: string) {
  if (!built) return { says: 'There is no copy yet. Nothing that reads it can run.', action: 'Build', costs: meanwhile };
  // A copy that follows another is rebuilt by its own schedule, where that is on (`followerStale`).
  const starts = kind.schedule.everyDays === null ? 'Its schedule is off, so this waits for Update.' : 'Its schedule starts this by itself.';
  if (kind.inputsMoved) {
    // Readership after the edition redirects moved: counted again, read as it stood meanwhile.
    return { says: 'The redirects were updated, so the copy is counted again with them.', action: 'Update', costs: `${starts} The runs read the copy as it stood meanwhile.` };
  }
  if (kind.followsInputs) {
    // A part missing, such as a month a stopped build never kept: the runs read none of it until it is built.
    return { says: 'Part of the copy is missing, so the runs cannot read it.', action: 'Update', costs: `${starts} The next build reads what is missing, and counts again any month the redirects moved under.` };
  }
  return { says: 'The app was updated, and the copy needs a full update.', action: 'Update', costs: meanwhile };
}

/** What "up to date" can honestly claim: the host asked and answered, not yet asked, or not answering. */
const CHECKED: Record<NonNullable<DumpsDumpsItem['keeps']>['newestChecked'], { says: string; sure: boolean }> = {
  answered: { says: 'Up to date', sure: true },
  'not-yet': { says: 'Checking whether a newer dump is out…', sure: false },
  unreachable: { says: 'The dumps site did not answer, so a newer dump may be out. It is asked again within a day.', sure: false },
};

/** The card's lower half: the build running, or what needs doing, or that nothing does. */
function CardState({ dump, notice, built, press, pressing, stop, stopping }: {
  dump: DumpsDumpsItem; notice: ReturnType<typeof noticeOf>; built: boolean;
  press: () => void; pressing: boolean; stop: () => void; stopping: boolean;
}) {
  if (dump.progress) {
    return (
      <Box sx={{ mt: 2, display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}><BuildProgressDetails progress={dump.progress} /></Box>
        <Button size="small" color="inherit" onClick={stop} disabled={stopping}>Stop</Button>
      </Box>
    );
  }
  if (notice) {
    return (
      <Alert
        severity={built ? 'info' : 'warning'}
        sx={{ mt: 2 }}
        action={<Button size="small" variant="contained" onClick={press} disabled={pressing}>{notice.action}</Button>}
      >
        {notice.says}
        <Typography variant="caption" display="block" color="text.secondary">{notice.costs}</Typography>
      </Alert>
    );
  }
  const checked = CHECKED[dump.keeps?.newestChecked ?? 'not-yet'];
  return (
    <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 0.5, color: checked.sure ? 'success.main' : 'text.secondary' }}>
      {checked.sure && <CheckCircleOutlineIcon fontSize="small" />}
      <Typography variant="body2">{checked.says}</Typography>
    </Box>
  );
}

/** Where the copy in place came from: the dump it was built from, or the day it is current to, and when it was swapped in. */
function builtWords(dump: DumpsDumpsItem): string | null {
  const built = dump.keeps?.built;
  if (!built) return null;
  const from = dump.keeps?.currentTo ? 'Current to' : 'Built from the dump of';
  return `${from} ${dumpDate(built.dumpDate, dump.datedBy)}, swapped in ${formatRelativeTime(built.swappedAt)}.`;
}

/** The other dumps the copy's build reads, by their names: English Wikipedia's page properties, link targets and category links. */
function inputsWords(inputs: readonly DumpsDumpsItem[]): string | null {
  if (inputs.length === 0) return null;
  const names = inputs.map(input => input.title.toLowerCase());
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  return `Its build also reads the ${list} of the same date.`;
}

export function CopyCard({ dump, inputs = [] }: { dump: DumpsDumpsItem; inputs?: readonly DumpsDumpsItem[] }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.dumps });
  const update = useMutation({ mutationFn: () => startDumpKeep(dump.key, 'newest'), onSettled: refresh });
  const recompute = useMutation({ mutationFn: () => startDumpRederive(dump.key), onSettled: refresh });
  const stop = useMutation({ mutationFn: () => cancelDumpBuild(dump.key), onSettled: refresh });
  if (!dump.keeps) return null;
  const { title, feeds, built, needs, newestDumpDate } = dump.keeps;
  const notice = noticeOf(needs, built !== null, newestDumpDate, dump.datedBy, lastBuildTook(dump), dump.keeps);
  const refused = update.error ?? recompute.error ?? stop.error;
  const press = needs === 'recompute' ? recompute : update;
  const lines = [builtWords(dump), inputsWords(inputs)].filter((line): line is string => line !== null);
  return (
    <Paper variant="outlined" sx={{ p: 2, maxWidth: 900 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography variant="h6">{title}</Typography>
        <Tooltip title={`${dump.about} ${dump.how}`} describeChild>
          <IconButton size="small" aria-label={`About the ${title}`} sx={{ p: 0.25 }}>
            <InfoOutlinedIcon fontSize="small" color="action" />
          </IconButton>
        </Tooltip>
      </Box>
      <Typography variant="body2" color="text.secondary">{feeds}</Typography>
      {lines.map(line => <Typography key={line} variant="body2" color="text.secondary">{line}</Typography>)}
      <DumpScheduleLine dump={dump} />

      <CardState dump={dump} notice={notice} built={built !== null} press={() => press.mutate()} pressing={press.isPending}
        stop={() => stop.mutate()} stopping={stop.isPending} />
      {refused && <Typography variant="body2" color="error" sx={{ mt: 1 }}>{(refused as Error).message}</Typography>}
    </Paper>
  );
}
