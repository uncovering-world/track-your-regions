/**
 * The subset's reading of a tower's map and visit statements (#2275), as
 * `wdt:` reads them on the live service.
 */

import { describe, expect, it } from 'vitest';
import { mastStatementsOf } from './towers.js';

describe('mastStatementsOf', () => {
  it('names the objects the item says it is mapped as, and the visit statements it carries', () => {
    // The Riga Radio and TV Tower (Q830319), as the subset kept it.
    expect(mastStatementsOf({
      P10689: [{ id: 's1', value: '87780397' }],
      P1301: [{ id: 's2', value: { amount: '+2', unit: '1' } }],
      P856: [{ id: 's3', value: 'https://www.lvrtc.lv/' }],
      P31: [{ id: 's4', value: 'Q11166728' }],
    })).toEqual({ refs: ['way/87780397'], visit: ['P1301', 'P856'] });
  });

  it('reads the best rank only, and never a statement of no value', () => {
    expect(mastStatementsOf({
      P11693: [{ id: 's1', value: '1', rank: 'deprecated' }, { id: 's2', value: '358814807' }],
      P856: [{ id: 's3', value: { novalue: true } }],
      P7772: [{ id: 's4', value: 'places/old', rank: 'deprecated' }],
    })).toEqual({ refs: ['node/358814807'], visit: [] });
  });

  it('states nothing for an item with no such statements (KFVS, Q753662)', () => {
    expect(mastStatementsOf({ P31: [{ id: 's1', value: 'Q11166728' }] })).toEqual({ refs: [], visit: [] });
  });
});
