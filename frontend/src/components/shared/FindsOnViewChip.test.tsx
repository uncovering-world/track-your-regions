import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FindsOnViewChip } from './FindsOnViewChip';

describe('FindsOnViewChip', () => {
  it('says how many finds from the site are on view', () => {
    // The Acropolis of Athens on the development catalogue: four finds, shown
    // in London and at the Acropolis Museum.
    render(<FindsOnViewChip count={4} />);

    expect(screen.getByText('4 finds on view')).toBeInTheDocument();
    expect(screen.getByLabelText('4 finds from here are on view in a museum')).toBeInTheDocument();
  });

  it('uses the singular for one', () => {
    render(<FindsOnViewChip count={1} />);

    expect(screen.getByText('1 find on view')).toBeInTheDocument();
    expect(screen.getByLabelText('A find from here is on view in a museum')).toBeInTheDocument();
  });

  it('is silent for none and for no count, which is every row that is not a site', () => {
    const { container } = render(
      <>
        <FindsOnViewChip count={0} />
        <FindsOnViewChip />
        <FindsOnViewChip count={null} />
      </>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('hides its icon from a screen reader, so only the label is announced', () => {
    render(<FindsOnViewChip count={2} />);

    const icon = screen.getByLabelText('2 finds from here are on view in a museum').querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});
