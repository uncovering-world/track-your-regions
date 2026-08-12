/**
 * One source's curation gate, in the sync panel: the switch, what it is holding,
 * and the one action that releases it (ADR-0025, and `docs/tech/experiences.md`
 * § "Turning a source's gate on, and letting it go").
 *
 * Its own file rather than more of `SyncPanel.tsx`, which is a panel about
 * *running* syncs. This is about what a run is allowed to show, which is a
 * different question with different consequences, and the copy carries most of
 * its weight — a switch whose label is the column name would be a switch nobody
 * dares to touch.
 */

import { useState, useEffect } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText,
  DialogTitle, Divider, FormControlLabel, Switch, Typography,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  setCurationGate, publishWaiting, type ExperienceCategory, type WaitingCounts,
} from '../../api/admin';
import { invalidateAfterBatchPublication } from '../../utils/queryInvalidation';
import { plural } from '../../utils/plural';
import { noticeFor } from './curationGateNotice';

/**
 * What is waiting, said in the reader's terms rather than the column's.
 *
 * Only the non-zero kinds, because "0 holding a change" is noise a person has to
 * read past every time. Nothing waiting is worth its own sentence: the panel's
 * question is "does this need me", and an empty line answers it badly.
 */
function waitingSentence(waiting: WaitingCounts | null): string {
  // The server could not count. Said rather than shown as "Nothing waiting.", which is
  // the answer a curator acts on by leaving the source alone.
  if (waiting === null) return 'How much this source is holding could not be counted.';
  const parts: string[] = [];
  if (waiting.arrivals > 0) parts.push(`${plural(waiting.arrivals, 'object')} nobody has read`);
  if (waiting.contents > 0) parts.push(`${plural(waiting.contents, 'visible object')} holding unread contents`);
  if (waiting.held > 0) parts.push(`${plural(waiting.held, 'visible object')} holding a change`);
  return parts.length === 0 ? 'Nothing waiting.' : parts.join(' · ');
}

/**
 * What the switch means, in its current position.
 *
 * More than one sentence when the gate goes off with a backlog, because "everything
 * this source finds reaches readers" is true of future runs and silent about what is
 * already waiting — and what happens to that backlog is **not one answer**:
 *
 * - an unread object or unread contents stay put, since they are `pending` rows and
 *   only a person moves a row out of `pending` (ADR-0025 decision 5: publishing is an
 *   update to that predicate, not a replay of something withheld);
 * - a change the run is holding does the opposite. It is not a `pending` row but a
 *   visible one carrying a pointer, and the hold is `requires_curation AND
 *   curation_state <> 'pending'`, so with the gate off the next run writes the
 *   proposed values and clears the pointer. No curator ever sees that card.
 *
 * **Both answers are said in both switch positions**, and that is the whole point of the
 * split below: while the gate is on they are subjunctive — what the click *would* do,
 * which is what someone deciding needs — and once it is off they are indicative, a
 * statement of where the backlog now stands. A consequence of a click that appears only
 * after the click is a report, and reports do not inform decisions. Getting this right
 * for one answer and not the other is how it was wrong twice in a row here: first the
 * held half rendered only after the flip, then the unread half did.
 */
function gateConsequence(gateOn: boolean, waiting: WaitingCounts | null): string {
  if (waiting !== null) return gateOn ? gatedConsequence(waiting) : ungatedConsequence(waiting);
  // Count-free but **not silent**, and the difference is the whole of this branch. Both
  // answers are said as classes, because the one this drops is the only consequence on
  // this control a flip back cannot undo: once the next run has applied a held change the
  // pointer is cleared, and re-gating restores nothing. Saying nothing would leave an
  // admin deciding without knowing the class of thing exists — one step worse than the
  // report-after-the-click this docblock is written against. And the unknown is not
  // independent of the risk: the aggregate that fails is the one that gets slow on a
  // grown, gated catalogue, which is exactly a source holding a real backlog.
  const now = gateOn ? GATE_ON_NOW : GATE_OFF_NOW;
  return gateOn
    ? `${now} What it is already holding could not be counted, so how much is not said here `
      + '— only what would become of it: unread objects and unread contents would stay '
      + 'waiting for a person, while any change being held back would be applied by the '
      + 'next run of this source instead.'
    : `${now} What it was holding could not be counted: anything unread stays waiting for a `
      + 'person, and any change that was being held back will be applied by the next run of '
      + 'this source instead.';
}

const GATE_ON_NOW = 'New objects from this source arrive invisible to readers, and a change to a '
  + 'visible object is kept back, until a curator passes it. What was published before the '
  + 'switch stays visible.';

const GATE_OFF_NOW = 'Everything this source finds from now on reaches readers as soon as a run '
  + 'writes it.';

