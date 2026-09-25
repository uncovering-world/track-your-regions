/**
 * A source's sitelinks line, on its card in the sync panel: the two Wikipedia-
 * language counts a run reads to decide whether an item counts (Task 8's
 * `PUT /api/admin/sync/sources/:id/line`), and a save that the *next* run
 * applies — nothing here re-runs the source or touches a row already synced.
 *
 * Renders nothing for a source whose threshold lives in code rather than on
 * its row — a row stating none of the four numbers, true for the World
 * Heritage, museums and public-art sources: showing fields for it would
 * promise a change that no run would ever read. A row stating any one of them
 * is drawn, because a half pair is a broken row and the save here is what
 * repairs it.
 *
 * A source may have two doors. Archaeology admits the site a traveller stands
 * on and the famous find a museum holds, and a find is written up in fewer
 * languages than its museum, so its row carries a second, lower pair
 * (ADR-0058 decision 5) and this card offers it a second row of fields. Same
 * rule as above: either finds column shows both finds fields, and a source
 * whose row states neither is shown none, because inventing a finds line here
 * would give it a number no run of its would read.
 */

import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, TextField, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setSourceLine, type ExperienceSource, type SourceLineBody } from '../../api/admin';
import { queryKeys } from '../../api/queryKeys';

const MIN_SITELINKS = 1;
const MAX_SITELINKS = 1000;
const RANGE_MESSAGE = `Enter a whole number from ${MIN_SITELINKS} to ${MAX_SITELINKS}.`;

/** A whole number in `[MIN_SITELINKS, MAX_SITELINKS]`, or `null` when the text is not one. */
function parseSitelinks(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return n >= MIN_SITELINKS && n <= MAX_SITELINKS ? n : null;
}

/**
 * One door read off its two fields: the numbers, whether they differ from what
 * the row holds, and what to say under a field that is wrong. Both doors are
 * the same question asked of different objects, so they are judged by one
 * function rather than by two copies of the bound that would drift apart.
 */
function doorState(
  enterRaw: string,
  stayRaw: string,
  stored: { enter: number | null; stay: number | null },
  stayAboveMessage: string,
) {
  const enter = parseSitelinks(enterRaw);
  const stay = parseSitelinks(stayRaw);
  const stayAboveEnter = enter !== null && stay !== null && stay > enter;
  let stayError: string | undefined;
  if (stay === null) stayError = RANGE_MESSAGE;
  else if (stayAboveEnter) stayError = stayAboveMessage;
  return {
    enter,
    stay,
    valid: enter !== null && stay !== null && !stayAboveEnter,
    changed: enter !== stored.enter || stay !== stored.stay,
    enterError: enter === null ? RANGE_MESSAGE : undefined,
    stayError,
  };
}

