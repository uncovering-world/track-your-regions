/**
 * The admin's view of a copy the catalogue builds from a dump (#1583): what it
 * is, which dump it was built from, and a notice only when something needs
 * doing, naming the one action and how long it takes. The development tools
 * for the same dump (verify, build from the file on disk, derive again, the
 * sample and the trial) sit in the page's *For developers* section.
 */

import { Alert, Box, Button, Paper, Tooltip, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cancelDumpBuild, startDumpKeep, startDumpRederive, type DumpsDumpsItem } from '../../api/admin/dumps';
import { queryKeys } from '../../api/queryKeys';
import { BuildProgressDetails, dumpDate } from './DumpBuildProgress';

type Needs = NonNullable<DumpsDumpsItem['keeps']>['needs'];

/** What each state asks of the admin: the sentence, the button, and what pressing it costs. */
function noticeOf(needs: Needs, built: boolean, newest: string | null, datedBy: DumpsDumpsItem['datedBy']) {
  if (needs === 'newer-dump') {
    const of = newest ? `, of ${dumpDate(newest, datedBy)}` : '';
    return { says: `A newer dump is out${of}.`, action: 'Update', costs: 'Takes several hours. The catalogue keeps working as usual meanwhile.' };
  }
  if (needs === 'recompute') {
    return { says: 'The app was updated, and the copy\'s tables need recomputing.', action: 'Recompute', costs: 'Takes a few minutes. Nothing is downloaded.' };
  }
  if (needs === 'rebuild') {
    return built
      ? { says: 'The app was updated, and the copy needs a full update.', action: 'Update', costs: 'Takes several hours. The catalogue keeps working as usual meanwhile.' }
      : { says: 'There is no copy yet: syncs that read it cannot run.', action: 'Build', costs: 'Takes several hours.' };
  }
  return null;
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

export function WikidataCopyCard({ dump }: { dump: DumpsDumpsItem }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.dumps });
  const update = useMutation({ mutationFn: () => startDumpKeep(dump.key, 'newest'), onSettled: refresh });
  const recompute = useMutation({ mutationFn: () => startDumpRederive(dump.key), onSettled: refresh });
  const stop = useMutation({ mutationFn: () => cancelDumpBuild(dump.key), onSettled: refresh });
  if (!dump.keeps) return null;
  const { built, needs, newestDumpDate } = dump.keeps;
  const notice = noticeOf(needs, built !== null, newestDumpDate, dump.datedBy);
  const refused = update.error ?? recompute.error ?? stop.error;
  const press = needs === 'recompute' ? recompute : update;
  return (
    <Paper variant="outlined" sx={{ p: 2, maxWidth: 900 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography variant="h6">Wikidata copy</Typography>
        <Tooltip title="Wikidata publishes a new dump every week or two. Update the copy to bring its edits into the catalogue; syncs keep reading the old copy until the new one is ready.">
          <InfoOutlinedIcon fontSize="small" color="action" aria-label="About the Wikidata copy" />
        </Tooltip>
      </Box>
      <Typography variant="body2" color="text.secondary">
        Syncs read Wikidata from this copy, not from the live service.
        {built && ` Built from the dump of ${dumpDate(built.dumpDate, dump.datedBy)}.`}
      </Typography>

      <CardState dump={dump} notice={notice} built={built !== null} press={() => press.mutate()} pressing={press.isPending}
        stop={() => stop.mutate()} stopping={stop.isPending} />
      {refused && <Typography variant="body2" color="error" sx={{ mt: 1 }}>{(refused as Error).message}</Typography>}
    </Paper>
  );
}
