import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DescriptionText } from './DescriptionText';

/** Rome's description as UNESCO's dataset gives it (whc001, CC BY-SA 4.0). */
const ROME = 'Founded, according to legend, by Romulus and Remus in 753 BC, Rome was first the centre of the Roman Republic.';

describe('DescriptionText', () => {
  it("draws UNESCO's paragraph with its holder and licence, each linked", () => {
    render(<DescriptionText text={ROME} source="unesco" />);

    expect(screen.getByText(ROME)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'UNESCO World Heritage Centre' }))
      .toHaveAttribute('href', 'https://data.unesco.org/explore/dataset/whc001/');
    expect(screen.getByRole('link', { name: 'CC BY-SA 4.0' }))
      .toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/4.0/');
  });

  it("calls a curator's edit of UNESCO's text an adaptation of it", () => {
    render(<DescriptionText text={ROME} source="unesco" adapted />);

    expect(screen.getByText('Text: adapted from', { exact: false })).toHaveTextContent('Text: adapted from UNESCO World Heritage Centre · CC BY-SA 4.0');
  });

  it("draws a curator's own text alone", () => {
    render(<DescriptionText text="Ruins of the ancient city of Aksum." source={null} />);

    expect(screen.getByText('Ruins of the ancient city of Aksum.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('draws no credit where there is no text to credit', () => {
    const { container } = render(<DescriptionText text="   " source="unesco" />);

    expect(container).toBeEmptyDOMElement();
  });
});
