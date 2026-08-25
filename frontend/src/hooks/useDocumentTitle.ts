/**
 * The tab names the place (#644): "Stonehenge · Europe · Track Your Regions".
 *
 * What a share preview, a history entry and a screen reader read first. Null
 * is the bare app title, and so is unmounting: a page that stops naming a
 * place must not leave the last one in the tab.
 */

import { useEffect } from 'react';

const APP_TITLE = 'Track Your Regions';

export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_TITLE}` : APP_TITLE;
    return () => { document.title = APP_TITLE; };
  }, [title]);
}
