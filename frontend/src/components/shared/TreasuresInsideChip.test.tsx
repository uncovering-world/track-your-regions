import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TreasuresInsideChip } from './TreasuresInsideChip';

const ART_MUSEUMS = 2;
const PLACES_OF_WORSHIP = 4;

describe('TreasuresInsideChip', () => {
  it('says how many treasures are inside', () => {
    render(<TreasuresInsideChip count={3} kindId={PLACES_OF_WORSHIP} />);

    expect(screen.getByText('3 treasures inside')).toBeInTheDocument();
  });

  it('uses the singular for one', () => {
    render(<TreasuresInsideChip count={1} kindId={PLACES_OF_WORSHIP} />);

    expect(screen.getByText('1 treasure inside')).toBeInTheDocument();
  });

  it('is silent for none, and for a museum', () => {
    const { container } = render(
      <>
        <TreasuresInsideChip count={0} kindId={PLACES_OF_WORSHIP} />
        <TreasuresInsideChip count={5} kindId={ART_MUSEUMS} />
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
    // A style assertion on the emitted CSS, not a computed style: jsdom's
    // `getComputedStyle` does not resolve emotion's injected sheets
    // (`theme/focusRing.test.tsx` hit this first). Scoped to this chip's own
    // generated class, not just any "18px" in the document — `MuiChip-avatarSmall`
    // carries that figure on every chip, size override or not, so a bare
    // substring match would pass whether or not this chip's own rule shrank it.
    const { container } = render(<TreasuresInsideChip count={2} kindId={PLACES_OF_WORSHIP} />);
    const chip = container.querySelector('.MuiChip-root') as HTMLElement;
    const ownClass = Array.from(chip.classList).find(c => c.startsWith('css-'));
    const emittedCss = Array.from(document.querySelectorAll('style')).map(s => s.textContent ?? '').join('\n');
    const marker = `.${ownClass}{`;
    const start = emittedCss.indexOf(marker);
    const ownRule = start >= 0 ? emittedCss.slice(start, emittedCss.indexOf('}', start) + 1) : '';

    expect(ownRule).toMatch(/height:18px/);
    expect(ownRule).toMatch(/font-size:0\.6rem/);
  });
});
