/**
 * A source's starts and its Cancel: a run, a preview, a full collection, a run
 * that asks again about pins, a picture repair and a component search, with
 * the start that failed and the Cancel the server refused said in words.
 */

import { useState } from 'react';
import { Box, Typography, Button, Alert, Tooltip, TextField } from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import StopIcon from '@mui/icons-material/Stop';
import type { ExperienceSource, SyncStatus } from '../../api/admin';
import type { SourceRun } from './useSourceRun';

/** What the Cancel button should say for the phase the run is in. */
function cancelLabel(status: SyncStatus | null): string {
  // Read from the run's log row: another server holds it, and the flag a
  // cancel sets lives in that server's memory (#1131).
  if (status?.progressAt) return 'Running on another server';
  if (status?.status === 'assigning') return 'Assigning regions…';
  // Refused but still running: the item loop is over and the run is closing up.
  if (status?.cancellable === false) return 'Finishing…';
  return 'Cancel';
}

interface SourceRunActionsProps {
  /** The source the buttons start, and whose flags say which starts it offers. */
  source: ExperienceSource;
  /** Its run: the starts, the Cancel and their answers. */
  run: SourceRun;
  /**
   * Whether a run the buttons stand for is going, and its status, which a
   * Cancel reads its phase from. The source's own run on its card; on a
   * pass's card, the run of whichever source of the pass is going (ADR-0132).
   */
  running: boolean;
  runningStatus: SyncStatus | null;
  /**
   * Which starts the buttons offer: all of them on a source's own card; on a
   * pass's card, the pass's sync starts on top (`sync`) and each source's
   * own runs beside a sync in its section (`beside`): a picture repair, a
   * component search.
   */
  offers?: 'all' | 'sync' | 'beside';
  /**
   * Another run holds the source's pass, so a start would be refused: a
   * pass's starts wait while a member repairs its pictures.
   */
  held?: boolean;
}

const START_FAILED: Record<keyof SourceRun['starts'], string> = {
  sync: 'Failed to start sync',
  dryRun: 'Failed to start dry run',
  refresh: 'Failed to start sync without cache',
  askPins: 'Failed to start the run that asks again about pins',
  fixPictures: 'Failed to start the picture repair',
  findComponents: 'Failed to start the component search',
};

