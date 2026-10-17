import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OperationProgressView } from './OperationProgressView';

describe('OperationProgressView', () => {
  it('says the step of how many, measures it, and says how long it and the whole have run', () => {
    render(<OperationProgressView starting="Reading the components…" operation={{
      elapsedSeconds: 372,
      step: { index: 2, count: 12, sentence: 'Reading the names of 9922 candidate items', done: 3450, total: 9922, elapsedSeconds: 64 },
      wait: null,
    }} />);

    expect(screen.getByText('Step 2 of 12')).toBeInTheDocument();
    expect(screen.getByText(/Reading the names of 9922 candidate items/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Step 2 of 12' })).toHaveAttribute('aria-valuenow', '35');
    expect(screen.getByText(/3,450 of 9,922 · this step 1 min 4 s/)).toBeInTheDocument();
    expect(screen.getByText('6 min 12 s')).toBeInTheDocument();
  });

  it('runs an indeterminate bar for a step that cannot say how much it has to do', () => {
    render(<OperationProgressView starting="" operation={{
      elapsedSeconds: 3,
      step: { index: 1, count: 4, sentence: 'Finding sites whose picture we may not show', done: 0, total: 0, elapsedSeconds: 3 },
      wait: null,
    }} />);

    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByText('this step 3 s')).toBeInTheDocument();
  });

  it('says a wait on an outside service and how long it has left', () => {
    render(<OperationProgressView starting="" operation={{
      elapsedSeconds: 90,
      step: { index: 5, count: 12, sentence: 'Looking near 1204 points, 310 areas', done: 40, total: 310, elapsedSeconds: 30 },
      wait: { sentence: 'Wikidata is not answering (HTTP 429) — retrying in 30s', secondsLeft: 20 },
    }} />);

    expect(screen.getByRole('status')).toHaveTextContent('Wikidata is not answering (HTTP 429) — retrying in 30s (20 s left)');
  });

  it('says what the run is doing before its first step opens', () => {
    render(<OperationProgressView starting="Reading the components no Wikidata item records..." operation={{ elapsedSeconds: 0, step: null, wait: null }} />);

    expect(screen.getByText('Reading the components no Wikidata item records...')).toBeInTheDocument();
  });
});
