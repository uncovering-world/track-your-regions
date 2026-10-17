import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GeomComputationAlert, type WorldViewGeometryCompute } from './WorldViewGeometryCompute';

function compute(over: Partial<WorldViewGeometryCompute>): WorldViewGeometryCompute {
  return { computing: true, status: null, startError: null, start: vi.fn(), cancel: vi.fn(), ...over };
}

describe('GeomComputationAlert', () => {
  it('says the step a computation is on and the region it is computing (#1356)', () => {
    render(<GeomComputationAlert compute={compute({
      status: {
        percent: 40, computed: 120, total: 300, errors: 0, currentRegion: 'Kabardino-Balkaria', status: 'Computing: Kabardino-Balkaria [depth 3]',
        operation: {
          elapsedSeconds: 95, cancelling: false,
          step: { index: 1, count: 2, sentence: 'Computing the geometry of 300 regions, deepest first', done: 120, total: 300, elapsedSeconds: 95 },
          wait: null,
        },
      },
    })} />);

    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
    expect(screen.getByText(/120 of 300/)).toBeInTheDocument();
    expect(screen.getByText('Kabardino-Balkaria')).toBeInTheDocument();
  });

  it('keeps its own line for a status that sends no step', () => {
    render(<GeomComputationAlert compute={compute({
      status: { percent: 40, computed: 120, total: 300, errors: 0, currentRegion: 'Adygea', status: 'Computing' },
    })} />);

    expect(screen.getByText('Computing geometries... 120/300 — Adygea')).toBeInTheDocument();
  });
});
