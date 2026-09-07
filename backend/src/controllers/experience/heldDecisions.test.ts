/**
 * An answer is recorded as the catalogue stores a name (#835).
 *
 * A decision is keyed by the part's name and matched by the proposed value,
 * and both used to be written straight from the record. A record filed before
 * the writers tidied names its part with the run of spaces the run saw; an
 * answer keyed by that would not meet the tidied record the next run files,
 * and a refusal would come back on the card. Tidied at the write, the unique
 * key on `part_name` is a key on the tidied form, which is what keeps the
 * scalar `answerOfPartSql` a single row.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { recordHeldAnswers } from './heldDecisions.js';

function fakeClient() {
  const query = vi.fn(async (_sql: string, _params: unknown[]) => ({ rows: [], rowCount: 1 }));
  return { client: { query } as unknown as PoolClient, query };
}

describe('recordHeldAnswers', () => {
  it('records the part name and a name-carrying value as a person would type them', async () => {
    const { client, query } = fakeClient();

    await recordHeldAnswers(client, 1184, 7, 'refused', [
      { row: { kind: 'locations', ref: '874-752', name: 'marmalo  IV', field: 'name' }, value: ' marmalo  V ' },
      { row: { kind: 'treasures', ref: 'Q1', name: 'W', field: 'artists' }, value: ['Ivan  Shishkin', 7] },
      { row: { kind: null, ref: null, name: null, field: 'nameLocal.ar' }, value: 'a  b' },
    ]);

    const bound = query.mock.calls.map(call => call[1]);
    expect(bound[0][3]).toBe('marmalo IV');
    expect(bound[0][6]).toBe(JSON.stringify('marmalo V'));
    expect(bound[1][6]).toBe(JSON.stringify(['Ivan Shishkin', 7]));
    expect(bound[2][3]).toBeNull();
    expect(bound[2][6]).toBe(JSON.stringify('a b'));
  });

  it('leaves a value that is not a name as it is', async () => {
    const { client, query } = fakeClient();

    await recordHeldAnswers(client, 1184, 7, 'refused', [
      { row: { kind: 'locations', ref: '874-752', name: 'marmalo IV', field: 'location' }, value: { lon: 3, lat: 4 } },
      { row: { kind: null, ref: null, name: null, field: 'description' }, value: 'x  y' },
    ]);

    const bound = query.mock.calls.map(call => call[1]);
    expect(bound[0][6]).toBe(JSON.stringify({ lon: 3, lat: 4 }));
    expect(bound[1][6]).toBe(JSON.stringify('x  y'));
  });
});
