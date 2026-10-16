import { expect, test } from '@playwright/test';

/**
 * The lane can browse either shape of the frontend: the dev server (unbundled
 * modules, HMR) or the production build a visitor gets (`vite build` served by
 * `vite preview`), chosen by FRONTEND_MODE when the stack comes up (#654). A
 * bug that exists only after bundling passes a run on the dev server, so a run
 * says which shape it browsed and proves it on the document the server sends,
 * before the app runs: the dev server marks the title (`devServerTitle` in
 * frontend/vite.config.ts) and loads `/@vite/client`, the build does neither.
 * The served document rather than the live tab: the tab keeps the mark too
 * (`useDocumentTitle` composes with it, #1549), but what the server sent is
 * decided before any app code runs, so the proof does not rest on the app.
 */
const MODE = process.env.E2E_FRONTEND_MODE === 'preview' ? 'preview' : 'dev';

test.describe('The shape the lane browses @smoke', () => {
  test(`is the ${MODE === 'preview' ? 'production build' : 'dev server'} the run asked for`, async ({ request }) => {
    const response = await request.get('/');
    expect(response.ok()).toBe(true);
    const html = await response.text();
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1];

    if (MODE === 'preview') {
      expect(title).toBe('Track Your Regions');
      expect(html).not.toContain('/@vite/client');
    } else {
      expect(title).toBe('Track Your Regions (dev server)');
      expect(html).toContain('/@vite/client');
    }
  });
});
