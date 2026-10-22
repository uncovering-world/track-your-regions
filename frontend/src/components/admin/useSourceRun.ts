/**
 * A source's run as its card follows it: the status polled from the server,
 * the starts and the Cancel, and what the panel holds about how the last
 * followed run ended. A source's own card holds one; a pass's card holds one
 * per source of the pass (ADR-0132), and starts the pass through the first.
 */

import { useCallback, useState } from 'react';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import {
  startSync,
  fixPictures,
  findComponentItems,
  cancelSync,
  type SyncStatus,
} from '../../api/admin';
import { useSyncStatusPolling, type SyncStatusPolling } from './useSyncStatusPolling';
import type { RunKind } from './syncRunKinds';
import { queryKeys } from '../../api/queryKeys';

export interface SourceRun extends Pick<SyncStatusPolling, 'status' | 'lostTouch'> {
  /** A run is going, being started, or started and not yet answered for. */
  isRunning: boolean;
  /** A start's request is in flight. */
  isStarting: boolean;
  /** How the last run this card followed ended, when it ended badly. */
  endedBadly: { status: string; message: string } | null;
  dismissEndedBadly: () => void;
  /** A real sync this card followed has just completed. */
  justCompleted: boolean;
  dismissCompleted: () => void;
  /** Follow a run another card's start began, as a pass's later sources do. */
  followStarted: () => void;
  starts: {
    sync: Start;
    dryRun: Start;
    refresh: Start;
    askPins: Start;
    fixPictures: Start;
    /** Narrowed to one site by its id, or every site. */
    findComponents: Start<number | undefined>;
  };
  cancel: () => void;
  isCancelling: boolean;
  /** What the server said about the last Cancel, when it said no. */
  cancelRefused: boolean;
  dismissCancelRefused: () => void;
}

/** One start's request. */
type Start<V = void> = UseMutationResult<unknown, Error, V>;

/** One start: its request, and following the run it began once it is in. */
function useStart<V = void>(request: (variables: V) => Promise<unknown>, begin: () => void): Start<V> {
  return useMutation({ mutationFn: request, onSuccess: begin });
}

/** `onStarted` hears every start this run's buttons made, once it is in. */
export function useSourceRun(sourceId: number, onStarted?: () => void): SourceRun {
  const queryClient = useQueryClient();

  // A press the server refuses — the run is already over, or the backend was
  // restarted under it — otherwise produces nothing at all on screen, which
  // reads as a button that does not work rather than as an answer.
  const [cancelRefused, setCancelRefused] = useState(false);

  // A repair that stops — Wikidata did not answer, or it was cancelled —
  // reports that on its final poll and nowhere else: it writes no sync log, so
  // the status chip goes back to the previous sync's verdict, and the sentence
  // it left would be gone in the same tick it arrived. Held here so the admin
  // reads it.
  const [endedBadly, setEndedBadly] = useState<{ status: string; message: string } | null>(null);
  const [justCompleted, setJustCompleted] = useState(false);

  // Every answer that says no run is going refreshes the source and its
  // history; one that ends a run this card was following also says how it
  // ended.
  const onIdle = useCallback((idle: SyncStatus, wasRunning: boolean) => {
    // Only a real sync earns the hint: a dry run creates no experiences, so
    // telling the admin to go and assign them would be nonsense.
    if (wasRunning && idle.status === 'complete' && !idle.dryRun) setJustCompleted(true);
    if (wasRunning && (idle.status === 'failed' || idle.status === 'cancelled')) {
      setEndedBadly({ status: idle.status, message: idle.statusMessage ?? '' });
    }
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.sources });
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.syncLogsAll });
  }, [queryClient]);
  const { status, isPolling, lostTouch, follow, pollNow } = useSyncStatusPolling(sourceId, onIdle);

  /**
   * A new run is starting: poll it, and drop what the last one was told.
   *
   * The kind is held optimistically until the first poll answers: the chip is
   * showing from the moment the request is in flight, and `status` is still
   * the previous run's until then — so without this, pressing Fix pictures
   * read "Syncing..." for the POST plus a full second, and Start Sync after a
   * repair read "Fixing pictures...". The server's word replaces it as soon
   * as there is one.
   */
  const reset = useCallback((kind: RunKind) => {
    follow(kind);
    setCancelRefused(false);
    setEndedBadly(null);
    setJustCompleted(false);
  }, [follow]);
  const followStarted = useCallback(() => reset('sync'), [reset]);
  const begin = (kind: RunKind) => () => {
    reset(kind);
    if (kind === 'sync') onStarted?.();
  };

  const starts = {
    sync: useStart(() => startSync(sourceId), begin('sync')),
    // The same run, no writes to experiences.
    dryRun: useStart(() => startSync(sourceId, { dryRun: true }), begin('sync')),
    // The same run again, asking the source everything rather than reusing
    // what it already told us.
    refresh: useStart(() => startSync(sourceId, { refreshCache: true }), begin('sync')),
    // The same run again, asking a curator again about every pin on admission
    // it disagrees with (#1370).
    askPins: useStart(() => startSync(sourceId, { askAboutPins: true }), begin('sync')),
    // Not a sync: it writes the rows straight away, because what it repairs is
    // the catalogue rather than what the source says. It reports through the
    // same status endpoint, so the card follows it the same way.
    fixPictures: useStart(() => fixPictures(sourceId), begin('repair')),
    // Proposals only: each candidate it finds waits for a curator. A site's id
    // narrows the search to that site (#1429).
    findComponents: useStart((site: number | undefined) => findComponentItems(sourceId, site), begin('components')),
  };

  const isStarting = Object.values(starts).some((start) => start.isPending);

  const cancelMutation = useMutation({
    mutationFn: () => cancelSync(sourceId),
    onSuccess: (result) => {
      // Taken: the status will say so at the next poll. Refused: say so, and
      // poll at once, so the card stops showing a run that is no longer there.
      setCancelRefused(!result.cancelled);
      if (!result.cancelled) pollNow();
    },
  });

  return {
    status,
    lostTouch,
    // `isPolling` as well as the other two. Between a start resolving and the
    // first poll answering, `isStarting` is already false and `status.running`
    // is still the previous run's — so the start controls came back for a
    // moment, and a second click in that gap is answered 409 by a server that
    // has just started the run the panel is not yet showing.
    isRunning: !!status?.running || isStarting || isPolling,
    isStarting,
    endedBadly,
    dismissEndedBadly: () => setEndedBadly(null),
    justCompleted,
    dismissCompleted: () => setJustCompleted(false),
    followStarted,
    starts,
    cancel: () => cancelMutation.mutate(),
    isCancelling: cancelMutation.isPending,
    cancelRefused,
    dismissCancelRefused: () => setCancelRefused(false),
  };
}
