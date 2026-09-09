import React from 'react';
import ReactDOM from 'react-dom/client';
import { setWorkerUrl } from 'maplibre-gl';
// `?worker&url`: Vite bundles the worker as an entry of its own — with the
// `./maplibre-gl-shared.mjs` it imports resolved into it — and hands back the
// emitted chunk's URL. A plain `?url` would copy the file alone, and its
// relative import would 404 inside the worker.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import App from './App';
// Before ./index.css so app styles keep overriding MapLibre's, as they did when
// this stylesheet arrived from a CDN <link> in index.html.
import 'maplibre-gl/dist/maplibre-gl.css';
import './index.css';

// maplibre-gl 6 parses vector tiles in a worker it loads as a real URL —
// `new URL('./maplibre-gl-worker.mjs', import.meta.url)` — where 4.x inlined
// the worker's source as a blob. After bundling, `import.meta.url` is the entry
// chunk's, so the default resolves to `/assets/maplibre-gl-worker.mjs`, a file
// the build never emits: the library computes the URL in a function Vite
// cannot see through. The worker then dies on its first import and every
// vector source waits on it forever — raster tiles, which need no worker,
// still paint, so the map looks alive with no regions on it and no error in
// the main thread (#849). The dev server is unaffected, because there
// `import.meta.url` is the real module path. Set before any map is built: the
// worker pool is acquired by the first `Map` constructor.
setWorkerUrl(maplibreWorkerUrl);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
