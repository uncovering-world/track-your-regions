import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CommemoratesLine, SHOWN_FOLDED } from './CommemoratesLine';

// The Monument to Minin and Pozharsky (Q187531) depicts Dmitry Pozharsky (Q15756) and Kuzma Minin (Q469785).
const POZHARSKY = { qid: 'Q15756', label: 'Dmitry Pozharsky', article_url: 'https://en.wikipedia.org/wiki/Dmitry_Pozharsky', role: null };
const MININ = { qid: 'Q469785', label: 'Kuzma Minin', article_url: null, role: null };

describe('CommemoratesLine', () => {
  it('says what a religious work depicts under its own word (#2404)', () => {
    // Christ the Redeemer (Q79961) depicts Jesus Christ (Q302).
    render(<CommemoratesLine subjects={[{ qid: 'Q302', label: 'Jesus Christ', article_url: 'https://en.wikipedia.org/wiki/Jesus', role: null }]} word="Depicts" />);
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
      .map((label, i) => ({ qid: `founder-${i}`, label, article_url: null, role: null }));
    render(<CommemoratesLine subjects={founders} word="Depicts" />);
    expect(screen.getByText(/^Depicts:/).textContent).toBe(`Depicts: ${founders.map((f) => f.label).join(', ')}`);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it(`folds a longer list after ${SHOWN_FOLDED} names and opens it in place`, () => {
    const figures = Array.from({ length: 9 }, (_, i) => ({ qid: `figure-${i}`, label: `Figure ${i + 1}`, article_url: null, role: null }));
    render(<CommemoratesLine subjects={figures} word="Depicts" />);
    expect(screen.getByText(/^Depicts:/).textContent).toBe('Depicts: Figure 1, Figure 2, Figure 3, Figure 4 and 5 more');
    fireEvent.click(screen.getByRole('button', { name: '5 more' }));
    expect(screen.getByText(/^Depicts:/).textContent).toBe(`Depicts: ${figures.map((f) => f.label).join(', ')}`);
  });

  it('names the form each figure is shown in after its group, and folds no such line (#2485)', () => {
    // The Neptune Fountain in Berlin (Q650657): four women who are the rivers of Prussia. Figures stand in by name.
    const figure = (label: string, role: string | null = null) => ({ qid: label, label, article_url: null, role });
    const fountain = [figure('Neptune'), figure('Triton'), ...['Rhine', 'Elbe', 'Oder', 'Vistula'].map((river) => figure(river, 'women'))];
    render(<CommemoratesLine subjects={fountain} word="Depicts" />);
    expect(screen.getByText(/^Depicts:/).textContent).toBe('Depicts: Neptune, Triton; Rhine, Elbe, Oder and Vistula as women');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('names the role the Lady Godiva statue shows her in (#2485)', () => {
    // The Lady Godiva equestrian statue (Q17540305) shows Lady Godiva (Q106077) as an equestrian (Q2730732).
    render(<CommemoratesLine subjects={[{ qid: 'Q106077', label: 'Lady Godiva', article_url: 'https://en.wikipedia.org/wiki/Lady_Godiva', role: 'equestrian' }]} />);
    expect(screen.getByText(/^Commemorates:/).textContent).toBe('Commemorates: Lady Godiva as equestrian');
    expect(screen.getByRole('link', { name: 'Lady Godiva' })).toBeTruthy();
  });

  it('draws nothing where the place names no one', () => {
    const { container } = render(<CommemoratesLine subjects={[]} />);
    expect(container.textContent).toBe('');
    expect(render(<CommemoratesLine subjects={undefined} />).container.textContent).toBe('');
  });
});
