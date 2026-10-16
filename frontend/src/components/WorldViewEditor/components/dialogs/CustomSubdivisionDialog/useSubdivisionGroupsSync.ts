/**
 * Keeps the dialog's groups in the database (#595): once the dialog has read
 * them (`settle`), every change is saved a second after the last one, and only
 * when it differs from what the database already holds. A load that failed
 * saves nothing, so an empty dialog never overwrites the groups it could not read.
 *
 * Saves for a region go out one at a time, each with the groups as they are
 * when it is sent: the server serializes saves on the region's lock, which
 * orders their arrival, not the edits, so two in flight could land the older
 * set last. `stop` ends saving and waits for one in flight, so a later
 * deletion of the groups cannot be overwritten by it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveRegionSubdivisionGroups } from '../../../../../api/regions';
import { groupsBodyOf } from './groupsStorage';
import type { SubdivisionGroup } from './types';

const SAVE_DELAY_MS = 1000;

export interface SubdivisionGroupsSync {
  /**
   * The groups as read, and whether they still have to be saved (an earlier
   * session's, adopted); `onSaved` runs once that first save has landed.
   */
  settle: (groups: SubdivisionGroup[], options?: { save?: boolean; onSaved?: () => void }) => void;
  /** End saving, and resolve once a save in flight has finished. */
  stop: () => Promise<void>;
  /** Save again after a `stop`, from the next change on. */
  resume: () => void;
  /** What went wrong saving, in words; null when nothing did. */
  error: string | null;
}

export function useSubdivisionGroupsSync(regionId: number | null, open: boolean, groups: SubdivisionGroup[]): SubdivisionGroupsSync {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = useRef<string | null>(null);
  const latest = useRef(groups);
  const flight = useRef<Promise<void> | null>(null);
  const flightGeneration = useRef(0);
  // What a flush reads when it runs, not when it was asked for: the region shown
  // and whether saving is on (off before the first read, after a stop, when closed).
  const live = useRef({ region: regionId, saving: false });
  const onSaved = useRef<(() => void) | null>(null);
  // Bumped on a new region, on close and on stop: a loop of an earlier one sends nothing more.
  const generation = useRef(0);
  latest.current = groups;
  live.current = { region: open ? regionId : null, saving: open && ready && regionId !== null };

  useEffect(() => {
    generation.current += 1;
    live.current = { ...live.current, saving: false };
    setReady(false);
    setError(null);
    saved.current = null;
    onSaved.current = null;
  }, [regionId, open]);

  const settle = useCallback((read: SubdivisionGroup[], options?: { save?: boolean; onSaved?: () => void }) => {
    saved.current = options?.save ? null : JSON.stringify(groupsBodyOf(read));
    onSaved.current = options?.onSaved ?? null;
    setReady(true);
  }, []);

  /** Send the latest groups until what the database holds is what the dialog shows. */
  const flush = useCallback(() => {
    const { region, saving } = live.current;
    if (!saving || region === null) return;
    if (flight.current) {
      // One of an earlier region or opening is still out: this one goes after it,
      // rather than waiting for a next edit that may never come.
      if (flightGeneration.current !== generation.current) flight.current.finally(flush);
      return;
    }
    const ofGeneration = generation.current;
    flightGeneration.current = ofGeneration;
    flight.current = (async () => {
      try {
        for (;;) {
          if (generation.current !== ofGeneration) return;
          const body = groupsBodyOf(latest.current);
          const serialized = JSON.stringify(body);
          if (serialized === saved.current) return;
          await saveRegionSubdivisionGroups(region, body);
          // Landed after the dialog moved on: what it saved says nothing of the region shown now.
          if (generation.current !== ofGeneration) return;
          saved.current = serialized;
          setError(null);
          onSaved.current?.();
          onSaved.current = null;
        }
      } catch {
        // A failed save of the region left behind is no news about the one shown.
        if (generation.current === ofGeneration) setError('The groups were not saved; the next change tries again.');
      } finally {
        flight.current = null;
      }
    })();
  }, []);

  useEffect(() => {
    if (!open || !ready || regionId === null) return undefined;
    if (JSON.stringify(groupsBodyOf(groups)) === saved.current) return undefined;
    const timer = setTimeout(flush, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [groups, open, ready, regionId, flush]);

  const stop = useCallback(async () => {
    generation.current += 1;
    live.current = { ...live.current, saving: false };
    setReady(false);
    await flight.current;
  }, []);

  const resume = useCallback(() => setReady(true), []);

  return { settle, stop, resume, error };
}
