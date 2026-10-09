/**
 * Following a source's run from the sync card: one ask on mount, then one a
 * second while a run is going, until the server says it is not.
 *
 * A chain of timeouts rather than an interval, so an ask that is slow to come
 * back never has a second one behind it. An ask that fails while a run is
 * being followed is not the end of the run: a backend restart — every source
 * edit on the development stack, a deploy in production — refuses a few asks
 * and then answers with what became of the run (#1131). So the asks back off,
 * 1, 2, 4, 8 and then every 10 seconds, and only after about two minutes of
 * refusals does the card say it has lost touch.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSyncStatus, type SyncStatus } from '../../api/admin';
import type { RunKind } from './syncRunKinds';

const POLL_MS = 1000;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 10000];
/** How long the asks may fail in a row before the card says it lost touch. */
export const LOST_TOUCH_AFTER_MS = 2 * 60 * 1000;

export interface SyncStatusPolling {
  /** The server's last answer, or the kind a run was just started as until it answers. */
  status: SyncStatus | null;
  /** Whether a run is being followed. */
  isPolling: boolean;
  /** The asks failed for about two minutes while a run was being followed. */
  lostTouch: boolean;
  /** A run was started here: name it `kind` until the server answers, and follow it. */
  follow: (kind: RunKind) => void;
  /** Ask once, now. */
  pollNow: () => void;
}

/**
 * `onIdle` hears every answer that says no run is going, with whether the one
 * before it said one was: the card refreshes what it shows on the first, and
 * says how a run ended on the second.
 */
export function useSyncStatusPolling(
  sourceId: number,
  onIdle: (status: SyncStatus, wasRunning: boolean) => void,
): SyncStatusPolling {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [lostTouch, setLostTouch] = useState(false);

  const onIdleRef = useRef(onIdle);
  const wasRunningRef = useRef(false);
  const followingRef = useRef(false);
  const failingSinceRef = useRef<number | null>(null);
  const failuresRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const pollRef = useRef<() => Promise<void>>(async () => {});
  // Moved on by `follow`: an answer to a request sent before a run was started
  // here describes the source before it, and would switch the card back to
  // idle — and its start controls back on — under a run that has begun.
  const followGenerationRef = useRef(0);

  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  const schedule = useCallback((ms: number) => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { pollRef.current(); }, ms);
  }, []);

  const poll = useCallback(async () => {
    const generation = followGenerationRef.current;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    try {
      const next = await getSyncStatus(sourceId);
      if (!mountedRef.current || generation !== followGenerationRef.current) return;
      failingSinceRef.current = null;
      failuresRef.current = 0;
      setLostTouch(false);
      setStatus(next);
      // A run found already in flight — the page was reloaded during one, or
      // another server is running it — is followed like one started here.
      followingRef.current = !!next.running;
      setIsPolling(!!next.running);
      if (next.running) {
        schedule(POLL_MS);
      } else {
        onIdleRef.current(next, wasRunningRef.current);
      }
      wasRunningRef.current = !!next.running;
    } catch (error) {
      if (!mountedRef.current || generation !== followGenerationRef.current) return;
      console.error('Error polling status:', error);
      if (!followingRef.current) {
        setIsPolling(false);
        return;
      }
      const now = Date.now();
      failingSinceRef.current ??= now;
      if (now - failingSinceRef.current >= LOST_TOUCH_AFTER_MS) {
        followingRef.current = false;
        setIsPolling(false);
        setLostTouch(true);
        return;
      }
      schedule(BACKOFF_MS[Math.min(failuresRef.current, BACKOFF_MS.length - 1)]);
      failuresRef.current += 1;
    }
  }, [sourceId, schedule]);

  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  useEffect(() => {
    mountedRef.current = true;
    poll();
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [poll]);

  const follow = useCallback((kind: RunKind) => {
    followGenerationRef.current += 1;
    setStatus({ running: true, kind });
    setIsPolling(true);
    setLostTouch(false);
    followingRef.current = true;
    failingSinceRef.current = null;
    failuresRef.current = 0;
    schedule(POLL_MS);
  }, [schedule]);

  const pollNow = useCallback(() => { poll(); }, [poll]);

  return { status, isPolling, lostTouch, follow, pollNow };
}
