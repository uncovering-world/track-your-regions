import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AppThemeProvider } from '../../../theme';
import { ActionToolbar, BatchProgressSection, NOTHING_TO_COMPUTE, type ActionToolbarProps } from './GeometryMapPanelParts';

const styles = { surface: '#fff', border: '#ddd', text: '#111', textMuted: '#777', primary: '#09c', uiFont: 'sans-serif', monoFont: 'monospace' };

function toolbar(over: Partial<ActionToolbarProps> = {}) {
  const props: ActionToolbarProps = {
    selectedRegion: null, displayMode: 'real', showOptions: false, isComputing: false,
    isComputingSingleRegion: false, isResettingToMembers: false, regionsCount: 3831, geojsonHasFeatures: false,
    toolBtnSx: {}, styles,
    onToggleHull: vi.fn(), onComputeSingleRegion: vi.fn(), onRedefineBoundaries: vi.fn(), onResetToMembers: vi.fn(),
    onSetDisplayMode: vi.fn(), onSetShowOptions: vi.fn(), onOpenHullEditor: vi.fn(),
    onStartComputation: vi.fn(), onCancelComputation: vi.fn(),
    recomputeAll: false, onSetRecomputeAll: vi.fn(),
    ...over,
  };
  render(<AppThemeProvider><ActionToolbar {...props} /></AppThemeProvider>);
  return props;
}

/**
 * Compute All finishes what is missing unless asked for every region (#1683),
 * and the choice sits beside the button, in view when it is pressed.
 */
describe("the editor's Compute All", () => {
  it('offers the choice to recompute every region beside the button, unticked', () => {
    const props = toolbar();
    expect(screen.getByText('Recompute every region')).toBeInTheDocument();
    const box = screen.getByRole('checkbox');
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(props.onSetRecomputeAll).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Compute All' }));
    expect(props.onStartComputation).toHaveBeenCalled();
  });

  it('hides the choice while a computation runs, when the button is Cancel', () => {
    toolbar({ isComputing: true });
    expect(screen.queryByText('Recompute every region')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('says a press found nothing to queue, rather than flashing a bar', () => {
    render(
      <AppThemeProvider>
        <BatchProgressSection isComputing={false} computationStatus={{ running: false, status: NOTHING_TO_COMPUTE }}
          borderColor="#ddd" uiFont="sans-serif" monoFont="monospace" mutedColor="#777" onClearStatus={vi.fn()} />
      </AppThemeProvider>,
    );
    expect(screen.getByText(/Every region already has its geometry, so nothing was queued/)).toBeInTheDocument();
  });
});
