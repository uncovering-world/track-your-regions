/**
 * App shell smoke test — guards the "white screen" class of regression.
 *
 * Mounts the real App, so the router, theme and both context providers have
 * to compose for this to pass; an upgrade that leaves a top-level component
 * `undefined` fails here instead of in the browser. Only the leaves jsdom
 * cannot run are mocked: MapLibre (via MainDisplay) and the network layer.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./components/MainDisplay', () => ({
  MainDisplay: () => <div data-testid="main-display" />,
  setExplorationModeListener: () => {},
}));
vi.mock('./components/NavigationPane', () => ({
  NavigationPane: () => <div data-testid="navigation-pane" />,
}));
vi.mock('./components/discover/DiscoverPage', () => ({
  DiscoverPage: () => <div data-testid="discover-page" />,
}));
vi.mock('./components/admin', () => ({
  AdminDashboard: () => <div data-testid="admin-dashboard" />,
}));

vi.mock('./api', () => ({
  fetchWorldViews: vi.fn().mockResolvedValue([]),
  fetchRootRegions: vi.fn().mockResolvedValue([]),
  fetchRegionAncestors: vi.fn().mockResolvedValue([]),
  fetchDivisionAncestors: vi.fn().mockResolvedValue([]),
}));

vi.mock('./api/fetchUtils', () => ({
  setAccessToken: vi.fn(),
  refreshSession: vi.fn().mockResolvedValue(null),
  setRefreshSuccessListener: vi.fn(),
  authFetchJson: vi.fn().mockResolvedValue(null),
}));

import App from './App';

describe('App shell', () => {
  it('mounts and renders the shell chrome', async () => {
    render(<App />);

    // The header is rendered by the real component tree, so reaching it proves
    // BrowserRouter, the theme and both context providers all composed.
    expect(await screen.findByText('Track Your Regions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Map' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discover' })).toBeInTheDocument();
  });

  it('renders the map route by default', async () => {
    render(<App />);

    expect(await screen.findByTestId('main-display')).toBeInTheDocument();
    expect(screen.getByTestId('navigation-pane')).toBeInTheDocument();
  });
});
