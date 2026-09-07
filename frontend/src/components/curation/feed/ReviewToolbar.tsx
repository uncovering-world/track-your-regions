/**
 * The review feed's toolbar: the search, the order, and the filters, all of them
 * pieces of the page's address (ADR-0051 decision 3).
 *
 * Nothing here holds state a curator could lose. Every control reports what it
 * wants through `onChange`, the page writes it into the address, and the address
 * is what the query is asked with — so a filtered feed is a link, and the back
 * button undoes a filter. The one piece of local state is the search box's own
 * text, which is debounced: a request per keystroke would be a request per
 * keystroke over the whole union.
 *
 * The counts are never computed here. Each is the server's own facet, counted
 * over the union under every *other* filter, so a chip states what picking it
 * would leave rather than what is already on screen; before the facets arrive
 * the menus say they are counting rather than claiming a zero.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Button, InputAdornment, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import type { QueueFacets } from '../../../api/experiences';
import { isFilteredReview, normaliseReviewQ, type ReviewAddress } from '../../../utils/appUrl';
import type { ReviewPatch } from '../../../hooks/useReviewAddress';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { FilterChip } from './FilterChip';
import { RunChip } from './RunChip';
import {
  kindOptions, kindShort, regionOptions, sourceOptions,
} from './toolbarOptions';

/** How long the search box waits for the typing to stop, in ms. */
const SEARCH_DEBOUNCE_MS = 300;

