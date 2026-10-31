/**
 * The website check against a real HTTP server on this machine (#2165). The
 * server is on the loopback address, which the check refuses, so these tests
 * resolve their own names to it and admit it; the refusal itself is tested with
 * the real rule.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { linkCheckUserAgent } from '../../config/userAgent.js';
import { isPublicAddress } from './publicAddress.js';
import { createWebsiteChecker, MAX_REDIRECTS } from './checkWebsite.js';

/** The test server's address, which the real rule refuses. */
const LOOPBACK = '127.0.0.1';
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- a private address a redirect points at, to be refused
const PRIVATE = '10.0.0.5';

let server: http.Server;
let port = 0;
let requests: { method?: string; url?: string; headers: http.IncomingHttpHeaders }[] = [];

type Handler = (request: http.IncomingMessage, response: http.ServerResponse) => void;
const status = (code: number): Handler => (_request, response) => { response.writeHead(code); response.end(); };
const redirect = (to: () => string): Handler => (_request, response) => { response.writeHead(302, { Location: to() }); response.end(); };

/** What each fixed path answers; a switch, so a request's path selects only these. */
function page(path: string): Handler | undefined {
  switch (path) {
    case '/ok': return status(200);
    case '/missing': return status(404);
    case '/gone': return status(410);
    case '/forbidden': return status(403);
    case '/broken': return status(503);
    case '/head-refused': return (request, response) => status(request.method === 'HEAD' ? 405 : 200)(request, response);
    case '/parked': return redirect(() => `http://www.hugedomains.com:${port}/domain_profile.cfm`);
    case '/inside': return redirect(() => `http://${PRIVATE}/admin`);
    // HEAD refused, so the check asks with GET; then headers and a body that
    // never ends, which the check must not wait for.
    case '/endless': return (request, response) => {
      if (request.method === 'HEAD') return status(405)(request, response);
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.write(Buffer.alloc(64 * 1024));
    };
    case '/silent': return () => undefined;
    default: return undefined;
  }
}

/** `/hops/<n>` redirects n times before it answers. */
function hops(path: string): Handler | undefined {
  if (!path.startsWith('/hops/')) return undefined;
  const left = Number(path.slice('/hops/'.length));
  return left === 0 ? status(200) : redirect(() => `/hops/${left - 1}`);
}

beforeAll(async () => {
  server = http.createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, headers: request.headers });
    const path = request.url ?? '/';
    (page(path) ?? hops(path) ?? status(500))(request, response);
  });
  await new Promise<void>(done => server.listen(0, LOOPBACK, done));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

/** Every `.test` name and the parking host resolve to the test server; `nowhere.test` to nothing. */
const resolve = (hostname: string, callback: (error: NodeJS.ErrnoException | null, addresses: { address: string; family: number }[]) => void) => {
  if (hostname === 'nowhere.test') {
    const error: NodeJS.ErrnoException = new Error('getaddrinfo ENOTFOUND nowhere.test');
    error.code = 'ENOTFOUND';
    return callback(error, []);
  }
  return callback(null, [{ address: LOOPBACK, family: 4 }]);
};
const checker = (deps: Parameters<typeof createWebsiteChecker>[0] = {}) =>
  createWebsiteChecker({ resolve, isPublic: () => true, ports: new Set([String(port)]), deadlineMs: 2_000, ...deps });
const at = (path: string, host = 'site.test') => `http://${host}:${port}${path}`;

