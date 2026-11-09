import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommemoratesLine } from './CommemoratesLine';

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

  it('draws nothing where the place names no one', () => {
    const { container } = render(<CommemoratesLine subjects={[]} />);
    expect(container.textContent).toBe('');
    expect(render(<CommemoratesLine subjects={undefined} />).container.textContent).toBe('');
  });
});
