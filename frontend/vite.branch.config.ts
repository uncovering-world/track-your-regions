import { mergeConfig, type ProxyOptions, type UserConfig } from 'vite';
import base from './vite.config';

/**
 * A branch's dev server beside the dev stack's, for looking at its screens on
 * the stack's data before it merges (#1724; `docs/tech/development-guide.md`
 * § Looking at a branch's screens).
 *
 * The stack's frontend serves the main checkout, so a branch is served here,
 * on a port of its own: 5181 by default, since 5173 is the stack's and 5174
 * the isolated test stack's. Everything the page fetches from the stack goes
 * through this server — the API and hosted pictures (`VITE_API_URL`) and
 * Martin's tiles (`VITE_MARTIN_URL`, under `/tiles`), both this server's own
 * address, set by the command — so a tunnel of its one port is enough, and the
 * page keeps one origin, on which the browser sends the session cookie it
 * holds for `localhost`. The backend allows one web origin (`FRONTEND_URL`),
 * which the proxy presents, as the stack's own frontend would, for a request
 * from this page only. It listens on this machine alone: a tunnel reaches it,
 * the network does not.
 */

const port = Number(process.env.BRANCH_PORT || 5181);
const backend = process.env.BRANCH_API || 'http://localhost:3001';
const martin = process.env.BRANCH_MARTIN || 'http://localhost:3000';
const webOrigin = process.env.BRANCH_WEB_ORIGIN || 'http://localhost:5173';
const ownOrigin = `http://localhost:${port}`;

/**
 * The backend, reached as the stack's own frontend reaches it, for this page's
 * requests only: a request another page sends here with its own origin is
 * refused rather than vouched for, so this server cannot spend the session
 * cookie for a page the backend would not have answered.
 */
const toBackend: ProxyOptions = {
  target: backend,
  configure: proxy => {
    proxy.on('proxyReq', (proxyRequest, request, response) => {
      const origin = request.headers.origin;
      if (origin !== undefined && origin !== ownOrigin) {
        proxyRequest.destroy();
        response.writeHead(403).end();
        return;
      }
      proxyRequest.setHeader('origin', webOrigin);
    });
  },
};

const branch: UserConfig = {
  server: {
    host: 'localhost',
    port,
    strictPort: true,
    proxy: {
      '/api': toBackend,
      '/images': toBackend,
      '/tiles': { target: martin, rewrite: path => path.replace(/^\/tiles/, '') },
    },
  },
};

export default mergeConfig(base, branch);
