/**
 * The geocode routes are the curator's: each asks a third party on the
 * product's behalf, so none is open (#1174). Read off the wire, so the
 * refusal comes before Nominatim is asked.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';

vi.mock('../services/authService.js', () => ({
  verifyAccessToken: vi.fn(),
  updateUserLastSeen: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../db/index.js', () => ({ pool: { query: vi.fn() } }));
vi.mock('../services/nominatim.js', () => ({
  searchNominatim: vi.fn(),
  NominatimError: class NominatimError extends Error {},
}));

import { verifyAccessToken } from '../services/authService.js';
import { searchNominatim } from '../services/nominatim.js';
import { routerOf } from '../api/route.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { geocodeRoutes } from './geocodeRoutes.js';

const mockedVerify = vi.mocked(verifyAccessToken);
const mockedSearch = vi.mocked(searchNominatim);

let server: Server;
let port: number;

beforeAll(async () => {
  const app = express();
  app.disable('x-powered-by');
  app.use(routerOf(geocodeRoutes));
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  mockedVerify.mockReset();
  mockedSearch.mockReset();
  mockedSearch.mockResolvedValue([]);
});

function status(path: string, token?: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
    const req = request({ port, path, method: 'GET', headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

const signedIn = (role: string) => mockedVerify.mockReturnValue({ sub: 7, uuid: 'u', role } as ReturnType<typeof verifyAccessToken>);

describe('the geocode routes', () => {
  it('are all declared curator', () => {
    const others = geocodeRoutes
      .filter(route => route.access !== 'curator')
      .map(route => `${route.method.toUpperCase()} ${route.path}: ${route.access}`);
    expect(others).toEqual([]);
  });

  it('refuse a place search to a caller without a token, and to a traveller, before Nominatim is asked', async () => {
    expect(await status('/search?q=Kazan%20Kremlin')).toBe(401);
    signedIn('user');
    expect(await status('/search?q=Kazan%20Kremlin', 't')).toBe(403);
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it('answer a curator\'s place search', async () => {
    signedIn('curator');
    expect(await status('/search?q=Kazan%20Kremlin', 't')).toBe(200);
    expect(mockedSearch).toHaveBeenCalledTimes(1);
  });
});
