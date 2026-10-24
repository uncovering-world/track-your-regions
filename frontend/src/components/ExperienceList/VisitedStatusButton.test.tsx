import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VisitedStatusButton } from './VisitedStatusButton';

describe('the visit badge of an edition', () => {
  it('says the work was visited without claiming every cast was', () => {
    render(<VisitedStatusButton visitedStatus="visited" visitedCount={1} totalCount={4} castPoints />);
    expect(screen.getByText('Visited')).toBeInTheDocument();
    expect(screen.queryByText('All Visited')).not.toBeInTheDocument();
  });

  it('says not visited without a completion denominator', () => {
    render(<VisitedStatusButton visitedStatus="not_visited" visitedCount={0} totalCount={4} castPoints />);
    expect(screen.getByText('Not visited')).toBeInTheDocument();
  });

  it('still shows progress through an ordinary serial site', () => {
    render(<VisitedStatusButton visitedStatus="partial" visitedCount={1} totalCount={4} />);
    expect(screen.getByText('1/4 Visited')).toBeInTheDocument();
  });
});
