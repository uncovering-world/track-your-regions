/**
 * A source's one start and its Cancel (#1805): *Start Sync*, which does every
 * step a current catalogue needs — the run, the items of the components it
 * left without one, the near-places pairing — with the run's modes as options
 * of that one button (a preview, a run without the cache, a run that asks
 * again about pins), and the single-purpose actions under *More*, each saying
 * when it is needed: a picture repair, now, and the component search over
 * every site or one, for after a rule changes. The start that failed and the
 * Cancel the server refused are said in words.
 */

import { useState } from 'react';
import { Box, Typography, Button, ButtonGroup, Alert, Menu, MenuItem, ListItemText, TextField, Collapse } from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import StopIcon from '@mui/icons-material/Stop';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
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

/** The one button's menu: the same run in another mode, each said in a line. */
function StartSyncMenu({ source, run, disabled }: { source: ExperienceSource; run: SourceRun; disabled: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { starts } = run;
  const pick = (start: () => void) => () => { setAnchor(null); start(); };
  return (
    <>
      <ButtonGroup variant="outlined" color="primary" disabled={disabled}>
        <Button startIcon={<SyncIcon />} onClick={() => starts.sync.mutate()}>
          Start Sync
        </Button>
        <Button size="small" aria-label="How to run the sync" onClick={(e) => setAnchor(e.currentTarget)}>
          <ArrowDropDownIcon />
        </Button>
      </ButtonGroup>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        <MenuItem onClick={pick(() => starts.dryRun.mutate())}>
          <ListItemText primary="Preview (dry run)" secondary="The same run, with nothing written: what it would change, as a changeset." />
        </MenuItem>
        {/* Only where there is a cache to ignore: offering to bypass a cache a
            source does not keep would be the same pretence the cache panel
            refuses when it says "This source caches nothing". */}
        {source.caches && (
          <MenuItem onClick={pick(() => starts.refresh.mutate())}>
            <ListItemText
              primary="Without the cache"
              secondary="Asks the source everything again and leaves what was kept untouched; the next ordinary run uses it again. Takes the full collection time."
            />
          </MenuItem>
        )}
        {/* Its own mode: an ordinary run keeps a pin it disagrees with in the curator's own words. */}
        <MenuItem onClick={pick(() => starts.askPins.mutate())}>
          <ListItemText
            primary="Asking again about pins"
            secondary="After a rule has changed: every row pinned in or out against the rule that the run still disagrees with waits in the review queue again, with who set the pin and why."
          />
        </MenuItem>
      </Menu>
    </>
  );
}

/** What the one run does, said for this source: only the World Heritage run looks for its components' items. */
function StartSyncCaption({ source }: { source: ExperienceSource }) {
  return (
    <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 260 }}>
      {source.findsComponentItems
        ? 'One run brings the source up to date: it reads the source, finds the Wikidata items of the components it left without one, and pairs what it brought with near places of similar names.'
        : 'One run brings the source up to date: it reads the source and pairs what it brought with near places of similar names.'}
      {' '}It preserves curator edits, visit history, manual region assignments and rejections; a point the
      source stops offering is marked, not deleted.
    </Typography>
  );
}

/** One single-purpose action: the button, and the sentence saying when it is needed. */
function SecondaryAction({ children, when }: { children: React.ReactNode; when: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
      {children}
      <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 240 }}>{when}</Typography>
    </Box>
  );
}

export function SourceRunActions({ source, run, running, runningStatus, offers = 'all', held = false }: SourceRunActionsProps) {
  const { starts } = run;
  const [componentSite, setComponentSite] = useState('');
  const [more, setMore] = useState(false);
  const componentSiteId = /^\d+$/.test(componentSite.trim()) ? Number(componentSite.trim()) : undefined;
  // `isStarting`, not one button's own request: while a preview or a no-cache
  // run is being started, an ordinary Start would be a second run launched
  // before the first has said it exists.
  const disabled = !source.is_active || run.isStarting || held;
  const syncs = offers !== 'beside';
  const besides = offers !== 'sync';
  const secondary = besides && (source.repairsPictures || source.findsComponentItems);
  // A section offers its runs beside the pass's sync only where the source has one.
  if (!syncs && !secondary) return null;
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
      {running ? (
        <Box>
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
        </Box>
      ) : (
        <>
          {syncs && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <StartSyncMenu source={source} run={run} disabled={disabled} />
              <StartSyncCaption source={source} />
            </Box>
          )}
          {secondary && (
            <Box>
              <Button
                size="small"
                onClick={() => setMore(!more)}
                endIcon={more ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                sx={{ textTransform: 'none', color: 'text.secondary' }}
              >
                {more ? 'Fewer actions' : 'More actions'}
              </Button>
              <Collapse in={more}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
                  {/* Its own action rather than a step of the run, because it is a
                      different decision: a run proposes and this writes, past the
                      gate. Offered where the server says it acts. */}
                  {source.repairsPictures && (
                    <SecondaryAction when="For now, not for every run: it writes past the review gate. Fills in a picture that was never found from Commons, replaces or takes away one this product is not allowed to show, and leaves a curator's choice alone.">
                      <Button variant="outlined" size="small" onClick={() => starts.fixPictures.mutate()} disabled={disabled}>
                        Fix pictures
                      </Button>
                    </SecondaryAction>
                  )}
                  {source.findsComponentItems && (
                    <SecondaryAction when="After a rule of the search changes, or for one site: every component no item records the reference of is looked up in Wikidata again — about eight minutes over the whole list. An ordinary run looks only at the components it has just left without an item. Writes nothing on the components: each candidate waits for a curator.">
                      <Button variant="outlined" size="small" onClick={() => starts.findComponents.mutate(componentSiteId)} disabled={disabled}>
                        {componentSiteId === undefined ? 'Find component items' : 'Find component items for this site'}
                      </Button>
                      <TextField
                        size="small"
                        label="One site (id)"
                        value={componentSite}
                        onChange={(e) => setComponentSite(e.target.value)}
                        sx={{ width: 140 }}
                        slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': 'Search one site, by its id' } }}
                      />
                    </SecondaryAction>
                  )}
                </Box>
              </Collapse>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
