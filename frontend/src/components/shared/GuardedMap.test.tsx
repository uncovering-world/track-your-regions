/**
 * The defect this pins: a map mounted without WebGL took the page with it.
 * MapLibre throws from its constructor and the app has no error boundary, so
 * "renders an explanation" and "does not throw" are one requirement here — and
 * both assertions below are deliberately kept.
 *
 * The underlying `<Map>` is mocked because the real one cannot mount in jsdom
 * at all, which is the very reason this went unnoticed: every suite that would
 * have exercised a map surface mocked it away.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import { GuardedMap } from './GuardedMap';
import * as webgl from '../../utils/webgl';

/** Flipped per test to make the mocked map behave like MapLibre does. */
let mapThrowsOnMount = false;

vi.mock('react-map-gl/maplibre', () => ({
  default: forwardRef(function MockMap(_props, _ref) {
    if (mapThrowsOnMount) {
      throw new Error('Failed to initialize WebGL');
    }
    return <div data-testid="the-map" />;
  }),
}));

describe('GuardedMap', () => {
  beforeEach(() => {
    mapThrowsOnMount = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the map where the browser can paint one', () => {
    vi.spyOn(webgl, 'isWebGLAvailable').mockReturnValue(true);

    render(<GuardedMap />);

    expect(screen.getByTestId('the-map')).toBeInTheDocument();
    expect(screen.queryByText(/can't be displayed/i)).not.toBeInTheDocument();
  });

  it('does not mount a map that would throw', () => {
    vi.spyOn(webgl, 'isWebGLAvailable').mockReturnValue(false);
    mapThrowsOnMount = true;

    // If the guard ever lets the map through, this fails the way the app did —
    // by throwing, not by a missing string.
    expect(() => render(<GuardedMap />)).not.toThrow();

    expect(screen.queryByTestId('the-map')).not.toBeInTheDocument();
    expect(screen.getByText(/can't be displayed/i)).toBeInTheDocument();
  });

  it('names the cause and the remedy, not a wait', () => {
    vi.spyOn(webgl, 'isWebGLAvailable').mockReturnValue(false);

    render(<GuardedMap />);

    // The note this replaced said areas were "still loading" and that panning
    // still worked. Both were false, and a user who believes them waits for a
    // recovery that cannot arrive.
    expect(screen.getByText(/WebGL/i)).toBeInTheDocument();
    expect(screen.getByText(/hardware acceleration/i)).toBeInTheDocument();
    expect(screen.queryByText(/still loading/i)).not.toBeInTheDocument();
  });

  it('passes a surface-specific note through', () => {
    vi.spyOn(webgl, 'isWebGLAvailable').mockReturnValue(false);

    render(<GuardedMap unavailableDetail="The list beside it still works." />);

    expect(screen.getByText('The list beside it still works.')).toBeInTheDocument();
  });

  it('keeps its own props out of the map it renders', () => {
    vi.spyOn(webgl, 'isWebGLAvailable').mockReturnValue(true);

    // `unavailableDetail`/`unavailableCompact` are this component's, not
    // MapLibre's; forwarding them would put unknown props on the map.
    render(<GuardedMap unavailableDetail="unused here" unavailableCompact />);

    expect(screen.getByTestId('the-map')).toBeInTheDocument();
  });
});
