/**
 * The one dialog a place is looked at in, and the pin it hands a curator where a
 * caller offers the correction.
 *
 * Two things are worth pinning. A caller that passes no `correction` gets the look it
 * always got — the map and nothing else — because the object's own coordinate and a
 * reader's place open here too. And with a `correction` the dialog opens *on* the form,
 * with no read-only map beside it: that is the one-WebGL-context rule the docblock is
 * built on, and the one-mode rule the product review asked for. The map and the form
 * are stubbed — neither mounts in jsdom, and what this test is about is which of them
 * is asked for.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as webgl from '../../utils/webgl';

vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div data-testid="the-map">{children}</div>,
  Marker: () => <span data-testid="the-marker" />,
}));

vi.mock('./PointCorrection', () => ({
  PointCorrection: ({ onDone, onCancel }: { onDone: (m: string) => void; onCancel: () => void }) => (
    <div data-testid="the-form">
      <button onClick={() => onDone('Bilbao: the place moved 40 m north.')}>saved</button>
      <button onClick={onCancel}>back</button>
    </div>
  ),
}));

import { PointPreviewDialog } from './PointPreviewDialog';

const place = {
  locationId: 13211, experienceId: 1289, objectName: 'Bilbao Fine Arts Museum', name: null,
  latitude: 43.265974, longitude: -2.93785,
};

beforeEach(() => {
  vi.spyOn(webgl, 'isWebGLAvailable').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PointPreviewDialog', () => {
  it('is the look it always was where nothing is offered to correct', () => {
    render(<PointPreviewDialog open onClose={() => {}} name="Bilbao" latitude={43.27} longitude={-2.94} />);

    expect(screen.getByTestId('the-map')).toBeInTheDocument();
    expect(screen.getByTestId('the-marker')).toBeInTheDocument();
    expect(screen.queryByTestId('the-form')).toBeNull();
    expect(screen.queryByText(/Bilbao Fine Arts Museum/)).toBeNull();
  });

  it('opens on the form where the place may be corrected, and never shows the map beside it', () => {
    render(
      <PointPreviewDialog
        open onClose={() => {}} name="Bilbao" latitude={43.27} longitude={-2.94}
        correction={{ place, onDone: () => {} }}
      />,
    );

    expect(screen.getByTestId('the-form')).toBeInTheDocument();
    expect(screen.queryByTestId('the-map')).toBeNull();
    // Whose place this is, in the title, since the form is opened from three surfaces.
    expect(screen.getByText('43.2700, -2.9400 · Bilbao Fine Arts Museum')).toBeInTheDocument();
  });

  it('hands the outcome line to the caller and closes', () => {
    const onDone = vi.fn();
    const onClose = vi.fn();
    render(
      <PointPreviewDialog
        open onClose={onClose} name="Bilbao" latitude={43.27} longitude={-2.94}
        correction={{ place, onDone }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'saved' }));

    // The line goes where the caller reports its other answers; the dialog's job is
    // over once the correction is saved, and the refetch redraws the row behind it.
    expect(onDone).toHaveBeenCalledWith('Bilbao: the place moved 40 m north.');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on cancel — there is no look to go back to', () => {
    const onClose = vi.fn();
    render(
      <PointPreviewDialog
        open onClose={onClose} name="Bilbao" latitude={43.27} longitude={-2.94}
        correction={{ place, onDone: () => {} }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'back' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
