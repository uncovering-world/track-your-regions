/**
 * What a pin's row says stands at it (#2206), worded from what Nominatim
 * answered at the Church of the Acheiropoietos's two points on 2026-11-02.
 */

import { describe, expect, it } from 'vitest';
import { articleTitle, groundKind, groundLabel } from './PointPreviewReferences';

const NOTHING = { name: null, street: null, area: null, category: null, type: null, osmUrl: null };

describe('groundLabel', () => {
  it('names a named object with its kind and its area', () => {
    expect(groundLabel({ ...NOTHING, name: 'Αχιλλέα', street: 'Αχιλλέα', area: 'Άγιος Παύλος', category: 'highway', type: 'residential' }))
      .toBe('Αχιλλέα (street) · Άγιος Παύλος');
    expect(groundLabel({ ...NOTHING, name: 'Rotunda', area: 'Thessaloniki', category: 'amenity', type: 'place_of_worship' }))
      .toBe('Rotunda (place of worship) · Thessaloniki');
  });

  it('reads an unnamed building by its address', () => {
    expect(groundLabel({ ...NOTHING, street: '6 Π. Παπαγεωργίου', area: 'Kamara', category: 'building', type: 'yes' }))
      .toBe('building at 6 Π. Παπαγεωργίου · Kamara');
  });

  it('does not say the area twice where the object is the area', () => {
    expect(groundLabel({ ...NOTHING, name: 'Kamara', area: 'Kamara', category: 'place', type: 'neighbourhood' }))
      .toBe('Kamara (neighbourhood)');
  });

  it('says nothing where OpenStreetMap holds nothing', () => {
    expect(groundLabel(NOTHING)).toBeNull();
  });
});

describe('groundKind', () => {
  it('calls a road a street and a path what it is', () => {
    expect(groundKind({ category: 'highway', type: 'tertiary' })).toBe('street');
    expect(groundKind({ category: 'highway', type: 'footway' })).toBe('footway');
  });
});

describe('articleTitle', () => {
  it('reads the title an article link names', () => {
    expect(articleTitle('https://en.wikipedia.org/wiki/Church_of_the_Acheiropoietos')).toBe('Church of the Acheiropoietos');
    expect(articleTitle('https://en.wikipedia.org/wiki/Sculptural_Ensemble_of_Constantin_Br%C3%A2ncu%C8%99i_at_T%C3%A2rgu_Jiu'))
      .toBe('Sculptural Ensemble of Constantin Brâncuși at Târgu Jiu');
  });
});
