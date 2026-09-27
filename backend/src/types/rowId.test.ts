import { describe, expect, it } from 'vitest';
import { PG_INTEGER_MAX, rowIdSchema } from './rowId.js';

describe('a row id a request names', () => {
  it('is refused past a Postgres integer, rather than reaching the database as a 500', () => {
    // 2^53 - 2: a positive integer to JavaScript, and no row's id.
    expect(rowIdSchema.safeParse('9007199254740990').success).toBe(false);
    expect(rowIdSchema.safeParse(String(PG_INTEGER_MAX + 1)).success).toBe(false);
  });

  it('is taken up to the largest integer and from 1', () => {
    expect(rowIdSchema.parse(String(PG_INTEGER_MAX))).toBe(PG_INTEGER_MAX);
    expect(rowIdSchema.parse('1')).toBe(1);
    expect(rowIdSchema.safeParse('0').success).toBe(false);
  });
});
