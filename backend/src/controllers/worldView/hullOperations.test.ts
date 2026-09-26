import { beforeEach, describe, expect, it, vi } from 'vitest';
import { answer as answerRoute, routeAt } from '../../api/routeTesting.js';
import { worldViewRoutes } from '../../routes/worldViewRoutes.js';

/** The declared routes these specs answer through (ADR-0071). */
const getSavedHullParamsRoute = routeAt(worldViewRoutes, '/regions/:regionId/hull/params', 'get');

const poolQuery = vi.fn();
vi.mock('../../db/index.js', () => ({ pool: { query: (...args: unknown[]) => poolQuery(...args) } }));


function call(regionId: string) {
  const json = vi.fn();
  const res = { json, status: vi.fn().mockReturnThis() };
  return answerRoute(getSavedHullParamsRoute, { params: { regionId } } as never, res as never).then(() => ({ res, body: json.mock.calls[0]?.[0] }));
}

beforeEach(() => poolQuery.mockReset());

describe('getSavedHullParams', () => {
  it('serves the stored parameters by their three keys, whatever else the JSON holds', async () => {
    // Fiji's hull as an admin tuned it, with a key an older editor once wrote beside them.
    poolQuery.mockResolvedValueOnce({ rows: [{ hull_params: { bufferKm: 80, concavity: 0.95, simplifyTolerance: 0.01, preview: true } }] });
    const { body } = await call('7361');
    expect(body).toEqual({ params: { bufferKm: 80, concavity: 0.95, simplifyTolerance: 0.01 } });
  });

  it('answers null for a hull never tuned, which is built with the defaults', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ hull_params: null }] });
    const { body } = await call('7349');
    expect(body).toEqual({ params: null });
  });

  it('answers 404 for a region that does not exist', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    const { res } = await call('999999');
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
