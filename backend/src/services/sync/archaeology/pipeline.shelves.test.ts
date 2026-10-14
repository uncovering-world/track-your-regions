/**
 * The department shelves and the map as the archaeology run reads them (#889,
 * ADR-0104): a museum only the department categories name is what its own
 * signals say — the Altes Museum archaeological by OpenStreetMap's
 * `museum=archaeological`, the Cleveland Museum of Art refused as an art museum
 * with an Egyptian gallery — while a museum the source already admits keeps
 * its department question.
 */

import { describe, it, expect } from 'vitest';
import { collect, item, reason, world, ART_MUSEUM, type World } from './pipelineFixture.js';

describe('the department shelves and the map (#889)', () => {
  /**
   * Two museums only the department shelves name, as English Wikipedia files
   * them on 2026-10-14: the Altes Museum, typed `history museum` and `art
   * museum` and mapped `museum=archaeological`; the Cleveland Museum of Art,
   * typed `art museum` and mapped `museum=art`.
   */
  const shelved = (): World => {
    const w = world();
    w.museums.Q156722 = {
      label: 'Altes Museum', classes: ['Q16735822', ART_MUSEUM], sitelinks: 44,
      lat: 52.5194, lon: 13.3984, articleUrl: 'https://en.wikipedia.org/wiki/Altes_Museum',
      categories: ['Art museums and galleries in Berlin', 'History museums in Germany', 'Museums of ancient Greece in Germany'],
      inNatureCategories: true,
    };
    w.osm.Q156722 = [{ ref: 'way/1', tags: { tourism: 'museum', museum: 'archaeological' } }];
    w.museums.Q657415 = {
      label: 'Cleveland Museum of Art', classes: [ART_MUSEUM], sitelinks: 32,
      lat: 41.5089, lon: -81.6119, articleUrl: 'https://en.wikipedia.org/wiki/Cleveland_Museum_of_Art',
      categories: ['Art museums and galleries in Ohio', 'Egyptological collections in the United States'],
      inNatureCategories: true,
    };
    w.osm.Q657415 = [{ ref: 'way/2', tags: { tourism: 'museum', museum: 'art' } }];
    return w;
  };

  it('admits a museum the map calls archaeological, and says so', async () => {
    const out = await collect(shelved());

    expect(item(out, 'Q156722')).toMatchObject({ nature: 'archaeological', natureWhy: 'map: museum=archaeological', admissionNote: null });
  });

  it('refuses by name a department in what the map calls an art museum', async () => {
    const out = await collect(shelved());

    expect(item(out, 'Q657415')).toBeUndefined();
    expect(reason(out, 'Q657415')).toBe(
      'an antiquities department in an art museum (map: museum=art, category: Egyptological collections in the United States)',
    );
  });

  it('still holds the Hermitage mapped `museum=art`, which a famous find carries over the line', async () => {
    const w = shelved();
    w.osm.Q132783 = [{ ref: 'way/3', tags: { tourism: 'museum', museum: 'art' } }];
    const out = await collect(w);

    expect(item(out, 'Q132783')?.admissionNote).toContain('an antiquities department');
  });
});