/** The switch is on: what it holds, and what switching it off would *not* undo. */
function gatedConsequence(waiting: WaitingCounts): string {
  const sentences = [GATE_ON_NOW];
  // Count-free on purpose, because `waitingSentence` renders beside this text and gives the
  // shape per kind: an unread object and a visible object holding unread points are two
  // different kinds of work, and one number over the pair would name whichever the reader
  // assumes.
  if (waiting.arrivals + waiting.contents > 0) {
    sentences.push('What is already waiting to be published would stay waiting: switching the '
      + 'gate off publishes nothing, because only a person can release it.');
  }
  // The opposite answer, and the one that surprises: switching off does not release the
  // held changes to a curator — it releases them to the next run, which writes them with
  // nobody looking.
  if (waiting.held > 0) {
    const one = waiting.held === 1;
    const subject = one ? 'change' : `${waiting.held} changes`;
    sentences.push(`Switching it off would not hand the ${subject} being held back to a curator: `
      + `the next run of this source would apply ${one ? 'it' : 'them'} instead.`);
  }
  return sentences.join(' ');
}

/** The switch is off: what runs do from now on, and where the old backlog stands. */
function ungatedConsequence(waiting: WaitingCounts): string {
  const sentences = [GATE_OFF_NOW];
  // The two kinds that really do stay put: an unread object and unread contents are
  // `pending` rows, and nothing but a person moves a row out of `pending`.
  if (waiting.arrivals + waiting.contents > 0) {
    sentences.push('What is already waiting to be published stays waiting — switching the gate off '
      + 'publishes nothing, because only a person can release it.');
  }
  // A held change is the exception, and saying otherwise here would be the more
  // damaging half: it is not a `pending` row but a *visible* one carrying a pointer,
  // and the hold is `requires_curation AND curation_state <> 'pending'` (`syncUtils`).
  // With the gate off that condition is false, so the next run of this source writes
  // the proposed values and clears the pointer — no curator ever sees the card.
  if (waiting.held > 0) {
    const one = waiting.held === 1;
    const subject = one ? 'The change' : `The ${waiting.held} changes`;
    sentences.push(`${subject} being held back will be applied by the next run of this source `
      + 'instead of waiting for a curator, since nothing will be holding '
      + `${one ? 'it' : 'them'} back any more.`);
  }
  return sentences.join(' ');
}

