/**
 * The maps app a visitor opens places in (#1604): `null` asks each time, with
 * every maps app side by side (ADR-0115).
 *
 * A signed-in visitor's choice is kept with the account, so it travels between
 * devices. A signed-out visitor's is kept in this browser, a per-viewer
 * convenience that is lost with the browser's storage. Storage can be
 * refused (a private window, blocked site data); then the choice lasts the
 * page, and the links side by side are what a fresh page shows.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAPS_APPS, type MapsApp } from '@tyr/shared/preferences';
import { getMyPreferences, saveMyPreferences, type MyPreferences } from '../api/preferences';
import { queryKeys } from '../api/queryKeys';
import { useAuth } from './useAuth';

const STORAGE_KEY = 'tyr.mapsApp';

/** What this browser holds, or null where it holds nothing it may read as a maps app. */
export function storedMapsApp(): MapsApp | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return (MAPS_APPS as readonly string[]).includes(value ?? '') ? (value as MapsApp) : null;
  } catch {
    return null;
  }
}

function storeMapsApp(app: MapsApp | null): void {
  try {
    if (app === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, app);
  } catch {
    // Storage refused: the choice lasts this page.
  }
}

export interface MapsAppChoice {
  mapsApp: MapsApp | null;
  setMapsApp: (app: MapsApp | null) => void;
  /** Whether a signed-in choice is on its way to the server. */
  saving: boolean;
  /** Whether the last save failed; the choice shown is then the one the server holds. */
  failed: boolean;
}

function useMapsAppState(): MapsAppChoice {
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const key = queryKeys.preferences.mine(user?.id);
  const [local, setLocal] = useState<MapsApp | null>(storedMapsApp);

  // Another tab's choice reaches this one.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) setLocal(storedMapsApp()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Read again when the tab comes back into view: a choice made on another device
  // reaches this one then, rather than at the next page load. One small read,
  // signed in only, where the app keeps focus refetches off everywhere else.
  const mine = useQuery({
    queryKey: key, queryFn: getMyPreferences, enabled: isAuthenticated, staleTime: Infinity, refetchOnWindowFocus: 'always',
  });
  // A save carries the account it was made under: the cache it answers is that
  // account's, and nothing of it is shown once another account is signed in.
  const save = useMutation({
    mutationFn: ({ app }: { app: MapsApp | null; userId: number | undefined }) => saveMyPreferences(app),
    // A read still on its way would land after the save and put the old choice back.
    onMutate: ({ userId }) => queryClient.cancelQueries({ queryKey: queryKeys.preferences.mine(userId) }),
    // And a read a refocus started while the save was on its way is dropped before the answer lands.
    onSuccess: async (saved: MyPreferences, { userId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.preferences.mine(userId) });
      queryClient.setQueryData(queryKeys.preferences.mine(userId), saved);
    },
  });
  // And is dropped when the account changes, so a later save starts clean.
  const { reset } = save;
  useEffect(() => { reset(); }, [user?.id, reset]);

  const setMapsApp = useCallback((app: MapsApp | null) => {
    if (isAuthenticated) save.mutate({ app, userId: user?.id });
    else {
      storeMapsApp(app);
      setLocal(app);
    }
  }, [isAuthenticated, save, user?.id]);

  if (!isAuthenticated) return { mapsApp: local, setMapsApp, saving: false, failed: false };
  // Read in this render, before the reset above has run: the save is this account's or nothing.
  const ours = save.variables?.userId === user?.id;
  const saving = ours && save.isPending;
  const mapsApp = saving ? save.variables?.app ?? null : mine.data?.mapsApp ?? null;
  return { mapsApp, setMapsApp, saving, failed: ours && save.isError };
}

/** No provider, as in a component rendered alone: ask each time, and nothing to save. */
const ASK_EACH_TIME: MapsAppChoice = { mapsApp: null, setMapsApp: () => undefined, saving: false, failed: false };

const MapsAppContext = createContext<MapsAppChoice>(ASK_EACH_TIME);

/** Holds the visitor's choice once for the whole app, so thirty rows read one answer. */
export function MapsAppProvider({ children }: { children: ReactNode }) {
  const choice = useMapsAppState();
  return <MapsAppContext.Provider value={choice}>{children}</MapsAppContext.Provider>;
}

export function useMapsApp(): MapsAppChoice {
  return useContext(MapsAppContext);
}