export function SourceLineControls({ source }: { source: ExperienceSource }) {
  const queryClient = useQueryClient();
  const [enterRaw, setEnterRaw] = useState(String(source.enter_sitelinks ?? ''));
  const [stayRaw, setStayRaw] = useState(String(source.stay_sitelinks ?? ''));
  const [findEnterRaw, setFindEnterRaw] = useState(String(source.find_enter_sitelinks ?? ''));
  const [findStayRaw, setFindStayRaw] = useState(String(source.find_stay_sitelinks ?? ''));
  // The stored line as of the last time the fields were synced to it, so a refetch
  // that returns the *same* numbers (this component's own save landing, an unrelated
  // invalidation of `queryKeys.admin.sources` elsewhere on the page) does not stomp an
  // edit the admin has not saved yet. Only an actual change to what the server holds
  // — another admin's save, a correction — re-seeds the fields, and it does so
  // unconditionally: an in-flight edit is discarded in that case, because the value
  // it was edited against is no longer the truth. All four numbers, since a finds
  // line moving under the card is the same event as the main line moving.
  const lastSeen = useRef({
    enter: source.enter_sitelinks, stay: source.stay_sitelinks,
    findEnter: source.find_enter_sitelinks, findStay: source.find_stay_sitelinks,
  });

  useEffect(() => {
    const stored = {
      enter: source.enter_sitelinks, stay: source.stay_sitelinks,
      findEnter: source.find_enter_sitelinks, findStay: source.find_stay_sitelinks,
    };
    const seen = lastSeen.current;
    if (seen.enter !== stored.enter || seen.stay !== stored.stay
      || seen.findEnter !== stored.findEnter || seen.findStay !== stored.findStay) {
      lastSeen.current = stored;
      setEnterRaw(String(stored.enter ?? ''));
      setStayRaw(String(stored.stay ?? ''));
      setFindEnterRaw(String(stored.findEnter ?? ''));
      setFindStayRaw(String(stored.findStay ?? ''));
    }
  }, [
    source.enter_sitelinks, source.stay_sitelinks,
    source.find_enter_sitelinks, source.find_stay_sitelinks,
  ]);

  const mutation = useMutation({
    mutationFn: (line: SourceLineBody) => setSourceLine(source.id, line),
    // The same key the panel's own list reads (`SyncPanel.tsx`'s `queryKeys.admin.sources`
    // query): the card's copy names the stored line, so a save that did not refetch it
    // would leave the fields agreeing with the server while the sentence above them did not.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.sources });
    },
  });

  // Placed after the hooks: a source with no line still renders this component (mounted
  // unconditionally beside `CurationGateControls`), so the early return has to come after
  // every hook call rather than guard the whole function.
  //
  // What there is nothing to show for is a row that states no line at all — not a
  // row whose *main* line is absent, and not a row left holding half of one. A
  // row carrying a finds line and no main one is one whose own run refuses to
  // start (`parseSourceLine` reads the main pair first and throws without it),
  // and a card that vanished for it would hide exactly the state an admin has to
  // see in order to fix it.
  //
  // All four columns, for that same reason: a row whose only surviving value is a
  // *stay* number is as broken as one with only an enter number, and hiding the
  // card for it would leave the panel saying this source keeps its line in code
  // while its run refuses to start. The fields are shown, the save is held until
  // the pairs are whole, and the repair is possible from here.
  const states = [
    source.enter_sitelinks, source.stay_sitelinks,
    source.find_enter_sitelinks, source.find_stay_sitelinks,
  ];
  if (states.every((value) => value === null)) return null;

  // Whether this source has a second door at all. Read from the row rather than
  // from a list of source ids here, for the same reason the card itself is: the
  // fields offered are exactly the numbers the run will read.
  //
  // Either column, because half a pair is a broken row and this card is where it
  // gets fixed. The run reads the finds pair in full or refuses to start
  // (ADR-0058 decision 5), so a row carrying one of the two — a hand edit of
  // `api_config` — is a source whose own run will not start; asking for both
  // columns here would hide both fields and leave the admin no way to repair it
  // from the panel. Shown, the empty partner is visible and `doorState` refuses
  // the save until both are whole numbers with stay at or below enter, so the
  // only save this offers is the one that makes the pair a door again.
  const hasFinds = source.find_enter_sitelinks !== null || source.find_stay_sitelinks !== null;
  const main = doorState(
    enterRaw, stayRaw,
    { enter: source.enter_sitelinks, stay: source.stay_sitelinks },
    'The stay line cannot be above the enter line.',
  );
  const finds = doorState(
    findEnterRaw, findStayRaw,
    { enter: source.find_enter_sitelinks, stay: source.find_stay_sitelinks },
    'The finds stay line cannot be above the finds enter line.',
  );
  const canSave = main.valid && (!hasFinds || finds.valid)
    && (main.changed || (hasFinds && finds.changed));

  const save = () => {
    if (main.enter === null || main.stay === null) return;
    const line: SourceLineBody = { enterSitelinks: main.enter, staySitelinks: main.stay };
    // Both pairs travel whenever the source has both, even when only one of them
    // was edited: the route merges what it is given, so a body naming one pair
    // would save a line the admin can see on the card but did not send.
    if (hasFinds && finds.enter !== null && finds.stay !== null) {
      line.findEnterSitelinks = finds.enter;
      line.findStaySitelinks = finds.stay;
    }
    mutation.mutate(line);
  };

  // One button for the whole line, defined once and placed on the last row of
  // fields — beside the pair for a source with one door, under both pairs for a
  // source with two. A save is of the line, not of a row.
  const saveButton = (
    <Button
      size="small"
      variant="outlined"
      disabled={!canSave || mutation.isPending}
      onClick={save}
    >
      Save line
    </Button>
  );

  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <TextField
          size="small"
          type="number"
          label="Enter at"
          value={enterRaw}
          onChange={e => setEnterRaw(e.target.value)}
          error={Boolean(main.enterError)}
          helperText={main.enterError}
          sx={{ width: 180 }}
        />
        <TextField
          size="small"
          type="number"
          label="Stay at or above"
          value={stayRaw}
          onChange={e => setStayRaw(e.target.value)}
          error={Boolean(main.stayError)}
          helperText={main.stayError}
          sx={{ width: 180 }}
        />
        {!hasFinds && saveButton}
      </Box>
      {hasFinds && (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start', mt: 1 }}>
          <TextField
            size="small"
            type="number"
            label="Finds enter"
            value={findEnterRaw}
            onChange={e => setFindEnterRaw(e.target.value)}
            error={Boolean(finds.enterError)}
            helperText={finds.enterError}
            sx={{ width: 180 }}
          />
          <TextField
            size="small"
            type="number"
            label="Finds stay"
            value={findStayRaw}
            onChange={e => setFindStayRaw(e.target.value)}
            error={Boolean(finds.stayError)}
            helperText={finds.stayError}
            sx={{ width: 180 }}
          />
          {saveButton}
        </Box>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Wikipedia languages an item needs to enter this kind, and to stay once in.
        {hasFinds && ' The second pair is the same question asked of the finds this'
          + ' kind admits, which are written up in fewer languages than the museums'
          + ' holding them.'}
        {' '}Applied by the next run; a comparison of the map at several lines is
        coming (threshold explorer).
      </Typography>
      {mutation.isError && (
        <Alert severity="error" sx={{ mt: 1 }}>The line did not save. Reload to see where it stands.</Alert>
      )}
    </Box>
  );
}
