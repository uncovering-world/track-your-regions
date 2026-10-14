/**
 * The public dumps the catalogue reads (ADR-0101, #1433), grouped by who
 * publishes them: for each, what it holds, how its last build ended, and a
 * button that reads its newest complete file from the host and verifies it.
 * Earlier builds open under the row. A dump something is built from (the
 * local Wikidata subset, #1434) also has a button that builds it, and its row
 * says which dump the build in place was made from; readership and the
 * Wikipedia tables come later (#1436, #1440). A button queues the build for
 * the dump worker (ADR-0106); the row follows it through its ledger row until
 * it ends, whatever restarts the backend in between.
 */

import { Fragment, useState } from 'react';
import {
  Alert, Box, Button, Chip, Collapse, IconButton, LinearProgress, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelDumpBuild, getDumps, startDumpBuild, startDumpKeep, type DumpBuild, type DumpBuildFrom, type DumpBuildProgress, type DumpsDumpsItem,
} from '../../api/admin/dumps';
import { queryKeys } from '../../api/queryKeys';
import { formatDateTime, formatDuration, formatRelativeTime, formatTimeLeft } from '../../utils/dateFormat';

const GB = 1024 ** 3;
const size = (bytes: number) => (bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
/** A build queued for the dump worker or running in it (ADR-0106): the row follows it until it ends. */
const inFlight = (progress: DumpBuildProgress | null) => progress !== null;

/** A dump's date as what it stands for: the day of the dump, or the month its counts cover. */
function dumpDate(date: string, datedBy: DumpsDumpsItem['datedBy']): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  return datedBy === 'month'
    ? value.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : value.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

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

/** What a verified build was checked against, in the words of the check. */
function checkedBy(build: DumpBuild): string {
  if (build.status !== 'success') return '—';
  return build.checksumKind ? `${build.checksumKind} matched` : 'size matched';
}

function Outcome({ build }: { build: DumpBuild }) {
  const when = build.finishedAt ?? build.startedAt;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Chip size="small" label={OUTCOME[build.status].label} color={OUTCOME[build.status].color} />
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
  const expected = progress.file?.expectedBytes ?? null;
  const done = Math.max(progress.read, progress.downloaded);
  const measured = progress.status === 'reading' && expected !== null;
  return (
    <TableCell colSpan={5}>
      <Typography variant="body2" sx={{ mb: 0.5 }}>{progress.message}</Typography>
      <LinearProgress
        variant={measured ? 'determinate' : 'indeterminate'}
        value={measured ? Math.min(100, (done / expected) * 100) : undefined}
      />
      {progress.heartbeatAt && (
        <Typography variant="caption" color="text.secondary" display="block">
          {progress.etaSeconds !== null && `${formatTimeLeft(progress.etaSeconds)} left in this pass · `}
          Last seen alive {formatRelativeTime(progress.heartbeatAt)}
        </Typography>
      )}
      {progress.status === 'reading' && (
        <Typography variant="caption" color="text.secondary">
          {size(done)}{expected ? ` of ${size(expected)}` : ''} · {compact.format(progress.lines)} lines
        </Typography>
      )}
    </TableCell>
  );
}

function EarlierBuilds({ builds, datedBy }: { builds: DumpBuild[]; datedBy: DumpsDumpsItem['datedBy'] }) {
  return (
    <Table size="small" sx={{ mb: 1, tableLayout: 'fixed' }}>
      <Columns />
      <TableBody>
        {builds.map(build => (
          <TableRow key={build.id} sx={{ verticalAlign: 'top', '& > td': { color: 'text.secondary' } }}>
            <TableCell>
              {build.mode === 'local' ? 'From the local copy' : 'Streamed from the host'}
              {build.finishedAt && `${build.status === 'success' ? ' in' : ', ended after'} ${formatDuration(build.startedAt, build.finishedAt)}`}
              {build.error && <Typography variant="caption" color="error" display="block">{build.error}</Typography>}
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

/** What is built from the dump, and from which dump the build in place was made. */
function Kept({ dump }: { dump: DumpsDumpsItem }) {
  if (!dump.keeps) return null;
  const { title, built } = dump.keeps;
  return (
    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
      {built
        ? <>{title}: built from the dump of {dumpDate(built.dumpDate, dump.datedBy)}, {formatRelativeTime(built.swappedAt)}</>
        : <>{title}: not built yet</>}
    </Typography>
  );
}

function DumpRow({ dump }: { dump: DumpsDumpsItem }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.dumps });
  const start = useMutation({ mutationFn: (from: DumpBuildFrom) => startDumpBuild(dump.key, from), onSettled: refresh });
  const keep = useMutation({ mutationFn: (from: DumpBuildFrom) => startDumpKeep(dump.key, from), onSettled: refresh });
  const copy = dump.localCopy;
  const copyDate = copy ? dumpDate(copyIsoDate(copy.date), dump.datedBy) : null;
  // A newer file of a daily dump replaces the local copy: once verified, or first when the disk cannot hold both.
  const replaces = copy && dump.datedBy === 'day'
    ? `Downloads the newest dump if it is newer than the local copy of ${copyDate}. That copy is removed once the new one is verified, or before the download if the disk cannot hold both.`
    : '';
  const cancel = useMutation({ mutationFn: () => cancelDumpBuild(dump.key), onSettled: refresh });
  const [open, setOpen] = useState(false);
  const running = inFlight(dump.progress);
  // The build in flight is the progress cell; the rows are the builds that ended.
  const [last, ...earlier] = dump.builds.filter(build => build.status !== 'running');
  const refused = start.error ?? keep.error;
  const problem = refused ? (refused as Error).message : (!running && last?.status !== 'success' && last?.error) || null;
  const ruled = !problem && !open;
  return (
    <Fragment>
      <TableRow sx={{ verticalAlign: 'top', '& > td': ruled ? {} : { borderBottom: 'none' } }}>
        <TableCell>
          <Typography variant="body2" fontWeight={500}>{dump.title}</Typography>
          <Typography variant="caption" color="text.secondary">{dump.about}</Typography>
          <Kept dump={dump} />
          <LocalCopy dump={dump} />
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
    refetchInterval: (query) => (query.state.data?.dumps.some(d => inFlight(d.progress)) ? 3000 : false),
  });
  if (dumps.isLoading) return <LinearProgress />;
  if (dumps.isError || !dumps.data) return <Alert severity="error">The dumps could not be read.</Alert>;
  const all = dumps.data.dumps;
  const sources = [...new Set(all.map(dump => dump.source))];
  return (
    <Box>
      <Typography variant="h4" gutterBottom>Public Dumps</Typography>
      <Typography color="text.secondary" sx={{ mb: 3, maxWidth: 900 }}>
        Bulk reads come from these files rather than from the live services (ADR-0101). <em>Verify newest</em> reads
        the newest file its host has finished publishing and checks it against the published checksum, or its size
        where none is published. {dumps.data.localCopy
          ? 'Builds keep a local copy, so a cut download resumes.'
          : 'No local copy is configured (DUMPS_DIR), so each build streams the file from its host.'}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {sources.map(source => (
          <SourceTable key={source} source={source} dumps={all.filter(dump => dump.source === source)} />
        ))}
      </Box>
    </Box>
  );
}
