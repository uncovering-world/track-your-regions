import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TreasuresInsideChip } from './TreasuresInsideChip';

const ART_MUSEUMS = 2;
const PLACES_OF_WORSHIP = 4;
const ARCHAEOLOGY = 5;

describe('TreasuresInsideChip', () => {
  it('says how many treasures are inside', () => {
    render(<TreasuresInsideChip count={3} kindId={PLACES_OF_WORSHIP} />);

    expect(screen.getByText('3 treasures inside')).toBeInTheDocument();
  });

  it('uses the singular for one', () => {
    render(<TreasuresInsideChip count={1} kindId={PLACES_OF_WORSHIP} />);

    expect(screen.getByText('1 treasure inside')).toBeInTheDocument();
  });

  it('is silent for none, and for the kinds whose row already lists what is inside', () => {
    // An art museum's paintings and an archaeology museum's finds are both on
    // the row itself — the works list is the point of the row, not a side note
    // — so a chip counting them again says nothing twice.
    const { container } = render(
      <>
        <TreasuresInsideChip count={0} kindId={PLACES_OF_WORSHIP} />
        <TreasuresInsideChip count={5} kindId={ART_MUSEUMS} />
        <TreasuresInsideChip count={5} kindId={ARCHAEOLOGY} />
      </>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('is silent for an undefined count', () => {
    const { container } = render(<TreasuresInsideChip kindId={PLACES_OF_WORSHIP} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('carries an aria-label equal to its text', () => {
    render(<TreasuresInsideChip count={2} kindId={PLACES_OF_WORSHIP} />);

    expect(screen.getByLabelText('2 treasures inside')).toBeInTheDocument();
  });

  it('hides its icon from a screen reader, so only the label is announced', () => {
    render(<TreasuresInsideChip count={2} kindId={PLACES_OF_WORSHIP} />);

    const icon = document.querySelector('.MuiChip-icon');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('is sized like LifecycleChip (18px), not MUI\'s default small chip (24px)', () => {
    // The computed style of this chip, so the figure is the one its own rule
    // resolves to — not "18px" anywhere in the emitted CSS, which
    // `MuiChip-avatarSmall` carries on every chip, size override or not.
    const { container } = render(<TreasuresInsideChip count={2} kindId={PLACES_OF_WORSHIP} />);
    const chip = container.querySelector('.MuiChip-root') as HTMLElement;

    expect(getComputedStyle(chip).height).toBe('18px');
    // 0.6rem at the document's 16px root.
    expect(getComputedStyle(chip).fontSize).toBe('9.6px');
  });
});
