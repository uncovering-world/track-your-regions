/**
 * A public clock with a show below Public art's line (#2140): asked below the
 * pool's floor, filed as a clock, and held to its own line of editions and a
 * year's readers, measured on the dev subset on 2026-10-30.
 */

import { describe, it, expect } from 'vitest';
import { classifyPublicArt, PUBLIC_ART_KIND } from './pipeline.js';
import { PUBLIC_ART_RULE } from './kindRules.js';
import { buildTrees } from './classes.js';
import { CLOCK_LINE } from './clockLine.js';
import { belowGuidedLine } from '../places/guidedLine.js';
import { emptyContainment } from '../places/containment.js';
import type { PoolEntity } from './queries.js';

const GLOCKENSPIEL = 'Q20826189';
const ASTRONOMICAL_CLOCK = 'Q5275';
const MUNICH = 'Q7295591';
const BESANCON = 'Q751968';

const trees = buildTrees({ sculptural: [], fountain: [], commemorative: [], museum: [], worship: [], lost: [] });

const entity = (qid: string, label: string, sitelinks: number): PoolEntity => ({
  qid, label, description: null, lat: 48.1374, lon: 11.5755, onEarth: true, imageUrl: null, itemPictures: [],
  sitelinks, countryLabel: null, articleUrl: null, website: null, year: null,
});

/** The kind's share of a gather that named the Rathaus-Glockenspiel and Besançon's clock. */
const gathered = () => {
  const pool = new Map([[MUNICH, entity(MUNICH, 'Rathaus-Glockenspiel', 7)], [BESANCON, entity(BESANCON, 'astronomical clock of Besançon', 7)]]);
  const facts = new Map([[MUNICH, [GLOCKENSPIEL]], [BESANCON, [ASTRONOMICAL_CLOCK]]].map(([qid, classes]) => [qid as string, {
    classes: classes as string[], locations: [], parents: [], collections: [], creators: [], commemorates: [], depicts: [], genres: [],
  }]));
  return {
    trees, pool, facts, byId: new Set<string>(), containers: emptyContainment(), subjects: new Map(),
    entered: new Set<string>(), enteredOnly: new Set<string>(),
  };
};

const readers = new Map([[MUNICH, 65_572], [BESANCON, 5_949]]);

describe('a public clock below the line (#2140)', () => {
  it('is asked of Wikidata below the pool floor, down to the stay line', () => {
    expect(PUBLIC_ART_KIND.belowFloor?.(trees)).toEqual({ classes: [ASTRONOMICAL_CLOCK, GLOCKENSPIEL], floor: CLOCK_LINE.stay.editions });
  });

  it('enters as a clock where it clears its own line, and stays out where it does not', () => {
    const { items, filtered } = classifyPublicArt(gathered(), PUBLIC_ART_RULE, new Set(), undefined, null, null, readers);
    expect(items.map((i) => [i.qid, i.type])).toEqual([[MUNICH, 'clock']]);
    expect(filtered).toEqual([]);
  });

  it('falls with both measures named once the source holds it and it reads under the stay line', () => {
    const { filtered } = classifyPublicArt(gathered(), PUBLIC_ART_RULE, new Set([BESANCON]), undefined, null, null, readers);
    expect(filtered).toEqual([{
      externalId: BESANCON, name: 'astronomical clock of Besançon', type: 'clock',
      reason: belowGuidedLine(CLOCK_LINE, 7, 5_949, false),
    }]);
  });

  it('lets nothing new in where no year of readers is read', () => {
    const { items } = classifyPublicArt(gathered(), PUBLIC_ART_RULE, new Set(), undefined, null, null, null);
    expect(items).toEqual([]);
  });

  it('is judged by the kind\'s line alone where the run reads no clock readers', () => {
    const { items } = classifyPublicArt(gathered(), PUBLIC_ART_RULE, new Set());
    expect(items).toEqual([]);
  });
});
