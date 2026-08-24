import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import express from 'express';
import type { Request, Response } from 'express';
import type { Server } from 'node:http';
import { request } from 'node:http';
import { AddressInfo } from 'node:net';
import { responseCompression, shouldCompress, COMPRESSION_THRESHOLD_BYTES } from './compression.js';

/**
 * The filter is called with the request as it stands when the headers are
 * written, which is why `url` and `originalUrl` are set apart here: Express
 * has rewritten the first one by then.
 */
function makeReq(originalUrl: string, url = originalUrl): Request {
  return {
    originalUrl,
    url,
    method: 'GET',
    headers: { 'accept-encoding': 'gzip, br' },
  } as unknown as Request;
}

function makeRes(contentType: string): Response {
  return {
    getHeader: (name: string) =>
      name.toLowerCase() === 'content-type' ? contentType : undefined,
  } as unknown as Response;
}

describe('shouldCompress', () => {
  it('compresses a JSON read - the shape the map depends on', () => {
    expect(
      shouldCompress(
        makeReq('/api/experiences/by-region/6737?includeChildren=true'),
        makeRes('application/json; charset=utf-8'),
      ),
    ).toBe(true);
  });

  it('never compresses a server-sent event stream', () => {
    // compression buffers writes, so a progress stream would arrive in one
    // lump at the end of the run it is reporting on.
    expect(
      shouldCompress(
        makeReq('/api/world-views/regions/42/compute-geometry/stream'),
        makeRes('text/event-stream'),
      ),
    ).toBe(false);
  });

  it('never compresses an auth response - it carries the access token', () => {
    expect(
      shouldCompress(makeReq('/api/auth/login'), makeRes('application/json; charset=utf-8')),
    ).toBe(false);
  });

  it('excludes the auth prefix by the path Express received, not the rewritten one', () => {
    // Mounted routers rewrite req.url: by the time the filter runs, a request
    // to /api/auth/login is being handled with req.url === '/login'.
    expect(
      shouldCompress(
        makeReq('/api/auth/login', '/login'),
        makeRes('application/json; charset=utf-8'),
      ),
    ).toBe(false);
  });

  it('excludes the auth prefix whatever its case - Express routes case-insensitively', () => {
    expect(
      shouldCompress(makeReq('/API/Auth/Login'), makeRes('application/json; charset=utf-8')),
    ).toBe(false);
  });

  it('excludes an absolute-form request target, which Express still routes to auth', () => {
    // `POST http://host/api/auth/login HTTP/1.1` is accepted by Node's parser
    // and leaves originalUrl as the whole URI; Express routes it on the
    // pathname regardless, so the filter has to read the pathname too.
    expect(
      shouldCompress(
        makeReq('http://localhost:3001/api/auth/login', '/login'),
        makeRes('application/json; charset=utf-8'),
      ),
    ).toBe(false);
  });

  it('does not read a leading // as protocol-relative and lose the first segment', () => {
    // new URL('//api/auth/login', base) would yield '/auth/login'. Express
    // does not route this to auth either way; what matters is that the two
    // read the same string.
    expect(
      shouldCompress(makeReq('//api/auth/login'), makeRes('application/json; charset=utf-8')),
    ).toBe(true);
  });

  it('does not mistake another path that starts with the same letters for auth', () => {
    expect(
      shouldCompress(makeReq('/api/authors/12'), makeRes('application/json; charset=utf-8')),
    ).toBe(true);
  });

  it('leaves an already-compressed format alone', () => {
    expect(shouldCompress(makeReq('/images/x.jpg'), makeRes('image/jpeg'))).toBe(false);
    expect(
      shouldCompress(makeReq('/tile/3/4/2'), makeRes('application/x-protobuf')),
    ).toBe(false);
  });
});

/**
 * The filter being right is not the same as the middleware being built with
 * it, so the rules are checked again through a real server and a real client.
 */