export function CurationGateControls({ source }: { source: ExperienceCategory }) {
  const queryClient = useQueryClient();
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const gateMutation = useMutation({
    mutationFn: (requiresCuration: boolean) => setCurationGate(source.id, requiresCuration),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'sources'] });
    },
  });

  const releaseMutation = useMutation({
    mutationFn: () => publishWaiting(source.id),
    // Cleared when a run starts, not only when one succeeds: `notice` is written in
    // `onSuccess` and dismissed by the reader, so without this the previous run's
    // "40 objects published." sat unqualified beside this run's failure alert — and
    // the ordinary use of this control is two clicks, since the first release is what
    // reveals whether anything refuses.
    onMutate: () => setNotice(null),
    onSuccess: result => setNotice(noticeFor(result)),
    // Both closed and refreshed on **either** path, and the failing path is the one
    // that needs the refresh most. Each object is its own transaction, so a timeout on
    // object 301 of 1272 leaves 300 published — and the alert says so ("Some objects
    // may already be visible") beside a panel still reading "1272 objects nobody has
    // read" and a button still offering to publish 1272, with the object and
    // `region-locations` caches stale in the same window. Refetching after a request
    // that turned out to change nothing costs one query; the alternative the copy
    // used to leave was a page reload.
    //
    // The dialog closes here for the same reason: its backdrop covered the one message
    // that matters and put `aria-hidden` over the tree it lives in, with the publish
    // button enabled again — inviting a second full run over a source whose earlier
    // objects are already committed.
    onSettled: () => {
      setConfirmPublish(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'sources'] });
      // The batch form, not the object form: `invalidateExperiences(qc)` with nothing
      // named reaches no object keys by design — a caller who changed one object is
      // expected to say which — and this call changed a whole source's worth. The
      // batch helper invalidates those keys by prefix, including the region batch
      // that draws the pins, which is the one a released museum needs and the list
      // refetch cannot cover.
      invalidateAfterBatchPublication(queryClient);
    },
  });

  const waiting = source.waiting;
  const anythingWaiting = waiting !== null
    && waiting.arrivals + waiting.held + waiting.contents > 0;
  // No button when the count failed, and that is not caution for its own sake: the
  // confirmation names what it will release, and "Publish all waiting" over an unknown
  // backlog could name nothing.
  const releasable = waiting === null ? 0 : waiting.arrivals + waiting.contents;

  // The confirmation is dropped on the same fact that offers it, because `['admin',
  // 'sources']` refetches *underneath* an open dialog: every polled sync that completes
  // invalidates it, and so does the gate switch. Two ways the ground moves, and
  // `releasable === 0` is the one condition that covers both — the count failing, and the
  // count arriving as nothing because a run marked those arrivals missing or another
  // curator answered them from the queue. Left open, the dialog reads "Each is recorded on
  // its own, so the log still says." with every count-gated line gone, over a button
  // saying **Publish 0**; and left `true` behind an unmounted dialog it re-opens on the
  // next refetch that does have counts, over whatever the admin moved on to.
  useEffect(() => {
    if (releasable === 0) setConfirmPublish(false);
  }, [releasable]);

  return (
    <>
      <Divider sx={{ my: 2 }} />

      <FormControlLabel
        control={(
          <Switch
            checked={source.requires_curation}
            onChange={e => gateMutation.mutate(e.target.checked)}
            disabled={gateMutation.isPending}
          />
        )}
        label="Hold new and changed content for review"
      />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {gateConsequence(source.requires_curation, waiting)}
      </Typography>

      <Typography variant="body2" sx={{ fontWeight: anythingWaiting ? 600 : 400 }}>
        {waitingSentence(waiting)}
      </Typography>

      {releasable > 0 && (
        <Button
          size="small"
          variant="outlined"
          sx={{ mt: 1 }}
          onClick={() => setConfirmPublish(true)}
          disabled={releaseMutation.isPending}
        >
          Publish all waiting
        </Button>
      )}

      {notice && <Alert severity="info" sx={{ mt: 1 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      {gateMutation.isError && (
        <Alert severity="error" sx={{ mt: 1 }}>The switch did not change. Reload to see where it stands.</Alert>
      )}
      {releaseMutation.isError && (
        // Not "nothing was published", which is the wrong direction to be wrong in
        // for a control whose point is that unreviewed content does not reach
        // readers by accident. The batch commits one transaction per object, so a
        // failure part-way through — or a timeout on a long backlog — leaves the
        // objects it already got through visible. What is actually known is that it
        // stopped, and where to look.
        <Alert severity="error" sx={{ mt: 1 }}>
          The batch stopped before finishing. Some objects may already be visible — reload to see
          what is still waiting.
        </Alert>
      )}

      {/* Mounted on the same condition the button is offered on, not on the weaker one
          the type permits: every line inside names a count, so `waiting !== null` alone
          would keep it mounted over `{0, 0, 0}` — a dialog whose sentences have all
          dropped out and whose primary button says "Publish 0". The effect above closes
          it; this is the mount agreeing with the effect rather than with the type. */}
      {waiting !== null && releasable > 0 && (
      <Dialog open={confirmPublish} onClose={() => setConfirmPublish(false)}>
        <DialogTitle>Publish everything waiting for {source.name}?</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            {waiting.arrivals > 0 && (
              <Box component="p" sx={{ mt: 0 }}>
                {plural(waiting.arrivals, 'object')} nobody has read{' '}
                {waiting.arrivals === 1 ? 'becomes' : 'become'} visible to readers, with the points
                and works waiting under {waiting.arrivals === 1 ? 'it' : 'them'}.
              </Box>
            )}
            {waiting.contents > 0 && (
              <Box component="p" sx={{ mt: waiting.arrivals > 0 ? undefined : 0 }}>
                {plural(waiting.contents, 'object')} readers can already see{' '}
                {waiting.contents === 1 ? 'keeps its' : 'keep their'} own state and{' '}
                {waiting.contents === 1 ? 'gains' : 'gain'} the points and works waiting under{' '}
                {waiting.contents === 1 ? 'it' : 'them'} — the {waiting.contents === 1 ? 'object' : 'objects'}
                {' '}{waiting.contents === 1 ? 'does' : 'do'} not become visible, because{' '}
                {waiting.contents === 1 ? 'it is' : 'they are'} visible already.
              </Box>
            )}
            <Box component="p">
              {/* Kind-aware, because the sentence above it denies exactly what the
                  merged version asserted: for an already-visible object the audit row
                  records what was released under it, not that it became visible. */}
              Each is recorded on its own, so the log still says
              {waiting.arrivals > 0 && ' when an object became visible'}
              {waiting.arrivals > 0 && waiting.contents > 0 && ', and'}
              {waiting.contents > 0 && ' what was released under an object readers already had'}
              .
            </Box>
            {waiting.held > 0 && (
              <Box component="p">
                {plural(waiting.held, 'change')} to{' '}
                {waiting.held === 1 ? 'an object' : 'objects'} readers can already see will
                <strong> not</strong> be published here. A change overwrites what a reader is looking
                at, so it stays on its own card where you can see the old value beside the new one.
              </Box>
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmPublish(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => releaseMutation.mutate()}
            disabled={releaseMutation.isPending}
          >
            Publish {releasable}
          </Button>
        </DialogActions>
      </Dialog>
      )}
    </>
  );
}
