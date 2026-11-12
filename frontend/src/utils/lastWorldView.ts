/**
 * The world view a reader last had open, kept for the pages that carry none
 * in their address (#2474): the review page's links open a place in it.
 *
 * Its own module, importing nothing, so the review page reads it without
 * reaching the navigation context, which would cut that context out of the
 * entry chunk (`ReviewPlaceLink`). Kept in the session's storage: a tab
 * remembers its own world view, and a storage that refuses (a private
 * window) leaves the link on its fallback.
 */

const KEY = 'tyr.lastWorldViewId';

/** Remember the world view a place page shows: an id for a custom one, null for the default. */
export function rememberWorldView(worldViewId: number | null): void {
  try {
    if (worldViewId === null) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, String(worldViewId));
  } catch {
    // A storage that refuses keeps nothing; the link falls back on its own.
  }
}

/** The custom world view last open in this tab, or null where none was, or none can be read. */
export function lastWorldView(): number | null {
  try {
    const value = Number(sessionStorage.getItem(KEY));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}
