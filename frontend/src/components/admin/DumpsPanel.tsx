/**
 * The public dumps the catalogue reads (ADR-0101, #1433), grouped by who
 * publishes them: for each, what it holds, how its last build ended, and a
 * button that reads its newest complete file from the host and verifies it.
 * Earlier builds open under the row. A dump something is built from (the
 * local Wikidata subset, #1434) also has a button that builds it, and its row
 * says which dump the build in place was made from; readership and the
 * Wikipedia tables come later (#1436, #1440). Such a dump can also cut a
 * sample of its local copy and try the build on it, which keeps nothing and
 * says what it kept and how long each step took (#1527). A button queues the build for
 * the dump worker (ADR-0106); the row follows it through its ledger row until
 * it ends, whatever restarts the backend in between.
 */

import { Fragment, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, Collapse, IconButton, LinearProgress, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelDumpBuild, getDumps, startDumpBuild, startDumpKeep, startDumpRederive, startDumpSample, startDumpTrial,
  type DumpBuild, type DumpBuildFrom, type DumpBuildProgress, type DumpsDumpsItem,
} from '../../api/admin/dumps';
import { queryKeys } from '../../api/queryKeys';
import { BuildProgressDetails, compact, dumpDate, inFlight, size } from './DumpBuildProgress';
import { WikidataCopyCard } from './WikidataCopyCard';
import { formatDateTime, formatDuration, formatRelativeTime } from '../../utils/dateFormat';

/** One column grid for every table on the page, so the groups and the earlier builds line up. */
const COLUMN_WIDTHS = ['34%', '14%', '10%', '8%', '7%', '11%', '16%'];

function Columns() {
  return <colgroup>{COLUMN_WIDTHS.map((width, i) => <col key={i} style={{ width }} />)}</colgroup>;
}

const OUTCOME: Record<DumpBuild['status'], { label: string; color: 'success' | 'error' | 'default' }> = {
  success: { label: 'Verified', color: 'success' },
  failed: { label: 'Failed', color: 'error' },
  cancelled: { label: 'Cancelled', color: 'default' },
  running: { label: 'Running', color: 'default' },
};

/** Whether a build read the dump's own file, which its host's checksum or size verifies. */
const readsTheDump = (build: DumpBuild) => build.kind === 'verify' || build.kind === 'keep';

/** What a build that ended well is called, by what it did; one that read the dump is verified. */
const DONE: Partial<Record<DumpBuild['kind'], string>> = { rederive: 'Derived', sample: 'Cut', trial: 'Tried' };

/** What a verified build was checked against, in the words of the check; the other kinds read no file of the host's. */
function checkedBy(build: DumpBuild): string {
  if (build.status !== 'success' || !readsTheDump(build)) return '—';
  return build.checksumKind ? `${build.checksumKind} matched` : 'size matched';
}

function Outcome({ build }: { build: DumpBuild }) {
  const when = build.finishedAt ?? build.startedAt;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Chip
        size="small"
        label={build.status === 'success' ? DONE[build.kind] ?? OUTCOME.success.label : OUTCOME[build.status].label}
        color={OUTCOME[build.status].color}
      />
      <Tooltip title={formatDateTime(when)}>
        <Typography variant="body2" color="text.secondary">{formatRelativeTime(when)}</Typography>
      </Tooltip>
    </Box>
  );
}

/** The numbers of one build, as cells: the dump's date, its size, its lines, what verified it. */
function BuildFigures({ build, datedBy }: { build: DumpBuild; datedBy: DumpsDumpsItem['datedBy'] }) {
  return (
    <>
      <TableCell>
        {build.dumpDate
          ? <Tooltip title={build.fileName ?? ''}><span>{dumpDate(build.dumpDate, datedBy)}</span></Tooltip>
          : '—'}
      </TableCell>
      <TableCell align="right">{build.bytes > 0 ? size(build.bytes) : '—'}</TableCell>
      <TableCell align="right">
        <Tooltip title={`${build.lines.toLocaleString('en')} lines`}>
          <span>{build.lines > 0 ? compact.format(build.lines) : '—'}</span>
        </Tooltip>
      </TableCell>
      <TableCell>{checkedBy(build)}</TableCell>
    </>
  );
}

