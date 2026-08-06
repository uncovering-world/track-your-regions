import { describe, it, expect } from 'vitest';
import { diffPlacements } from './placementDiff.js';

describe('diffPlacements', () => {
  it('reports a work that changed hands', () => {
    const d = diffPlacements({ ophelia: ['nationalGallery'] }, { ophelia: ['tateBritain'] });
    expect(d.moved).toEqual([{ work: 'ophelia', from: ['nationalGallery'], to: ['tateBritain'] }]);
  });

  it('reports a work that lost its only venue', () => {
    const d = diffPlacements({ waterLilies: ['orangerie'] }, { waterLilies: [] });
    expect(d.lost).toEqual(['waterLilies']);
  });

  it('reports a work that found one', () => {
    const d = diffPlacements({ lastSupper: [] }, { lastSupper: ['santaMariaDelleGrazie'] });
    expect(d.gained).toEqual(['lastSupper']);
  });

  it('says nothing about a work that did not move', () => {
    const d = diffPlacements({ monaLisa: ['louvre'] }, { monaLisa: ['louvre'] });
    expect(d).toEqual({ moved: [], gained: [], lost: [], dropped: [] });
  });

  it('says nothing about a work whose venues are the same, listed in a different order', () => {
    const d = diffPlacements({ syndics: ['rijksmuseum', 'mauritshuis'] }, { syndics: ['mauritshuis', 'rijksmuseum'] });
    expect(d).toEqual({ moved: [], gained: [], lost: [], dropped: [] });
  });

  it('says nothing about a work absent from the previous run entirely', () => {
    const d = diffPlacements({}, { nightWatch: ['rijksmuseum'] });
    expect(d).toEqual({ moved: [], gained: [], lost: [], dropped: [] });
  });

  it('reports a work whose pool entry vanished as dropped, and nothing else', () => {
    // A class closure collapsed silently during design and removed the entire fresco branch
    // from the pool, taking The Last Supper with it. Nothing failed; only a pool comparison saw it.
    const d = diffPlacements({ lastSupper: ['santaMariaDelleGrazie'] }, {});
    expect(d).toEqual({ moved: [], gained: [], lost: [], dropped: ['lastSupper'] });
  });

  it('calls an empty current entry lost, not dropped: the work is still in the pool', () => {
    const d = diffPlacements({ ghentAltarpiece: ['sintBaafskathedraal'] }, { ghentAltarpiece: [] });
    expect(d).toEqual({ moved: [], gained: [], lost: ['ghentAltarpiece'], dropped: [] });
  });
});
