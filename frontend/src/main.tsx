import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Before ./index.css so app styles keep overriding MapLibre's, as they did when
// this stylesheet arrived from a CDN <link> in index.html.
import 'maplibre-gl/dist/maplibre-gl.css';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
