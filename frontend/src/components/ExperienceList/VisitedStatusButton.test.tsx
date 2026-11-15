import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VisitedStatusButton } from './VisitedStatusButton';
import { wholeCountLabel } from '../shared/visitWords';

describe('the visit badge of an edition', () => {
  it('says the work was visited without claiming every cast was', () => {
    render(<VisitedStatusButton visitedStatus="visited" count={null} />);
    expect(screen.getByText('Visited')).toBeInTheDocument();
  });

  it('says not visited without a completion denominator', () => {
    render(<VisitedStatusButton visitedStatus="not_visited" count={null} />);
    expect(screen.getByText('Not visited')).toBeInTheDocument();
  });
});

describe('the visit badge of a whole', () => {
  it("reads the count its row shows: the Struve Arc's 1 of 34", () => {
    render(<VisitedStatusButton visitedStatus="partial" count={wholeCountLabel(34, { visited: 1, total: 34 }, true)} />);
    expect(screen.getByText('1 of 34 visited')).toBeInTheDocument();
    expect(screen.getByLabelText('1 of 34 places visited')).toBeInTheDocument();
  });

  it('reads "?" for a whole ticked without naming a place', () => {
    render(<VisitedStatusButton visitedStatus="partial" count={wholeCountLabel(34, { visited: null, total: 34 }, true)} />);
    expect(screen.getByText('? of 34 visited')).toBeInTheDocument();
  });
});