export function ReviewToolbar({
  address, facets, total, onChange, onSetAside, onBringBack,
}: {
  address: ReviewAddress;
  /** Undefined until the first page answers: the chips are there, the counts are not. */
  facets: QueueFacets | undefined;
  total: number;
  /**
   * What this control wants of the address — a patch, or a function of the address for a
   * change that is relative to it (a chip toggling one id out of the list it holds). The
   * menus stay open, so two ticks can be reported before either has re-rendered, and only
   * the function form makes the second build on the first (`useReviewAddress`).
   */
  onChange: (next: ReviewPatch) => void;
  onSetAside: (runId: number) => void;
  onBringBack: (runId: number) => void;
}) {
  const [text, setText] = useState(address.q);
  const debounced = useDebouncedValue(text, SEARCH_DEBOUNCE_MS);
  // What the address was last told, so a settled search reports once and an
  // address that moves on its own (the back button, Clear all) is followed
  // rather than argued with.
  const reported = useRef(address.q);

  useEffect(() => {
    // Only a *settled* box reports: `debounced` still holds the old text for up
    // to the delay after Clear all emptied the box, and reporting it then would
    // put the search a curator just cleared straight back into the address.
    if (debounced !== text || debounced === reported.current) return;
    reported.current = debounced;
    onChange({ q: debounced });
  }, [debounced, text, onChange]);

  useEffect(() => {
    // Against the *normalised* report, because that is what the address could have made
    // of it: `q` is trimmed and capped on the way in, so a box holding `Cologne ` or a
    // pasted 101st character differs from the address it just reported and would be
    // rewritten under the curator's caret between two words.
    if (address.q === normaliseReviewQ(reported.current)) return;
    reported.current = address.q;
    setText(address.q);
  }, [address.q]);

  const clearAll = useCallback(() => {
    reported.current = '';
    setText('');
    onChange({
      q: '', sourceIds: [], kinds: [], regionId: null, runId: null,
    });
  }, [onChange]);

  // The run control names a run by its source, which only the source facet
  // knows the name of.
  const sourceNames: Record<number, string> = {};
  facets?.source.forEach(s => { sourceNames[s.id] = s.name; });

  const pending = facets === undefined;
  const sources = sourceOptions(facets, address.sourceIds);
  const kinds = kindOptions(facets, address.kinds);
  const regions = regionOptions(facets, address.regionId);
  const pickedRegion = regions.find(r => r.checked);

  // Every toggle reports a *function* of the address, never the array it rendered with.
  // These menus stay open on a tick — a multi-select with no Apply — and the location
  // update behind `onChange` lands in a transition, so a curator ticking two sources in
  // one visit to the menu computes the second from the address of the render before the
  // first, and `{ sourceIds: [2] }` replaces the `[1]` they had just asked for.
  const toggleSource = (key: string) => {
    const id = Number(key);
    onChange(cur => ({
      sourceIds: cur.sourceIds.includes(id)
        ? cur.sourceIds.filter(s => s !== id)
        : [...cur.sourceIds, id],
    }));
  };

  const toggleKind = (key: string) => {
    onChange(cur => ({
      kinds: cur.kinds.includes(key)
        ? cur.kinds.filter(k => k !== key)
        : [...cur.kinds, key],
    }));
  };

  // One region at a time: the address carries a single root (`?region=6737`),
  // and picking another is switching rather than adding.
  const toggleRegion = (key: string) => {
    const picked = key === 'none' ? 'none' : Number(key);
    onChange(cur => ({ regionId: cur.regionId === picked ? null : picked }));
  };

  /**
   * Picking a run, and showing its batch when the batch is one this curator set aside.
   *
   * The run facet is the only one counted before the set-aside rows are dropped — it has
   * to be, or a batch put aside would have no chip to come back from — so its menu offers
   * "run 98 · set aside · 1,255 open" over a list the feed then hides. Filtering by that
   * count alone answers the click with *Nothing matches*. One patch rather than two calls:
   * two writes would leave Back undoing half of a single gesture.
   */
  const pickRun = (runId: number | null) => {
    const hidden = runId !== null && facets?.run.find(r => r.id === runId)?.setAside === true;
    onChange(hidden ? { runId, showAside: true } : { runId });
  };

  const filtered = isFilteredReview(address);

  return (
    <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
      <Box sx={{
        display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', mb: 1.5,
      }}
      >
        <TextField
          size="small"
          type="search"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Find an object by name"
          sx={{ flex: '1 1 260px', maxWidth: 420 }}
          slotProps={{
            htmlInput: { 'aria-label': 'Find an object by name' },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <ToggleButtonGroup
          size="small"
          exclusive
          aria-label="The order the questions are listed in"
          value={address.sort}
          onChange={(_, next: ReviewAddress['sort'] | null) => { if (next) onChange({ sort: next }); }}
        >
          <ToggleButton value="date" sx={{ textTransform: 'none', px: 1.5 }}>Newest first</ToggleButton>
          <ToggleButton value="question" sx={{ textTransform: 'none', px: 1.5 }}>By question</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box sx={{
        display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center',
      }}
      >
        <FilterChip
          label="Source"
          value={address.sourceIds.map(id => sourceNames[id] ?? `source ${id}`).join(', ')}
          active={address.sourceIds.length > 0}
          options={sources}
          pending={pending}
          onToggle={toggleSource}
        />
        <FilterChip
          label="Question"
          value={address.kinds.map(kindShort).join(', ')}
          active={address.kinds.length > 0}
          options={kinds}
          pending={pending}
          onToggle={toggleKind}
        />
        <FilterChip
          label="Region"
          value={pickedRegion?.label ?? ''}
          active={address.regionId !== null}
          options={regions}
          pending={pending}
          onToggle={toggleRegion}
        />
        <RunChip
          runs={facets?.run ?? []}
          sources={sourceNames}
          selected={address.runId}
          setAside={facets?.setAside ?? { batches: 0 }}
          showAside={address.showAside}
          onSelect={pickRun}
          onSetAside={onSetAside}
          onBringBack={onBringBack}
          onToggleShowAside={() => onChange(cur => ({ showAside: !cur.showAside }))}
          pending={pending}
        />
        {filtered && (
          <Button size="small" color="inherit" onClick={clearAll} sx={{ textTransform: 'none' }}>
            Clear all
          </Button>
        )}
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ ml: 'auto', fontVariantNumeric: 'tabular-nums' }}
        >
          {`${total.toLocaleString('en')} open`}
        </Typography>
      </Box>
    </Box>
  );
}
