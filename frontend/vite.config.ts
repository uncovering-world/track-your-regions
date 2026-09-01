import { defineConfig, type PluginOption } from 'vitest/config';
import react from '@vitejs/plugin-react';
import compression from 'compression';
import path from 'path';

/**
 * `vite preview` sends the built assets uncompressed - 2.8 MB for the entry
 * chunk where any static host or CDN would send its gzip (about 790 kB).
 * Lighthouse's simulated throttling works from transfer size, so a
 * performance budget measured against raw bytes would ratchet on a number no
 * visitor ever downloads. Only the preview server is touched: the dev server
 * serves unbundled modules and is not what the performance lane measures.
 */
function previewCompression(): PluginOption {
  return {
    name: 'preview-compression',
    configurePreviewServer(server) {
      server.middlewares.use(compression());
    },
  };
}

/**
 * The dev server's tab says what it is. Its numbers are not the product's -
 * unbundled modules, HMR, no compression - and the performance lane refuses
 * to measure it; a person looking at a tab should not need devtools to know
 * which shape they have open. `vite build` and `vite preview` leave the
 * title alone, so the built page a visitor gets is unchanged.
 */
function devServerTitle(): PluginOption {
  return {
    name: 'dev-server-title',
    apply: 'serve',
    transformIndexHtml: (html) =>
      html.replace('<title>Track Your Regions</title>', '<title>Track Your Regions (dev server)</title>'),
  };
}

export default defineConfig({
  plugins: [react(), previewCompression(), devServerTitle()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    // Vite rejects any request whose Host header isn't localhost-like
    // (DNS-rebinding protection). The e2e container's browser reaches this
    // server over the Docker Compose network as "frontend" (its compose
    // service name, the same in every stack this file serves), not as
    // localhost, so that name must be explicitly allowed or every request
    // - including the initial page load - gets HTTP 403 "Blocked request".
    // Not reachable from outside the compose network, so this doesn't widen
    // real exposure.
    allowedHosts: ['frontend'],
  },
  preview: {
    // Same port and host rule as the dev server: the test stack's frontend
    // container answers on 5173 as "frontend" in both modes, so the backend's
    // CORS origin and the browser's URLs are the same whichever one is up.
    port: 5173,
    host: true,
    allowedHosts: ['frontend'],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // perf/ holds the performance lane's runner; its budget evaluator is the
    // one piece of it worth a unit test, and it is plain ESM. tests/ holds the
    // same for the E2E lane: the Playwright specs there are `*.spec.ts` and
    // are driven by Playwright, while `*.test.mjs` is the report parser that
    // decides what a run means (scripts/playwright-summary.mjs), which is
    // testable without a browser.
    include: ['src/**/*.test.{ts,tsx}', 'perf/**/*.test.mjs', 'tests/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
});
