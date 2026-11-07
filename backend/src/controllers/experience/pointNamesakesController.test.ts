/**
 * The card's *Ask OpenStreetMap by name* while a run holds the process's
 * Overpass turn (#2356): the curator is answered "busy", 503, not a fault.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../middleware/errorHandler.js';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));
vi.mock('./componentItemController.js', () => ({
  componentItemsScope: vi.fn(async () => ({ permitted: true, found: true })),
}));
const ask = vi.hoisted(() => vi.fn());
vi.mock('../../services/sync/pointNamesakes.js', () => ({ askPointNamesakes: ask }));

const { askNamesakes } = await import('./pointNamesakesController.js');
const { OverpassBusyError } = await import('../../services/sync/osm/overpassOsm.js');

const caller = { id: 3, role: 'curator' } as Express.User;

afterEach(() => vi.unstubAllEnvs());

describe('askNamesakes', () => {
  it('answers 503 with the reason where OpenStreetMap is busy with a run question', async () => {
    ask.mockRejectedValueOnce(new OverpassBusyError());
    await expect(askNamesakes({ params: { id: 289, locationId: 7 }, caller } as never))
      .rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining('busy') });
  });

  it('keeps the busy sentence in production, where a 500\'s text is masked', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    ask.mockRejectedValueOnce(new OverpassBusyError());
    const error = await askNamesakes({ params: { id: 289, locationId: 7 }, caller } as never).catch((e: unknown) => e);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    errorHandler(error as Error, {} as never, res as never, () => undefined);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('busy') }));
  });

  it('leaves any other failure as it is', async () => {
    const fault = new Error('the database went away');
    ask.mockRejectedValueOnce(fault);
    await expect(askNamesakes({ params: { id: 289, locationId: 7 }, caller } as never)).rejects.toBe(fault);
  });
});
