/**
 * The run control: which run asked the questions, and what to do with a whole
 * batch of them.
 *
 * Two things live in the same menu and must not be confused. Picking a run
 * *filters* the feed by it — a curator working through what last night's sync
 * raised. *Set aside* hides that batch until its questions are answered
 * (ADR-0051 decision 4), which is a curator saying "not now" to work, not a
 * view of it; it leaves the filter exactly where it was.
 *
 * They are two menu rows rather than a row with a button on it, because a
 * button nested inside a `role="menuitem"` is invalid ARIA and unreachable
 * anyway: a menu swallows Tab and its arrows move between items, so Enter on
 * the row would only ever run the row's own action. One row per action is what
 * a keyboard can actually operate, and the mouse gets the same two targets.
 *
 * The second chip appears only once something is hidden, because a batch that
 * has been set aside is invisible by design: without a chip naming it, with its
 * number, there is no way back to it.
 */

import { useState } from 'react';
import {
  Box, Chip, Menu, MenuItem, Typography,
} from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import type { QueueFacets } from '../../../api/experiences';
import { runStamp } from './rowDate';
import { COUNT_SX } from './FilterChip';

type Run = QueueFacets['run'][number];

/** `UNESCO World Heritage · 5 Sep 14:32`, or the stamp alone for a source this page cannot name. */
function runLabel(run: Run, sources: Record<number, string>): string {
  const source = sources[run.sourceId];
  return source ? `${source} · ${runStamp(run.completedAt)}` : runStamp(run.completedAt);
}

/** What the chip itself says: the picked run, or nothing at all when none is picked. */
function chipValue(selected: number | null, runs: QueueFacets['run'], sources: Record<number, string>): string {
  if (selected === null) return '';
  const picked = runs.find(r => r.id === selected);
  // A run the current filters leave out of the facet is still the filter: it is
  // named by its number rather than dropped from the chip.
  return picked ? runLabel(picked, sources) : `run ${selected}`;
}

/** A run's two lines and its count, shared by the run menu and the set-aside menu. */
function RunRow({ title, caption, count }: { title: string; caption: string; count: number }) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'flex-start', width: '100%', gap: 1,
    }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>{title}</Typography>
        <Typography variant="caption" color="text.secondary" display="block">{caption}</Typography>
      </Box>
      <Typography variant="body2" sx={COUNT_SX}>
        {`${count.toLocaleString('en')} open`}
      </Typography>
    </Box>
  );
}

/** The word an empty menu says: still counting, or counted and there is nothing. */
function emptyNote(pending: boolean): string {
  return pending ? 'Counting…' : 'No runs in this view';
}

export function RunChip({
  runs, sources, selected, setAside, showAside, onSelect, onSetAside, onBringBack, onToggleShowAside,
  pending = false,
}: {
  runs: QueueFacets['run'];
  /** The source names, by id — built by the toolbar from the source facet. */
  sources: Record<number, string>;
  selected: number | null;
  setAside: QueueFacets['setAside'];
  showAside: boolean;
  onSelect: (id: number | null) => void;
  onSetAside: (runId: number) => void;
  onBringBack: (runId: number) => void;
  onToggleShowAside: () => void;
  /** True while the facets have not arrived — an empty list means nothing yet. */
  pending?: boolean;
}) {
  const [runAnchor, setRunAnchor] = useState<HTMLElement | null>(null);
  const [asideAnchor, setAsideAnchor] = useState<HTMLElement | null>(null);

  const value = chipValue(selected, runs, sources);
  const hidden = runs.filter(r => r.setAside);
  const unlisted = setAside.batches - hidden.length;

  return (
    <>
      <Chip
        size="small"
        variant={selected === null ? 'outlined' : 'filled'}
        color={selected === null ? 'default' : 'primary'}
        onClick={e => setRunAnchor(e.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={runAnchor !== null}
        label={(
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box component="span" sx={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {value ? `Run: ${value}` : 'Run'}
            </Box>
            <ArrowDropDownIcon fontSize="small" />
          </Box>
        )}
      />
      <Menu
        anchorEl={runAnchor}
        open={runAnchor !== null}
        onClose={() => setRunAnchor(null)}
        slotProps={{ list: { dense: true }, paper: { sx: { minWidth: 330 } } }}
      >
        {runs.length === 0 && <MenuItem disabled>{emptyNote(pending)}</MenuItem>}
        {runs.map(run => [
          <MenuItem
            key={`${run.id}-filter`}
            selected={run.id === selected}
            onClick={() => { setRunAnchor(null); onSelect(run.id === selected ? null : run.id); }}
            sx={{ alignItems: 'flex-start', py: 1 }}
          >
            <RunRow
              title={runLabel(run, sources)}
              caption={`run ${run.id}${run.setAside ? ' · set aside' : ''}`}
              count={run.count}
            />
          </MenuItem>,
          // A row of its own, so the arrows reach it and Enter runs it. The menu
          // stays open: hiding one batch is rarely the only one.
          <MenuItem
            key={`${run.id}-aside`}
            aria-label={`${run.setAside ? 'Bring back' : 'Set aside'} run ${run.id}`}
            onClick={() => (run.setAside ? onBringBack(run.id) : onSetAside(run.id))}
            sx={{ pl: 4, py: 0.5 }}
          >
            <Typography variant="caption" color="primary">
              {run.setAside ? 'Bring this run back' : 'Set aside this run'}
            </Typography>
          </MenuItem>,
        ])}
      </Menu>

      {setAside.batches > 0 && (
        <>
          <Chip
            size="small"
            color="warning"
            variant={showAside ? 'filled' : 'outlined'}
            onClick={e => setAsideAnchor(e.currentTarget)}
            aria-haspopup="menu"
            aria-expanded={asideAnchor !== null}
            label={(
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {`${setAside.batches} batch${setAside.batches === 1 ? '' : 'es'} set aside`}
                {` · ${showAside ? 'hide' : 'show'}`}
                <ArrowDropDownIcon fontSize="small" />
              </Box>
            )}
          />
          <Menu
            anchorEl={asideAnchor}
            open={asideAnchor !== null}
            onClose={() => setAsideAnchor(null)}
            slotProps={{ list: { dense: true }, paper: { sx: { minWidth: 330 } } }}
          >
            {/* The row *is* the way back — nothing else is offered here, so there
                is nothing for a nested button to compete with. */}
            {hidden.map(run => (
              <MenuItem
                key={run.id}
                onClick={() => onBringBack(run.id)}
                sx={{ alignItems: 'flex-start', py: 1 }}
              >
                <RunRow
                  title={`Bring back · ${runLabel(run, sources)}`}
                  caption={`run ${run.id}`}
                  count={run.count}
                />
              </MenuItem>
            ))}
            {unlisted > 0 && (
              <MenuItem disabled>
                <Typography variant="caption">
                  {`${unlisted} more batch${unlisted === 1 ? '' : 'es'} outside the current filters`}
                </Typography>
              </MenuItem>
            )}
            <MenuItem onClick={() => { setAsideAnchor(null); onToggleShowAside(); }}>
              {showAside ? 'Hide the set-aside rows again' : 'Show the set-aside rows in the list'}
            </MenuItem>
          </Menu>
        </>
      )}
    </>
  );
}
