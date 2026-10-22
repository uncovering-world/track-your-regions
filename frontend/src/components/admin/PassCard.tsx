/**
 * The Sync panel's card of a pass: several sources that fill their kinds from
 * one gather (ADR-0132), the place pass today (#1820).
 *
 * What the pass shares is drawn once: the starts and the Cancel, which run and
 * stop every source of it, and the sentence saying the gather reads through
 * the first source's Wikidata reader and cache (`places/placePass.ts`). What
 * each source holds of its own is drawn in its section: how its run ended, its
 * gate, its line, what it is holding for a curator, and its own reader and
 * cache, which the rest of its run reads through — its visit witnesses
 * (#1770), and Places of worship's works.
 */

import { useCallback, useEffect, useState } from 'react';
import { Box, Typography, Card, CardContent, CardActions, Divider } from '@mui/material';
import DragIcon from '@mui/icons-material/DragIndicator';
import type { ExperienceSource, SyncStatus } from '../../api/admin';
import { formatDateTime } from '../../utils/dateFormat';
import { CurationGateControls } from './CurationGateControls';
import { SourceLineControls } from './SourceLineControls';
import { WikidataReaderControls } from './WikidataReaderControls';
import { WikidataCacheSection } from './WikidataCacheSection';
import { RunStatusChip, SourceRunView } from './SourceRunView';
import { SourceRunActions } from './SourceRunActions';
import { useSourceRun, type SourceRun } from './useSourceRun';

interface RunReport { running: boolean; status: SyncStatus | null }

/** One source's section: how its run went, and what it decides on its own. */
function MemberSection({ source, run }: { source: ExperienceSource; run: SourceRun }) {
  return (
    <Box sx={{ mt: 2 }}>
      <Divider sx={{ mb: 2 }} />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
        <Box>
          <Typography variant="subtitle1" component="h3">{source.name}</Typography>
          <Typography variant="body2" color="text.secondary">{source.description}</Typography>
        </Box>
        <RunStatusChip source={source} run={run} />
      </Box>
      <SourceRunView run={run} />
      <CurationGateControls source={source} />
      <SourceLineControls source={source} />
      <WikidataReaderControls source={source} />
      <WikidataCacheSection sourceId={source.id} />
    </Box>
  );
}

/**
 * A later source's section, which follows its own run: a start on the card
 * begins the pass through the first source, and every later one is followed
 * from that moment (`started`), as its own status says it waits and then runs.
 */
function FollowedMemberSection({ source, started, report }: {
  source: ExperienceSource;
  started: number;
  report: (sourceId: number, run: RunReport) => void;
}) {
  const run = useSourceRun(source.id);
  const { followStarted, isRunning, status } = run;
  useEffect(() => {
    if (started > 0) followStarted();
  }, [started, followStarted]);
  useEffect(() => {
    report(source.id, { running: isRunning, status });
  }, [report, source.id, isRunning, status]);
  return <MemberSection source={source} run={run} />;
}

/** `sources` are the pass's, in the order it runs them. */
export function PassCard({ sources }: { sources: ExperienceSource[] }) {
  const [first, ...later] = sources;
  const [started, setStarted] = useState(0);
  const run = useSourceRun(first.id, () => setStarted((n) => n + 1));
  const [reports, setReports] = useState<Record<number, RunReport>>({});
  const report = useCallback((sourceId: number, next: RunReport) => {
    setReports((all) => ({ ...all, [sourceId]: next }));
  }, []);

  // The pass is going while any source of it is: the first one's run ends
  // before the later ones', and the card's Cancel stops them all from there
  // (`cancelSync` in `syncOrchestrator.ts`), reading its phase from the one
  // that is going.
  const goingLater = later.map((source) => reports[source.id]).find((r) => r?.running);
  const running = run.isRunning || !!goingLater;
  const runningStatus = run.isRunning ? run.status : goingLater?.status ?? null;
  const lastSynced = sources
    .map((source) => source.last_sync_at)
    .filter((at): at is string => at !== null)
    .sort()
    .at(-1) ?? null;

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 2 }}>
          <DragIcon sx={{ color: 'text.disabled', cursor: 'grab', mt: 0.5 }} />
          <Box>
            <Typography variant="h6">{sources.map((source) => source.name).join(' · ')}</Typography>
            <Typography variant="body2" color="text.secondary">
              One run fills these kinds from one gather from Wikidata, in this order: a start runs
              them all, and a Cancel stops them all. The gather reads Wikidata as {first.name}'s
              switch says and keeps its answers in {first.name}'s cache.
            </Typography>
          </Box>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Last synced: {formatDateTime(lastSynced)}
        </Typography>

        <MemberSection source={first} run={run} />
        {later.map((source) => (
          <FollowedMemberSection key={source.id} source={source} started={started} report={report} />
        ))}
      </CardContent>

      <CardActions sx={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
        <SourceRunActions source={first} run={run} running={running} runningStatus={runningStatus} />
      </CardActions>
    </Card>
  );
}
