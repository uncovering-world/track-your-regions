import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
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
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
});
