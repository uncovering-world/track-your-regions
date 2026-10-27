/**
 * A region's map and its credit are drawn together or not at all (#2087): the
 * credit is asked for by the file's address, and goes away with a picture that
 * failed to load.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RegionMapCreditLine, RegionMapPicture } from './RegionMapPicture';

const { getMapImageCredits } = vi.hoisted(() => ({ getMapImageCredits: vi.fn() }));
vi.mock('../../api/admin/worldViewImport', () => ({ getMapImageCredits }));

// The map Wikivoyage's Algeria article draws, and what Commons says of it.
const ALGERIA_MAP = 'https://commons.wikimedia.org/wiki/Special:FilePath/Algeria_regions_map.png';
const FITZGERALD = {
  author: 'Peter Fitzgerald',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
  detailsUrl: 'https://commons.wikimedia.org/wiki/File:Algeria_regions_map.png',
};

function withQueries(node: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>,
  );
}

beforeEach(() => {
  getMapImageCredits.mockReset();
  getMapImageCredits.mockResolvedValue({ credits: [{ url: ALGERIA_MAP, credit: FITZGERALD }] });
});

describe('RegionMapPicture', () => {
  it('draws the map sized through the thumbnail rule, with its author under it', async () => {
    withQueries(<RegionMapPicture worldViewId={2} url={ALGERIA_MAP} width={500} alt="Region map" />);

    expect(screen.getByRole('img', { name: 'Region map' })).toHaveAttribute('src', `${ALGERIA_MAP}?width=500`);
    expect(await screen.findByText('Peter Fitzgerald')).toBeInTheDocument();
    expect(getMapImageCredits).toHaveBeenCalledWith(2, [ALGERIA_MAP]);
  });

  it('draws neither the map nor its credit once the picture failed to load', async () => {
    withQueries(<RegionMapPicture worldViewId={2} url={ALGERIA_MAP} width={500} alt="Region map" />);
    await screen.findByText('Peter Fitzgerald');

    fireEvent.error(screen.getByRole('img', { name: 'Region map' }));

    expect(screen.queryByRole('img', { name: 'Region map' })).not.toBeInTheDocument();
    expect(screen.queryByText('Peter Fitzgerald')).not.toBeInTheDocument();
  });

  it('draws nothing for an address no <img> may draw, and asks for no credit', () => {
    withQueries(<RegionMapPicture worldViewId={2} url="javascript:alert(1)" width={500} alt="Region map" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(getMapImageCredits).not.toHaveBeenCalled();
  });
});

describe('RegionMapCreditLine', () => {
  it('names nobody for a reference map that came from no region map', () => {
    withQueries(<RegionMapCreditLine worldViewId={2} url={null} />);

    expect(getMapImageCredits).not.toHaveBeenCalled();
    expect(screen.queryByText('Peter Fitzgerald')).not.toBeInTheDocument();
  });
});