describe('responseCompression on a live server', () => {
  let server: Server;
  let port: number;
  const bigBody = { rows: Array.from({ length: 400 }, (_, i) => ({ id: i, name: `Region ${i}` })) };

  beforeAll(async () => {
    const app = express();
    // helmet does this for the real app; this one has no helmet.
    app.disable('x-powered-by');
    app.use(responseCompression());
    app.get('/api/experiences/big', (_req, res) => { res.json(bigBody); });
    app.get('/api/experiences/small', (_req, res) => { res.json({ ok: true }); });
    app.get('/api/auth/login', (_req, res) => { res.json(bigBody); });
    app.get('/api/stream', (_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.flushHeaders();
      res.write(`data: ${JSON.stringify({ type: 'progress', step: 'first' })}\n\n`);
      // Deliberately left open: the point is that the first event arrives
      // before the response ends.
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('sends a large JSON read compressed, and smaller than it was', async () => {
    // Brotli where the client takes it, which every browser does: it is the
    // preferred encoding and beats gzip on this shape by a few per cent.
    const response = await get('/api/experiences/big');
    expect(response.headers['content-encoding']).toBe('br');
    expect(response.headers.vary).toContain('Accept-Encoding');
    expect(response.bytes).toBeLessThan(JSON.stringify(bigBody).length / 2);
  });

  it('falls back to gzip for a client that takes only that', async () => {
    const response = await get('/api/experiences/big', { 'accept-encoding': 'gzip' });
    expect(response.headers['content-encoding']).toBe('gzip');
    expect(response.bytes).toBeLessThan(JSON.stringify(bigBody).length / 2);
  });

  it('sends a large JSON read raw when the client does not accept an encoding', async () => {
    const response = await get('/api/experiences/big', { 'accept-encoding': 'identity' });
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.bytes).toBe(JSON.stringify(bigBody).length);
  });

  it('leaves a response below the threshold alone', async () => {
    const response = await get('/api/experiences/small');
    expect(response.bytes).toBeLessThan(COMPRESSION_THRESHOLD_BYTES);
    expect(response.headers['content-encoding']).toBeUndefined();
  });

  it('leaves an auth response raw however large it is', async () => {
    const response = await get('/api/auth/login');
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.bytes).toBe(JSON.stringify(bigBody).length);
  });

  it('leaves it raw when the request target is absolute, which still routes to auth', async () => {
    // Node writes whatever `path` says, so this puts a real absolute-form
    // target on the wire. Express routes it on the pathname; the filter has
    // to reach the same conclusion or the token would go out compressed.
    const response = await get(`http://localhost:${port}/api/auth/login`);
    expect(response.status).toBe(200);
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.bytes).toBe(JSON.stringify(bigBody).length);
  });

  it('lets an event reach the client before the stream ends', async () => {
    const first = await firstChunkOf('/api/stream');
    expect(first).toContain('"step":"first"');
  });

  function get(path: string, headers: Record<string, string> = { 'accept-encoding': 'gzip, br' }) {
    return new Promise<{
      headers: Record<string, string | string[] | undefined>;
      bytes: number;
      status: number;
    }>((resolve, reject) => {
      const req = request({ port, path, headers }, (res) => {
        let bytes = 0;
        res.on('data', (chunk: Buffer) => { bytes += chunk.length; });
        res.on('end', () => resolve({ headers: res.headers, bytes, status: res.statusCode ?? 0 }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  function firstChunkOf(path: string) {
    return new Promise<string>((resolve, reject) => {
      const req = request(
        { port, path, headers: { 'accept-encoding': 'gzip, br' } },
        (res) => {
          res.once('data', (chunk: Buffer) => {
            req.destroy();
            resolve(chunk.toString('utf8'));
          });
        },
      );
      req.on('error', (err) => { if (!req.destroyed) reject(err); });
      req.setTimeout(2000, () => { req.destroy(); reject(new Error('no event arrived within 2s')); });
      req.end();
    });
  }
});
