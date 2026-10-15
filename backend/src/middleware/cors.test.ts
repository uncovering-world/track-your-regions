import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { request } from 'node:http';
import { AddressInfo } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';
import { apiCors, PREFLIGHT_MAX_AGE_SECONDS } from './cors.js';

const WEB = 'http://localhost:5173';

describe('apiCors on the wire', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const app = express();
    app.disable('x-powered-by');
    app.use(apiCors(WEB));
    app.get('/read', (_req, res) => {
      res.json({ ok: true });
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function send(method: string, headers: Record<string, string>) {
    return new Promise<{ status: number; headers: IncomingHttpHeaders }>((resolve, reject) => {
      const req = request({ port, path: '/read', method, headers }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  // Every web request carries Content-Type: application/json, and a signed-in
  // one Authorization too: neither is CORS-safelisted, which is what makes the
  // browser ask before sending them.
  const preflight = {
    origin: WEB,
    'access-control-request-method': 'GET',
    'access-control-request-headers': 'authorization,content-type',
  };

  it('lets the browser reuse a preflight for the capped two hours', async () => {
    const { status, headers } = await send('OPTIONS', preflight);

    expect(status).toBe(204);
    expect(headers['access-control-allow-origin']).toBe(WEB);
    expect(headers['access-control-allow-credentials']).toBe('true');
    expect(headers['access-control-max-age']).toBe(String(PREFLIGHT_MAX_AGE_SECONDS));
    expect(PREFLIGHT_MAX_AGE_SECONDS).toBeLessThanOrEqual(7200);
  });

  it('names the one origin it allows, whoever asks', async () => {
    // `cors` echoes the configured origin rather than the request's, so the
    // browser refuses the answer for any other page; a wildcard would fail here.
    const { headers } = await send('OPTIONS', { ...preflight, origin: 'https://evil.example' });

    expect(headers['access-control-allow-origin']).toBe(WEB);
  });

  it('answers the actual request without a max-age, which only a preflight carries', async () => {
    const { status, headers } = await send('GET', { origin: WEB });

    expect(status).toBe(200);
    expect(headers['access-control-allow-origin']).toBe(WEB);
    expect(headers['access-control-max-age']).toBeUndefined();
  });
});
