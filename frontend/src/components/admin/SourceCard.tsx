/**
 * A source's card on the Sync panel, for a source that runs alone: its last
 * run, the run in flight with its progress and Cancel, the starts and the
 * source's own controls. A source that fills its kind from one gather with
 * others is drawn on its pass's card instead (`PassCard`, ADR-0132).
 */

import { Box, Typography, Card, CardContent, CardActions } from '@mui/material';
import DragIcon from '@mui/icons-material/DragIndicator';
import type { ExperienceSource } from '../../api/admin';
import { formatDateTime } from '../../utils/dateFormat';
import { CurationGateControls } from './CurationGateControls';
import { SourceLineControls } from './SourceLineControls';
import { WikidataReaderControls } from './WikidataReaderControls';
import { WikidataCacheSection } from './WikidataCacheSection';
import { RunStatusChip, SourceRunView } from './SourceRunView';
import { SourceRunActions } from './SourceRunActions';
import { useSourceRun } from './useSourceRun';

export function SourceCard({ source }: { source: ExperienceSource }) {
  const run = useSourceRun(source.id);

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <DragIcon sx={{ color: 'text.disabled', cursor: 'grab', mt: 0.5 }} />
            <Box>
              <Typography variant="h6">{source.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                {source.description}
              </Typography>
            </Box>
          </Box>
          <RunStatusChip source={source} run={run} />
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Last synced: {formatDateTime(source.last_sync_at)}
        </Typography>

        <SourceRunView run={run} />
        <CurationGateControls source={source} />
        <SourceLineControls source={source} />
        <WikidataReaderControls source={source} />

        {/* Inside the source's own card, closed: what a run remembers is a
            property of that source, and it is a thing to open when a run
            surprises you rather than something to read on every visit. */}
        <WikidataCacheSection sourceId={source.id} />
      </CardContent>

      <CardActions sx={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
        <SourceRunActions source={source} run={run} running={run.isRunning} runningStatus={run.status} />
      </CardActions>
    </Card>
  );
}
