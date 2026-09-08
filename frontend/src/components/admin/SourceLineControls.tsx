/**
 * A source's sitelinks line, on its card in the sync panel: the two Wikipedia-
 * language counts a run reads to decide whether an item counts (Task 8's
 * `PUT /api/admin/sync/categories/:id/line`), and a save that the *next* run
 * applies — nothing here re-runs the source or touches a row already synced.
 *
 * Renders nothing for a source whose threshold lives in code rather than on
 * its row (`source.enter_sitelinks === null`, true for the World Heritage,
 * museums and public-art sources): showing fields for it would promise a
 * change that no run would ever read.
 */

import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, TextField, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setSourceLine, type ExperienceCategory } from '../../api/admin';

const MIN_SITELINKS = 1;
const MAX_SITELINKS = 1000;

/** A whole number in `[MIN_SITELINKS, MAX_SITELINKS]`, or `null` when the text is not one. */
function parseSitelinks(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return n >= MIN_SITELINKS && n <= MAX_SITELINKS ? n : null;
}

export function SourceLineControls({ source }: { source: ExperienceCategory }) {
  const queryClient = useQueryClient();
  const [enterRaw, setEnterRaw] = useState(String(source.enter_sitelinks ?? ''));
  const [stayRaw, setStayRaw] = useState(String(source.stay_sitelinks ?? ''));
  // The stored pair as of the last time the fields were synced to it, so a refetch
  // that returns the *same* pair (this component's own save landing, an unrelated
  // invalidation of `['admin', 'sources']` elsewhere on the page) does not stomp an
  // edit the admin has not saved yet. Only an actual change to what the server holds
  // — another admin's save, a correction — re-seeds the fields, and it does so
  // unconditionally: an in-flight edit is discarded in that case, because the value
  // it was edited against is no longer the truth.
  const lastSeen = useRef({ enter: source.enter_sitelinks, stay: source.stay_sitelinks });

  useEffect(() => {
    if (lastSeen.current.enter !== source.enter_sitelinks || lastSeen.current.stay !== source.stay_sitelinks) {
      lastSeen.current = { enter: source.enter_sitelinks, stay: source.stay_sitelinks };
      setEnterRaw(String(source.enter_sitelinks ?? ''));
      setStayRaw(String(source.stay_sitelinks ?? ''));
    }
  }, [source.enter_sitelinks, source.stay_sitelinks]);

  const mutation = useMutation({
    mutationFn: (line: { enterSitelinks: number; staySitelinks: number }) => setSourceLine(source.id, line),
    // The same key the panel's own list reads (`SyncPanel.tsx`'s `['admin', 'sources']`
    // query): the card's copy names the stored line, so a save that did not refetch it
    // would leave the fields agreeing with the server while the sentence above them did not.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'sources'] });
    },
  });

  // Placed after the hooks: a source with no line still renders this component (mounted
  // unconditionally beside `CurationGateControls`), so the early return has to come after
  // every hook call rather than guard the whole function.
  if (source.enter_sitelinks === null) return null;

  const enter = parseSitelinks(enterRaw);
  const stay = parseSitelinks(stayRaw);
  const stayAboveEnter = enter !== null && stay !== null && stay > enter;
  const changed = enter !== source.enter_sitelinks || stay !== source.stay_sitelinks;
  const canSave = enter !== null && stay !== null && !stayAboveEnter && changed;

  const rangeMessage = `Enter a whole number from ${MIN_SITELINKS} to ${MAX_SITELINKS}.`;
  const enterError = enter === null ? rangeMessage : undefined;
  let stayError: string | undefined;
  if (stay === null) stayError = rangeMessage;
  else if (stayAboveEnter) stayError = 'The stay line cannot be above the enter line.';

  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <TextField
          size="small"
          type="number"
          label="Enter at"
          value={enterRaw}
          onChange={e => setEnterRaw(e.target.value)}
          error={Boolean(enterError)}
          helperText={enterError}
          sx={{ width: 180 }}
        />
        <TextField
          size="small"
          type="number"
          label="Stay at or above"
          value={stayRaw}
          onChange={e => setStayRaw(e.target.value)}
          error={Boolean(stayError)}
          helperText={stayError}
          sx={{ width: 180 }}
        />
        <Button
          size="small"
          variant="outlined"
          disabled={!canSave || mutation.isPending}
          onClick={() => {
            if (enter !== null && stay !== null) mutation.mutate({ enterSitelinks: enter, staySitelinks: stay });
          }}
        >
          Save line
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Wikipedia languages an item needs to enter this kind, and to stay once in.
        Applied by the next run; a comparison of the map at several lines is coming
        (threshold explorer).
      </Typography>
      {mutation.isError && (
        <Alert severity="error" sx={{ mt: 1 }}>The line did not save. Reload to see where it stands.</Alert>
      )}
    </Box>
  );
}
