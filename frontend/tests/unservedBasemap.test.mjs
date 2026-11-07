/**
 * No headless run asks OpenStreetMap's tile servers (#2351): every host the
 * maps draw OpenStreetMap's tiles from is one Chrome is told does not resolve,
 * and both lanes launch Chrome with that switch.
 */
import { describe, expect, it } from 'vitest';
import { OSM_RASTER_SOURCE } from '../src/constants/mapStyles';
import playwrightConfig from '../playwright.config';
import lighthouseRunner from '../perf/lighthouse.mjs?raw';
import {
  NO_UNSERVED_BASEMAP_FLAG, UNSERVED_BASEMAP_HOSTS, withoutUnservedBasemap,
} from './unservedBasemap.mjs';

describe('the basemap no headless run asks', () => {
  it('covers every host the maps draw OpenStreetMap\'s tiles from', () => {
    const hosts = OSM_RASTER_SOURCE.tiles.map((url) => new URL(url.replace(/\{[a-z]\}/g, '0')).hostname);
    for (const host of hosts) expect(UNSERVED_BASEMAP_HOSTS).toContain(host);
  });

  it('tells Chrome each of those hosts does not resolve', () => {
    expect(NO_UNSERVED_BASEMAP_FLAG).toBe('--host-resolver-rules=MAP tile.openstreetmap.org ~NOTFOUND');
  });

  it('adds the switch to a run\'s flags, and refuses resolver rules it would replace', () => {
    expect(withoutUnservedBasemap(['--headless=new'])).toEqual(['--headless=new', NO_UNSERVED_BASEMAP_FLAG]);
    expect(() => withoutUnservedBasemap(['--host-resolver-rules=MAP example.org 127.0.0.1'])).toThrow(/already set/);
  });

  it('is on every Playwright spec\'s browser', () => {
    expect(playwrightConfig.use?.launchOptions?.args).toContain(NO_UNSERVED_BASEMAP_FLAG);
    for (const project of playwrightConfig.projects ?? []) {
      expect(project.use?.launchOptions).toBeUndefined();
    }
  });

  it('is on the Lighthouse runner\'s browser', () => {
    // The runner launches Chrome at import, so its launch is read rather than run.
    expect(lighthouseRunner).toMatch(/chromeFlags: withoutUnservedBasemap\(budgets\.chromeFlags/);
  });
});
