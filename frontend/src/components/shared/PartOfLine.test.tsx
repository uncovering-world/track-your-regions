/**
 * A part's own card names the whole it is a part of, for a visitor (#2118):
 * Seville Cathedral, one of the three places of the Cathedral, Alcázar and
 * Archivo de Indias in Seville.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('./PlaceLink', () => ({ PlaceLink: ({ place }: { place: { name: string } }) => <a href="#whole">{place.name}</a> }));

import { PartOfLine } from './PartOfLine';

const SITE = {
  id: 1175, name: 'Cathedral, Alcázar and Archivo de Indias in Seville', point_id: 41213, places: 3, kind_id: 1, regions: [],
};

describe("a part's line about its whole", () => {
  it('names the whole, linked, and how many places it is', () => {
    render(<PartOfLine partOf={SITE} />);
    expect(screen.getByRole('link', { name: SITE.name })).toBeInTheDocument();
    expect(screen.getByText(/· 3 places$/)).toBeInTheDocument();
  });

  it('is not drawn where no reader may be sent to the whole, nor on a place that is no part', () => {
    const { container, rerender } = render(<PartOfLine partOf={{ ...SITE, places: null }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<PartOfLine partOf={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
