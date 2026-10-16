/**
 * The tab names the place (#644): "Stonehenge · Europe · Track Your Regions".
 *
 * What a share preview, a history entry and a screen reader read first. Null
 * is the bare app title, and so is unmounting: a page that stops naming a
 * place must not leave the last one in the tab.
 */

import { useEffect } from 'react';

/**
 * The title the served document arrived with, read once before anything renames
 * the tab. On the production build that is "Track Your Regions"; the dev server
 * serves "Track Your Regions (dev server)" (`devServerTitle` in vite.config.ts), so
 * a person looking at the tab knows which shape is open — and composing with it,
 * rather than with a literal, keeps that mark once the app names a place (#1549).
 */
const APP_TITLE: string = import.meta.hot?.data?.appTitle ?? (document.title || 'Track Your Regions');
// A hot update re-evaluates this module while a place is named, and would read
// the composed title as the bare one; the first reading is carried across it.
if (import.meta.hot?.data) import.meta.hot.data.appTitle = APP_TITLE;

export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_TITLE}` : APP_TITLE;
    return () => { document.title = APP_TITLE; };
  }, [title]);
}
