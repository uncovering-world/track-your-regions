/**
 * The visitor's maps app (#1604), and the "Open in maps" link that follows it.
 *
 * A signed-in visitor's choice is the server's answer and a save goes to the
 * server; a signed-out visitor's is this browser's storage. With no choice,
 * and with a choice of the device's own app on a device that has none, every
 * target stays side by side.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

let signedIn = false;
let userId = 7;
vi.mock('./useAuth', () => ({
  useAuth: () => ({ user: signedIn ? { id: userId } : null, isAuthenticated: signedIn }),
}));

const getMyPreferences = vi.fn();
const saveMyPreferences = vi.fn();
vi.mock('../api/preferences', () => ({
  getMyPreferences: () => getMyPreferences(),
  saveMyPreferences: (app: unknown) => saveMyPreferences(app),
}));

let platform: 'apple' | 'android' | 'other' = 'other';
vi.mock('../utils/mapsLink', async (importOriginal) => {
  const real = await importOriginal<typeof import('../utils/mapsLink')>();
  return {
    ...real,
    mapsPlatform: () => platform,
    mapsTargets: (point: { latitude: number; longitude: number }, label: string) => real.mapsTargets(point, label, platform),
  };
});

import { MapsAppProvider, useMapsApp } from './useMapsApp';
import { OpenInMapsLink } from '../components/shared/OpenInMapsLink';

const ROSSLYN = { latitude: 55.855278, longitude: -3.159722 };

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MapsAppProvider>{children}</MapsAppProvider>
    </QueryClientProvider>
  );
}

function Chooser({ to }: { to: 'osm' | 'google' | 'device' | null }) {
  const { mapsApp, setMapsApp } = useMapsApp();
  return <button type="button" onClick={() => setMapsApp(to)}>chosen: {mapsApp ?? 'ask'}</button>;
}

const CHOOSE = 'Choose a maps app for every place';
/** The maps links, without the way to choose one for good. */
const links = () => screen.queryAllByRole('link').filter(link => link.getAttribute('href') !== '/account').map(link => link.textContent);

beforeEach(() => {
  signedIn = false;
  userId = 7;
  platform = 'other';
  localStorage.clear();
  getMyPreferences.mockReset();
  saveMyPreferences.mockReset();
});

describe('Open in maps, with no choice made', () => {
  it('offers every maps app side by side, as before a setting existed', () => {
    render(wrap(<OpenInMapsLink point={ROSSLYN} label="Rosslyn Chapel" />));
    expect(links()).toEqual(['OpenStreetMap', 'Google Maps']);
  });

  it('does the same outside any provider, as a component rendered on its own', () => {
    render(<OpenInMapsLink point={ROSSLYN} label="Rosslyn Chapel" />);
    expect(links()).toEqual(['OpenStreetMap', 'Google Maps']);
  });
});

describe('the way to choose a maps app for good', () => {
  it('is on the line of maps, since a signed-out visitor has no menu that reaches the Account page', () => {
    render(wrap(<OpenInMapsLink point={ROSSLYN} label="Rosslyn Chapel" />));
    expect(screen.getByRole('link', { name: CHOOSE })).toHaveAttribute('href', '/account');
  });

  it("is the last item of a place's row menu", async () => {
    render(wrap(<OpenInMapsLink point={ROSSLYN} label="Rosslyn Chapel" compact />));
    act(() => screen.getByRole('button', { name: 'Open Rosslyn Chapel in maps' }).click());
    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem');
    expect(items.at(-1)).toHaveTextContent(CHOOSE);
    expect(items.at(-1)).toHaveAttribute('href', '/account');
  });
});

describe('a signed-out visitor', () => {
  it('opens places in the maps app this browser keeps, the others behind "Other maps"', async () => {
    localStorage.setItem('tyr.mapsApp', 'google');
    render(wrap(<OpenInMapsLink point={ROSSLYN} label="Rosslyn Chapel" />));

    expect(links()).toEqual(['Open in Google Maps']);
    act(() => screen.getByRole('button', { name: 'Other maps' }).click());
    expect(within(await screen.findByRole('menu')).getAllByRole('menuitem').map(i => i.textContent)).toEqual(['OpenStreetMap', CHOOSE]);
  });

  it('keeps a choice in the browser, and asks the server nothing', () => {
    render(wrap(<Chooser to="osm" />));
    act(() => screen.getByRole('button').click());

    expect(screen.getByRole('button').textContent).toBe('chosen: osm');
    expect(localStorage.getItem('tyr.mapsApp')).toBe('osm');
    expect(saveMyPreferences).not.toHaveBeenCalled();
  });

  it('reads nothing it does not know as a choice', () => {
    localStorage.setItem('tyr.mapsApp', 'waze');
    render(wrap(<Chooser to={null} />));
    expect(screen.getByRole('button').textContent).toBe('chosen: ask');
  });
});

describe('a signed-in visitor', () => {
  it("opens places in the account's maps app, read from the server", async () => {
    signedIn = true;
    localStorage.setItem('tyr.mapsApp', 'google');
    getMyPreferences.mockResolvedValue({ mapsApp: 'osm' });
    render(wrap(<OpenInMapsLink point={ROSSLYN} label="Rosslyn Chapel" compact />));

    expect(await screen.findByRole('link', { name: 'Open Rosslyn Chapel in OpenStreetMap' })).toBeTruthy();
  });

  it('saves a choice with the account', async () => {
    signedIn = true;
    getMyPreferences.mockResolvedValue({ mapsApp: null });
    saveMyPreferences.mockResolvedValue({ mapsApp: 'google' });
    render(wrap(<Chooser to="google" />));
    await waitFor(() => expect(getMyPreferences).toHaveBeenCalled());

    act(() => screen.getByRole('button').click());

    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('chosen: google'));
    expect(saveMyPreferences).toHaveBeenCalledWith('google');
    expect(localStorage.getItem('tyr.mapsApp')).toBeNull();
  });
});

describe('an account change while a save is on its way', () => {
  it("never shows the first account's choice to the next one", async () => {
    signedIn = true;
    getMyPreferences.mockResolvedValue({ mapsApp: null });
    saveMyPreferences.mockReturnValue(new Promise(() => {}));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => (
      <QueryClientProvider client={client}><MapsAppProvider><Chooser to="google" /></MapsAppProvider></QueryClientProvider>
    );
    const { rerender } = render(tree());
    await waitFor(() => expect(getMyPreferences).toHaveBeenCalled());
    act(() => screen.getByRole('button').click());
    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('chosen: google'));

    userId = 8;
    rerender(tree());

    expect(screen.getByRole('button').textContent).toBe('chosen: ask');
  });
});

describe("the device's own maps app", () => {
  it('is the one link on a device that has one', () => {
    platform = 'apple';
    localStorage.setItem('tyr.mapsApp', 'device');
    render(wrap(<OpenInMapsLink point={ROSSLYN} label="Rosslyn Chapel" />));
    expect(links()).toEqual(['Open in Apple Maps']);
  });

  it('falls back to every maps app side by side on a device that has none', () => {
    platform = 'other';
    localStorage.setItem('tyr.mapsApp', 'device');
    render(wrap(<OpenInMapsLink point={ROSSLYN} label="Rosslyn Chapel" />));
    expect(links()).toEqual(['OpenStreetMap', 'Google Maps']);
  });
});
