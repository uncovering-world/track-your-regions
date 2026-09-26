import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/index.js', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../db/index.js';
import { answer, routeAt } from '../api/routeTesting.js';
import { healthRoutes } from '../routes/healthRoutes.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const getHealthRoute = routeAt(healthRoutes, '/health');

function makeRes() {
  const res = { json: vi.fn(), status: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe('the health check', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('answers the server up and its database answering', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const res = makeRes();

    await answer(getHealthRoute, {}, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'ok', database: 'connected' }));
  });

  it('answers 503 with the same fields, and a sentence, when the database does not answer', async () => {
    mockedQuery.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
    const res = makeRes();

    await answer(getHealthRoute, {}, res);

    expect(res.status).toHaveBeenCalledWith(503);
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({ error: 'The database is not answering', status: 'error', database: 'disconnected' });
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
  });
});