export function SourceRunActions({ source, run, running, runningStatus, offers = 'all', held = false }: SourceRunActionsProps) {
  const { starts } = run;
  const [componentSite, setComponentSite] = useState('');
  const componentSiteId = /^\d+$/.test(componentSite.trim()) ? Number(componentSite.trim()) : undefined;
  // `isStarting`, not one button's own request: while a preview or a no-cache
  // run is being started, an ordinary Start would be a second run launched
  // before the first has said it exists.
  const disabled = !source.is_active || run.isStarting || held;
  const syncs = offers !== 'beside';
  const besides = offers !== 'sync';
  // A section offers its runs beside the pass's sync only where the source has one.
  if (!syncs && !source.repairsPictures && !source.findsComponentItems) return null;
  // And a sync is the pass's to cancel, on top: a section cancels only a run of its own.
  if (!syncs && running && (runningStatus?.kind ?? 'sync') === 'sync') return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, width: '100%' }}>
      {(Object.keys(START_FAILED) as (keyof SourceRun['starts'])[])
        .filter((key) => starts[key].isError)
        .map((key) => (
          // Every start says why it did not start: a failed one sets
          // `isStarting`, so the card looks busy for a moment and then simply
          // does not start, with nothing on screen saying why.
          <Alert key={key} severity="error">
            {START_FAILED[key]}: {(starts[key].error as Error)?.message}
          </Alert>
        ))}
      {run.cancelRefused && (
        <Alert severity="info" onClose={run.dismissCancelRefused}>
          {/* The two ways a press lands on nothing, told apart by what the
              poll that followed it found. Either way the honest answer is
              that this run is over, not that the button failed. */}
          {running
            ? 'This run is past the point a cancel can stop it — it is finishing what it started.'
            : 'There was nothing to cancel: this run had already ended.'}
        </Alert>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {!running ? (
          <>
            {syncs && (
            <>
            <Button startIcon={<SyncIcon />} onClick={() => starts.sync.mutate()} disabled={disabled} variant="outlined" color="primary">
              Start Sync
            </Button>
            <Button variant="outlined" onClick={() => starts.dryRun.mutate()} disabled={disabled}>
              Dry run
            </Button>
            {/* Only where there is a cache to ignore: offering to bypass a
                cache a source does not keep would be the same pretence the
                cache panel refuses when it says "This source caches nothing". */}
            {source.caches && (
              // "Leaves it untouched", not "replaces it": a run with the cache
              // off neither reads nor writes it, so what is kept survives with
              // its original age and the next ordinary run uses it again. The
              // button that actually replaces an answer is Clear, in the cache
              // panel — which is what its own text says.
              <Tooltip title="An ordinary sync that ignores what we kept from the source and asks it everything again. Leaves the cache untouched — nothing is deleted and nothing is replaced, so the next ordinary sync uses the kept answers again. To replace them, clear them below. Takes the full collection time, about a quarter of an hour for museums.">
                <span>
                  <Button variant="outlined" onClick={() => starts.refresh.mutate()} disabled={disabled}>
                    Sync without cache
                  </Button>
                </span>
              </Tooltip>
            )}
            {/* Its own button: an ordinary run keeps a pin it disagrees with
                in the curator's own words. */}
            <Tooltip title="An ordinary sync that also asks a curator again about every row pinned in or out of this source against its rule, where the run still disagrees — after a rule has changed, the answers given on purpose as well. Nothing is released: each pin waits in the review queue with who set it, when, its note and the run's reason. The closing line says how many it asked about and how many it agrees with.">
              <span>
                <Button variant="outlined" onClick={() => starts.askPins.mutate()} disabled={disabled}>
                  Ask again about pins
                </Button>
              </span>
            </Tooltip>
            </>
            )}
            {/* Its own button rather than part of a sync, because it is a
                different decision: a sync proposes and this writes. Offered
                where the server says it acts — the museums' missing pictures,
                and the World Heritage ones whose host does not license them
                to us. */}
            {besides && source.repairsPictures && (
              <Tooltip title="Puts right the pictures of this source's rows, now, without waiting for review: a picture that was never found is filled in from Commons, and one this product is not allowed to show is replaced from Commons or taken away. A picture a curator chose is left alone.">
                <span>
                  <Button variant="outlined" onClick={() => starts.fixPictures.mutate()} disabled={disabled}>
                    Fix pictures
                  </Button>
                </span>
              </Tooltip>
            )}
            {besides && source.findsComponentItems && (
              <>
                <Tooltip title="Looks in Wikidata for the item of each component no item records the UNESCO reference of: an item that says it is part of the site, one of the site's kind near the point with a similar name, or one carrying the component's number under another inscription with a similar name. Writes nothing on the components — each candidate waits for a curator.">
                  <span>
                    <Button variant="outlined" onClick={() => starts.findComponents.mutate(componentSiteId)} disabled={disabled}>
                      {componentSiteId === undefined ? 'Find component items' : 'Find component items for this site'}
                    </Button>
                  </span>
                </Tooltip>
                <TextField
                  size="small"
                  label="One site (id)"
                  value={componentSite}
                  onChange={(e) => setComponentSite(e.target.value)}
                  sx={{ width: 140 }}
                  slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': 'Search one site, by its id' } }}
                />
              </>
            )}
            {syncs && (
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              A sync preserves curator edits, visit history, manual region assignments and
              rejections. A point the source stops offering is marked, not deleted; so is a
              work, once a run has seen enough of the works its museums hold to be believed.
            </Typography>
            )}
          </>
        ) : (
          <Button
            startIcon={<StopIcon />}
            onClick={run.cancel}
            // The server's own answer, not a copy of its rule: through the
            // assigning phase and past the last item it refuses a cancel,
            // because placement is already past the point the flag is read,
            // and a press left enabled would be a silent no-op.
            disabled={run.isCancelling || runningStatus?.cancellable === false}
            color="warning"
          >
            {cancelLabel(runningStatus)}
          </Button>
        )}
      </Box>
    </Box>
  );
}