describe('whether an official website still answers (#2165)', () => {
  it('reads a page that answers as answering, and keeps its status', async () => {
    expect(await checker()(at('/ok'))).toMatchObject({ outcome: 'answers', reason: 'answered', status: 200 });
  });

  it('reads a missing or gone page, a missing domain and a refused connection as dead', async () => {
    const check = checker();
    expect(await check(at('/missing'))).toMatchObject({ outcome: 'dead', reason: 'page-not-found', status: 404 });
    expect(await check(at('/gone'))).toMatchObject({ outcome: 'dead', reason: 'page-gone', status: 410 });
    expect(await check(at('/ok', 'nowhere.test'))).toMatchObject({ outcome: 'dead', reason: 'domain-not-found', status: null });
    const closed = http.createServer();
    await new Promise<void>(done => closed.listen(0, LOOPBACK, done));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise(done => closed.close(done));
    expect(await checker({ ports: new Set([String(closedPort)]) })(`http://site.test:${closedPort}/`))
      .toMatchObject({ outcome: 'dead', reason: 'connection-refused' });
  });

  it('never reads a refusal, a server error or a timeout as dead', async () => {
    const check = checker({ deadlineMs: 300 });
    expect(await check(at('/forbidden'))).toMatchObject({ outcome: 'unclear', reason: 'refused-by-site', status: 403 });
    expect(await check(at('/broken'))).toMatchObject({ outcome: 'unclear', reason: 'server-error', status: 503 });
    expect(await check(at('/silent'))).toMatchObject({ outcome: 'unclear', reason: 'timed-out' });
  });

  it("asks with GET where the site refuses HEAD, and reads GET's answer", async () => {
    requests = [];
    expect(await checker()(at('/head-refused'))).toMatchObject({ outcome: 'answers', status: 200 });
    expect(requests.map(r => r.method)).toEqual(['HEAD', 'GET']);
  });

  it(`follows ${MAX_REDIRECTS} redirects and no more`, async () => {
    const check = checker();
    expect(await check(at(`/hops/${MAX_REDIRECTS}`))).toMatchObject({ outcome: 'answers' });
    expect(await check(at(`/hops/${MAX_REDIRECTS + 1}`))).toMatchObject({ outcome: 'unclear', reason: 'too-many-redirects' });
  });

  it('reads a redirect to a domain-parking host as dead, without requesting it', async () => {
    requests = [];
    expect(await checker()(at('/parked'))).toMatchObject({ outcome: 'dead', reason: 'domain-parked' });
    expect(requests.map(r => r.headers.host)).toEqual([`site.test:${port}`]);
  });

  it('closes the connection once the headers arrive, without reading the body', async () => {
    const started = Date.now();
    expect(await checker({ deadlineMs: 1_500 })(at('/endless'))).toMatchObject({ outcome: 'answers', status: 200 });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("sends the link checker's agent and nothing of a session", async () => {
    requests = [];
    await checker()(at('/ok'));
    const { headers } = requests[0];
    expect(headers['user-agent']).toBe(linkCheckUserAgent());
    expect(headers.cookie).toBeUndefined();
    expect(headers.referer).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
  });

  it('refuses an address that is not public, named, literal or reached by a redirect', async () => {
    const guarded = checker({ isPublic: isPublicAddress });
    requests = [];
    expect(await guarded(at('/ok'))).toMatchObject({ outcome: 'unclear', reason: 'not-public' });
    expect(await guarded(`http://${LOOPBACK}:${port}/ok`)).toMatchObject({ outcome: 'unclear', reason: 'not-public' });
    // The URL parser writes a mapped address in hex: [::ffff:7f00:1].
    expect(await guarded(`http://[::ffff:${LOOPBACK}]:${port}/ok`)).toMatchObject({ outcome: 'unclear', reason: 'not-public' });
    expect(requests).toEqual([]);
    // The site itself is admitted; the hop it redirects to, a private address, is not.
    const redirected = checker({ isPublic: address => address !== PRIVATE, ports: new Set([String(port), '']) });
    expect(await redirected(at('/inside'))).toMatchObject({ outcome: 'unclear', reason: 'not-public' });
  });

  it('refuses to call what is no website address', async () => {
    const check = checker();
    const withCredentials = `http://user:secret@site.test:${port}/`; // gitleaks:allow -- a made-up credential the check must refuse to call
    for (const value of ['ftp://site.test/', withCredentials, 'http://site.test:22/', 'not a url', 'javascript:alert(1)']) {
      expect(await check(value), value).toMatchObject({ outcome: 'unclear', reason: 'not-checkable' });
    }
  });

  it('keeps an outcome for a day and checks again after it', async () => {
    let clock = Date.parse('2026-10-31T08:00:00Z');
    const check = checker({ now: () => clock });
    requests = [];
    const first = await check(at('/ok'));
    await check(at('/ok'));
    expect(requests).toHaveLength(1);
    expect(first.checkedAt).toBe('2026-10-31T08:00:00.000Z');
    clock += 24 * 60 * 60 * 1000 + 1;
    await check(at('/ok'));
    expect(requests).toHaveLength(2);
  });
});
