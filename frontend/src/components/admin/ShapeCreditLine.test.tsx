/**
 * The credit under a drawn region shape (#2085): the Commons map file it was
 * read from, its licence and its sources, or nothing where nothing is drawn.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShapeCreditLine } from './ShapeCreditLine';

const northSeaCoast = {
  label: 'Data:North_Sea_Coast_region.map',
  url: 'https://commons.wikimedia.org/wiki/Data:North_Sea_Coast_region.map',
  licence: 'ODbL-1.0',
  attribution: 'Based on OpenStreetMap data',
};

describe('ShapeCreditLine', () => {
  it('names the file, linked to its page, with its licence and sources', () => {
    render(<ShapeCreditLine credits={[northSeaCoast]} />);

    const link = screen.getByRole('link', { name: 'Data:North_Sea_Coast_region.map' });
    expect(link).toHaveAttribute('href', northSeaCoast.url);
    expect(link.closest('span')?.parentElement).toHaveTextContent(
      'Shape: Data:North_Sea_Coast_region.map, ODbL-1.0 (Based on OpenStreetMap data)',
    );
  });

  it('lists every shape a map draws', () => {
    render(<ShapeCreditLine credits={[northSeaCoast, { ...northSeaCoast, label: 'Data:B.map', url: 'https://commons.wikimedia.org/wiki/Data:B.map', attribution: null }]} />);

    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByText(/^Shapes:/)).toHaveTextContent('; Data:B.map, ODbL-1.0');
  });

  it('renders nothing for no credit', () => {
    const { container } = render(<ShapeCreditLine credits={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
