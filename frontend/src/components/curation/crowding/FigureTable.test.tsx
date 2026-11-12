import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FigureCells, FigureHeadings, figureColumns, VenueCreditLine } from './FigureTable';

const FAME = { readers: 52_310, wikipediaEditions: 9, guideUsed: true, score: 0.41 };

describe('the venue column (#2454)', () => {
  it('stands after the score for a kind whose venues the place pass keeps, and says the score does not read it', () => {
    render(<FigureHeadings columns={figureColumns({ readsVenues: true, venueRadiusM: 200 })} />);
    expect(screen.getAllByRole('columnheader').map(cell => cell.textContent))
      .toEqual(['Readers a year', 'Editions', 'In Wikivoyage', 'Score', 'Venues']);
  });

  it('is absent for a kind that keeps none, and so is its credit', () => {
    const columns = figureColumns({ readsVenues: false, venueRadiusM: null });
    render(<><FigureHeadings columns={columns} /><VenueCreditLine columns={columns} /></>);
    expect(screen.queryByText('Venues')).toBeNull();
    expect(screen.queryByText(/OpenStreetMap/)).toBeNull();
  });

  it("credits OpenStreetMap under a table that shows its venues, visible without a hover (ADR-0059)", () => {
    render(<VenueCreditLine columns={figureColumns({ readsVenues: true, venueRadiusM: 200 })} />);
    expect(screen.getByRole('link', { name: '© OpenStreetMap contributors' })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
  });

  it('counts a square around its point, and a street read along its line per 100 m of it', () => {
    const columns = figureColumns({ readsVenues: true, venueRadiusM: 200 });
    const { container, rerender } = render(<FigureCells columns={columns} signals={{ ...FAME, venues: { figure: 36, per100m: false } }} />);
    expect(within(container).getAllByRole('cell').at(-1)).toHaveTextContent('36');
    // Bergmannstraße (Berlin), a street a traveller walks for its cafés (ADR-0192).
    rerender(<FigureCells columns={columns} signals={{ ...FAME, venues: { figure: 4.24, per100m: true } }} />);
    expect(within(container).getAllByRole('cell').at(-1)).toHaveTextContent('4.2 / 100 m');
    rerender(<FigureCells columns={columns} signals={{ ...FAME, venues: null }} />);
    expect(within(container).getAllByRole('cell').at(-1)).toHaveTextContent('—');
  });
});
