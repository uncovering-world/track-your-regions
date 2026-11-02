/**
 * The languages a visitor reads Wikipedia in, first choice first (#2209).
 *
 * A signed-in visitor's own list is kept with the account, read from the same
 * preferences answer as the maps app (`queryKeys.preferences.mine`), so it
 * travels between devices. A signed-out visitor's is kept in this browser, and
 * a visitor who set none reads in the browser's languages. `order` is the list
 * a link reads, ending in English; `chosen` is the visitor's own list, null
 * where it is the browser's.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_READING_LANGUAGES, READING_LANGUAGE } from '@tyr/shared/preferences';
import { getMyPreferences, saveMyReadingLanguages, type MyPreferences } from '../api/preferences';
import { queryKeys } from '../api/queryKeys';
import { browserReadingLanguages, readingOrder } from '../utils/readingLanguages';
import { useAuth } from './useAuth';

const STORAGE_KEY = 'tyr.readingLanguages';

function storedLanguages(): string[] | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown;
    if (!Array.isArray(value)) return null;
    const codes = value.filter((code): code is string => typeof code === 'string' && READING_LANGUAGE.test(code) && code !== 'en');
    return codes.slice(0, MAX_READING_LANGUAGES);
  } catch {
    return null;
  }
}

function storeLanguages(codes: string[] | null): void {
  try {
    if (codes === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(codes));
  } catch {
    // Storage refused: the list lasts this page.
  }
}

export interface ReadingLanguages {
  /** The visitor's own list, first choice first, or null where the browser's is read. */
  chosen: string[] | null;
  /** The browser's languages, as Wikipedia names them. */
  browser: string[];
  /** What a link reads: the chosen list or the browser's, then English. */
  order: string[];
  setChosen: (codes: string[] | null) => void;
  /**
   * Whether the list may be changed: the account's own has been read. Until then a
   * signed-in visitor sees the browser's, and a change saved from it would replace the
   * account's list without the visitor having seen it.
   */
  ready: boolean;
  /** Whether the account's list could not be read at all; a later refetch that fails keeps the list read before. */
  unread: boolean;
  saving: boolean;
  failed: boolean;
}

function useReadingLanguagesState(): ReadingLanguages {
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [local, setLocal] = useState<string[] | null>(storedLanguages);
  const browser = useMemo(() => browserReadingLanguages(typeof navigator === 'undefined' ? [] : navigator.languages), []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) setLocal(storedLanguages()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const mine = useQuery({
    queryKey: queryKeys.preferences.mine(user?.id), queryFn: getMyPreferences,
    enabled: isAuthenticated, staleTime: Infinity, refetchOnWindowFocus: 'always',
  });
  const save = useMutation({
    mutationFn: ({ codes }: { codes: string[] | null; userId: number | undefined }) => saveMyReadingLanguages(codes),
    onMutate: ({ userId }) => queryClient.cancelQueries({ queryKey: queryKeys.preferences.mine(userId) }),
    onSuccess: async (saved: MyPreferences, { userId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.preferences.mine(userId) });
      // Its own field only: the maps app's save writes the same answer, and one that lands later
      // must not put an older list back, nor this one an older maps app.
      queryClient.setQueryData<MyPreferences>(queryKeys.preferences.mine(userId),
        held => (held ? { ...held, readingLanguages: saved.readingLanguages } : saved));
    },
  });
  const { reset } = save;
  useEffect(() => { reset(); }, [user?.id, reset]);

  const setChosen = useCallback((codes: string[] | null) => {
    if (isAuthenticated) save.mutate({ codes, userId: user?.id });
    else {
      storeLanguages(codes);
      setLocal(codes);
    }
  }, [isAuthenticated, save, user?.id]);

  const ours = isAuthenticated && save.variables?.userId === user?.id;
  const saving = ours && save.isPending;
  let chosen: string[] | null = local;
  if (isAuthenticated) chosen = saving ? save.variables?.codes ?? null : mine.data?.readingLanguages ?? null;
  const order = useMemo(() => readingOrder(chosen, browser), [chosen, browser]);
  // Held data is the account's list, whatever a later refetch says: a refocus read that
  // fails keeps it (status 'error' with data), and must not lock what is on screen.
  const ready = !isAuthenticated || mine.data !== undefined;
  const unread = isAuthenticated && mine.isError && mine.data === undefined;
  return { chosen, browser, order, setChosen, ready, unread, saving, failed: ours && save.isError };
}

/** No provider, as in a component rendered alone: English, and nothing to save. */
const ENGLISH: ReadingLanguages = {
  chosen: null, browser: [], order: ['en'], setChosen: () => undefined, ready: false, unread: false, saving: false, failed: false,
};

const ReadingLanguagesContext = createContext<ReadingLanguages>(ENGLISH);

/** Holds the visitor's languages once for the whole app, so every link reads one answer. */
export function ReadingLanguagesProvider({ children }: { children: ReactNode }) {
  const languages = useReadingLanguagesState();
  return <ReadingLanguagesContext.Provider value={languages}>{children}</ReadingLanguagesContext.Provider>;
}

export function useReadingLanguages(): ReadingLanguages {
  return useContext(ReadingLanguagesContext);
}