function ProgressCells({ progress }: { progress: DumpBuildProgress }) {
  return (
    <TableCell colSpan={5}>
      <BuildProgressDetails progress={progress} />
    </TableCell>
  );
}

function howBuilt(build: DumpBuild): string {
  if (build.kind === 'rederive') return 'Derived again from the subset in place';
  if (build.kind === 'sample') return 'Sample cut from the local copy';
  if (build.kind === 'trial') return 'Trial on the sample, kept nothing';
  return build.mode === 'local' ? 'From the local copy' : 'Streamed from the host';
}

function EarlierBuilds({ builds, datedBy }: { builds: DumpBuild[]; datedBy: DumpsDumpsItem['datedBy'] }) {
  return (
    <Table size="small" sx={{ mb: 1, tableLayout: 'fixed' }}>
      <Columns />
      <TableBody>
        {builds.map(build => (
          <TableRow key={build.id} sx={{ verticalAlign: 'top', '& > td': { color: 'text.secondary' } }}>
            <TableCell>
              {howBuilt(build)}
              {build.finishedAt && `${build.status === 'success' ? ' in' : ', ended after'} ${formatDuration(build.startedAt, build.finishedAt)}`}
              {build.error && <Typography variant="caption" color="error" display="block">{build.error}</Typography>}
              {build.outcome && <Typography variant="caption" display="block">{build.outcome}</Typography>}
            </TableCell>
            <TableCell><Outcome build={build} /></TableCell>
            <BuildFigures build={build} datedBy={datedBy} />
            <TableCell />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** A copy's date as its name gives it (`20261005`, `202609`), as the ISO day `dumpDate` reads. */
function copyIsoDate(date: string): string {
  return date.length === 8 ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : `${date.slice(0, 4)}-${date.slice(4, 6)}-01`;
}

/** The newest local copy of the dump, which a build can read instead of downloading the newest file. */
function LocalCopy({ dump }: { dump: DumpsDumpsItem }) {
  if (!dump.localCopy) return null;
  return (
    <Typography variant="caption" color="text.secondary" display="block">
      Local copy: {dumpDate(copyIsoDate(dump.localCopy.date), dump.datedBy)}, {size(dump.localCopy.bytes)}
    </Typography>
  );
}

/**
 * The sample a trial reads, and how the last trial ended: what it kept and
 * how long each step took, which is what a trial is for (#1527).
 */
function SampleLine({ dump, tried }: { dump: DumpsDumpsItem; tried: DumpBuild | undefined }) {
  if (!dump.sample && !tried) return null;
  return (
    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
      {dump.sample && <>Sample: the first part of the {dumpDate(dump.sample.date, dump.datedBy)} copy, {size(dump.sample.bytes)}</>}
      {tried && (
        <Box component="span" display="block">
          Last trial {formatRelativeTime(tried.finishedAt ?? tried.startedAt)}
          {tried.status === 'success' ? `: ${tried.outcome ?? 'ended well'}` : ` (${OUTCOME[tried.status].label.toLowerCase()})`}
        </Box>
      )}
    </Typography>
  );
}

/** What is built from the dump, from which dump the build in place was made, and when it was last derived again (#1526). */
function Kept({ dump, derived }: { dump: DumpsDumpsItem; derived: DumpBuild | undefined }) {
  if (!dump.keeps) return null;
  const { title, built } = dump.keeps;
  return (
    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
      {built
        ? <>{title}: built from the dump of {dumpDate(built.dumpDate, dump.datedBy)}, swapped in {formatRelativeTime(built.swappedAt)}</>
        : <>{title}: not built yet</>}
      {derived && (
        <Box component="span" display="block">
          Last derived again {formatRelativeTime(derived.finishedAt ?? derived.startedAt)}
          {derived.status !== 'success' && ` (${OUTCOME[derived.status].label.toLowerCase()})`}
        </Box>
      )}
    </Typography>
  );
}

function DumpRow({ dump }: { dump: DumpsDumpsItem }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.dumps });
  const start = useMutation({ mutationFn: (from: DumpBuildFrom) => startDumpBuild(dump.key, from), onSettled: refresh });
  const keep = useMutation({ mutationFn: (from: DumpBuildFrom) => startDumpKeep(dump.key, from), onSettled: refresh });
  const rederive = useMutation({ mutationFn: () => startDumpRederive(dump.key), onSettled: refresh });
  const cutSample = useMutation({ mutationFn: () => startDumpSample(dump.key), onSettled: refresh });
  const trial = useMutation({ mutationFn: () => startDumpTrial(dump.key), onSettled: refresh });
  const copy = dump.localCopy;
  const copyDate = copy ? dumpDate(copyIsoDate(copy.date), dump.datedBy) : null;
  // A newer file of a daily dump replaces the local copy: once verified, or first when the disk cannot hold both.
  const replaces = copy && dump.datedBy === 'day'
    ? `Downloads the newest dump if it is newer than the local copy of ${copyDate}. That copy is removed once the new one is verified, or before the download if the disk cannot hold both.`
    : '';
  const cancel = useMutation({ mutationFn: () => cancelDumpBuild(dump.key), onSettled: refresh });
  const [open, setOpen] = useState(false);
  const running = inFlight(dump.progress);
  // The build in flight is the progress cell; the rows are the builds that ended. The row's
  // last build is the last that read the dump's file: a re-derive, a sample and a trial read
  // none of the host's, and the re-derive and the trial have their own lines.
  const ended = dump.builds.filter(build => build.status !== 'running');
  const last = ended.find(readsTheDump);
  const derived = ended.find(build => build.kind === 'rederive');
  const tried = ended.find(build => build.kind === 'trial');
  const earlier = ended.filter(build => build !== last);
  const newest = ended[0];
  const refused = start.error ?? keep.error ?? rederive.error ?? cutSample.error ?? trial.error;
  const problem = refused ? (refused as Error).message : (!running && newest?.status !== 'success' && newest?.error) || null;
  const ruled = !problem && !open;
  return (
    <Fragment>
      <TableRow sx={{ verticalAlign: 'top', '& > td': ruled ? {} : { borderBottom: 'none' } }}>
        <TableCell>
          <Typography variant="body2" fontWeight={500}>{dump.title}</Typography>
          <Typography variant="caption" color="text.secondary">{dump.about}</Typography>
          <Kept dump={dump} derived={derived} />
          <LocalCopy dump={dump} />
          <SampleLine dump={dump} tried={tried} />
        </TableCell>
        {running && dump.progress && <ProgressCells progress={dump.progress} />}
        {!running && (
          <>
            <TableCell>
              {last ? <Outcome build={last} /> : <Typography variant="body2" color="text.secondary">Never built</Typography>}
            </TableCell>
            {last ? <BuildFigures build={last} datedBy={dump.datedBy} /> : <TableCell colSpan={4} />}
          </>
        )}
        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
          {running && <Button size="small" color="inherit" onClick={() => cancel.mutate()} disabled={cancel.isPending}>Cancel</Button>}
          {!running && (
            <Box sx={{ display: 'inline-flex', flexDirection: 'column', gap: 0.5, alignItems: 'flex-end' }}>
              <Tooltip title={replaces}>
                <Button size="small" variant="outlined" onClick={() => start.mutate('newest')} disabled={start.isPending}>Verify newest</Button>
              </Tooltip>
              {dump.keeps && (
                <Tooltip title={replaces}>
                  <Button size="small" variant="contained" onClick={() => keep.mutate('newest')} disabled={keep.isPending}>Build newest</Button>
                </Tooltip>
              )}
              {dump.keeps && copy && (
                <Tooltip title={`Build from ${copy.fileName} (${size(copy.bytes)}) without downloading the newest dump`}>
                  <Button size="small" variant="contained" color="secondary" onClick={() => keep.mutate('local')} disabled={keep.isPending}>
                    Build {copyDate} copy
                  </Button>
                </Tooltip>
              )}
              {dump.keeps?.built && (
                <Tooltip title="Rebuild the claims, labels, links and class tree from the items the subset already holds, without reading the dump again: for a change to how they are made">
                  <Button size="small" variant="outlined" color="secondary" onClick={() => rederive.mutate()} disabled={rederive.isPending}>
                    Derive again
                  </Button>
                </Tooltip>
              )}
              {dump.keeps && copy && (
                <Tooltip title={`Copy the first part of ${copy.fileName} into a small file of its own, so a change to the build can be tried in minutes instead of hours`}>
                  <Button size="small" variant="outlined" color="inherit" onClick={() => cutSample.mutate()} disabled={cutSample.isPending}>
                    Cut a sample
                  </Button>
                </Tooltip>
              )}
              {dump.keeps && dump.sample && (
                <Tooltip title="Run every step of the build on the sample, say what it kept and how long each step took, then throw the result away. The subset the runs read is not touched.">
                  <Button size="small" variant="outlined" color="inherit" onClick={() => trial.mutate()} disabled={trial.isPending}>
                    Try the build
                  </Button>
                </Tooltip>
              )}
            </Box>
          )}
          <Tooltip title={earlier.length ? 'Earlier builds' : 'No earlier builds'}>
            <span>
              <IconButton size="small" onClick={() => setOpen(!open)} disabled={!earlier.length} aria-label="Earlier builds">
                {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
        </TableCell>
      </TableRow>
      {problem && (
        <TableRow sx={{ '& > td': open ? { borderBottom: 'none' } : {} }}>
          <TableCell />
          <TableCell colSpan={6} sx={{ pt: 0 }}>
            <Typography variant="body2" color="error">{problem}</Typography>
          </TableCell>
        </TableRow>
      )}
      {open && (
        <TableRow>
          <TableCell colSpan={7} sx={{ p: 0 }}>
            <Collapse in={open}>
              <EarlierBuilds builds={earlier} datedBy={dump.datedBy} />
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}

function SourceTable({ source, dumps }: { source: string; dumps: DumpsDumpsItem[] }) {
  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 1 }}>{source}</Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" sx={{ tableLayout: 'fixed' }}>
          <Columns />
          <TableHead>
            <TableRow>
              <TableCell>Dump</TableCell>
              <TableCell>Last build</TableCell>
              <TableCell>Dump of</TableCell>
              <TableCell align="right">Size</TableCell>
              <TableCell align="right">Lines</TableCell>
              <TableCell>Checked by</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {dumps.map(dump => <DumpRow key={dump.key} dump={dump} />)}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export function DumpsPanel() {
  const dumps = useQuery({
    queryKey: queryKeys.admin.dumps,
    queryFn: getDumps,
    // A queued or running build is polled every three seconds; the worker writes its progress every five.
    // While the backend has not yet asked the host for its newest dump, every ten, until it has (#1583).
    refetchInterval: (query) => {
      const all = query.state.data?.dumps ?? [];
      if (all.some(d => inFlight(d.progress))) return 3000;
      return all.some(d => d.keeps?.newestChecked === 'not-yet') ? 10_000 : false;
    },
  });
  if (dumps.isLoading) return <LinearProgress />;
  if (dumps.isError || !dumps.data) return <Alert severity="error">The dumps could not be read.</Alert>;
  const all = dumps.data.dumps;
  const sources = [...new Set(all.map(dump => dump.source))];
  return (
    <Box>
      <Typography variant="h4" gutterBottom>Public Dumps</Typography>
      <Typography color="text.secondary" sx={{ mb: 3, maxWidth: 900 }}>
        The catalogue keeps its own copies of what Wikidata publishes, so syncs never wait on a live service.
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 4 }}>
        {all.filter(dump => dump.keeps).map(dump => <WikidataCopyCard key={dump.key} dump={dump} />)}
      </Box>
      {/* Every dump, every build and its history: for a change to how a copy is made (#1583). */}
      <Accordion disableGutters variant="outlined" sx={{ maxWidth: 1200 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box>
            <Typography>For developers</Typography>
            <Typography variant="caption" color="text.secondary">
              Every dump the catalogue reads, its builds, and the tools for trying a change to how a copy is made.
            </Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            <em>Verify newest</em> downloads the latest file and checks that it arrived whole. {dumps.data.localCopy
              ? 'A download that stops picks up where it left off.'
              : 'This server keeps no copy of the files (DUMPS_DIR is not set), so every build downloads its file again.'}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {sources.map(source => (
              <SourceTable key={source} source={source} dumps={all.filter(dump => dump.source === source)} />
            ))}
          </Box>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
