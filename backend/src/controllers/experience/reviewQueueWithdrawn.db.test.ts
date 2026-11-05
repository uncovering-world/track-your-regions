import { afterAll, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { queryWithdrawn } from './reviewQueueContents.js';

afterAll(async () => {
  await pool.end();
});

it('loads withdrawn-point cards through PostgreSQL when the page has no matching row', async () => {
  const result = await queryWithdrawn({
    scopeFilter: 'TRUE',
    sourceFilter: 'AND TRUE',
    params: [0],
    ids: [0],
  });

  expect(result.rows).toEqual([]);
});
