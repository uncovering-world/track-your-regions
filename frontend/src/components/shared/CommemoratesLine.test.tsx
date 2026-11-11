import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CommemoratesLine, SHOWN_FOLDED } from './CommemoratesLine';

// The Monument to Minin and Pozharsky (Q187531) depicts Dmitry Pozharsky (Q15756) and Kuzma Minin (Q469785).
const POZHARSKY = { qid: 'Q15756', label: 'Dmitry Pozharsky', article_url: 'https://en.wikipedia.org/wiki/Dmitry_Pozharsky' };
const MININ = { qid: 'Q469785', label: 'Kuzma Minin', article_url: null };

describe('CommemoratesLine', () => {
  it('says what a religious work depicts under its own word (#2404)', () => {
    // Christ the Redeemer (Q79961) depicts Jesus Christ (Q302).
    render(<CommemoratesLine subjects={[{ qid: 'Q302', label: 'Jesus Christ', article_url: 'https://en.wikipedia.org/wiki/Jesus' }]} word="Depicts" />);
    expect(screen.getByText(/^Depicts:/).textContent).toBe('Depicts: Jesus Christ');
    expect(screen.queryByText(/Commemorates/)).toBeNull();
  });

  it('names each subject, linked to its article where it has one and by name alone where it has none', () => {
    render(<CommemoratesLine subjects={[POZHARSKY, MININ]} />);
    expect(screen.getByText(/^Commemorates:/).textContent).toBe('Commemorates: Dmitry Pozharsky, Kuzma Minin');
    const link = screen.getByRole('link', { name: 'Dmitry Pozharsky' });
    expect(link.getAttribute('href')).toBe('https://en.wikipedia.org/wiki/Dmitry_Pozharsky');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.queryByRole('link', { name: 'Kuzma Minin' })).toBeNull();
  });

  it('offers no link for an address a reader may not be sent to', () => {
    render(<CommemoratesLine subjects={[{ ...POZHARSKY, article_url: 'javascript:alert(1)' }]} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/Dmitry Pozharsky/)).toBeTruthy();
  });

  it('shows the five founders the Republic Monument depicts whole (#2436)', () => {
    const founders = ['Mustafa Kemal Atatürk', 'İsmet İnönü', 'Fevzi Çakmak', 'Kliment Voroshilov', 'Semyon Aralov']
      .map((label, i) => ({ qid: `founder-${i}`, label, article_url: null }));
    render(<CommemoratesLine subjects={founders} word="Depicts" />);
    expect(screen.getByText(/^Depicts:/).textContent).toBe(`Depicts: ${founders.map((f) => f.label).join(', ')}`);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it(`folds a longer list after ${SHOWN_FOLDED} names and opens it in place`, () => {
    const figures = Array.from({ length: 9 }, (_, i) => ({ qid: `figure-${i}`, label: `Figure ${i + 1}`, article_url: null }));
    render(<CommemoratesLine subjects={figures} word="Depicts" />);
    expect(screen.getByText(/^Depicts:/).textContent).toBe('Depicts: Figure 1, Figure 2, Figure 3, Figure 4 and 5 more');
    fireEvent.click(screen.getByRole('button', { name: '5 more' }));
    expect(screen.getByText(/^Depicts:/).textContent).toBe(`Depicts: ${figures.map((f) => f.label).join(', ')}`);
  });

  it('draws nothing where the place names no one', () => {
    const { container } = render(<CommemoratesLine subjects={[]} />);
    expect(container.textContent).toBe('');
    expect(render(<CommemoratesLine subjects={undefined} />).container.textContent).toBe('');
  });
});
