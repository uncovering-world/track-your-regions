import { describe, expect, it } from 'vitest';
import { insertRefusing, MAX_REFUSED, Refusals } from './refusals.js';

/**
 * A row Postgres refuses for its data is left out and named; anything else
 * still stops the build (#1434).
 */

const refusedFor = (code: string, message: string) => Object.assign(new Error(message), { code });

/** An insert that refuses any batch holding `bad`, as Postgres refuses a whole statement for one value. */
function refusing(bad: Set<string>, written: string[], code = '22P05') {
  return async (rows: string[]) => {
    const at = rows.find(row => bad.has(row));
    if (at) throw refusedFor(code, `unsupported Unicode escape sequence in ${at}`);
    written.push(...rows);
  };
}

describe('a batch Postgres refuses for its data', () => {
  it('is written row by row, leaving out only the rows it still refuses, and names them', async () => {
    const written: string[] = [];
    const refusals = new Refusals();
    const count = await insertRefusing(['Q1', 'Q2', 'Q3'], id => id, refusing(new Set(['Q2']), written), refusals);
    expect(count).toBe(2);
    expect(written).toEqual(['Q1', 'Q3']);
    expect(refusals.count).toBe(1);
    expect(refusals.note('entities')).toBe('left out 1 entities Postgres refused: Q2 (unsupported Unicode escape sequence in Q2)');
  });

  it('is written whole when nothing in it is refused, with nothing to note', async () => {
    const written: string[] = [];
    const refusals = new Refusals();
    expect(await insertRefusing(['Q1', 'Q2'], id => id, refusing(new Set(), written), refusals)).toBe(2);
    expect(refusals.note('entities')).toBeNull();
  });

  it('stops the build for anything but a data exception', async () => {
    const refusals = new Refusals();
    const diskFull = refusing(new Set(['Q1']), [], '53100');
    await expect(insertRefusing(['Q1'], id => id, diskFull, refusals)).rejects.toMatchObject({ code: '53100' });
    expect(refusals.count).toBe(0);
  });

  it('stops the build when more rows are refused than odd values explain', async () => {
    const refusals = new Refusals();
    const rows = Array.from({ length: MAX_REFUSED + 1 }, (_, i) => `Q${i + 1}`);
    await expect(insertRefusing(rows, id => id, refusing(new Set(rows), []), refusals))
      .rejects.toThrow(`Postgres refused more than ${MAX_REFUSED} rows, the first Q1`);
  });
});
