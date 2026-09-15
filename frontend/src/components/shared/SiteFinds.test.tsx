/**
 * What a site's card says about the finds dug up there (#894).
 *
 * A traveller at Mycenae reads which museum holds the Mask of Agamemnon; the
 * Parthenon Frieze names London and Athens both. The rules pinned here are the
 * ones a refactor could undo without a type error: the credit hangs on the
 * picture that is actually on screen (#557), an empty list draws no heading,
 * and the rows past the first ten are behind a control a keyboard can reach.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { SiteFind } from '../../api/experiences';

vi.mock('../../hooks/useNavigation', () => ({
  useNavigation: () => ({
    selectedWorldView: { id: 5, name: 'Administrative', isDefault: false },
    isCustomWorldView: true,
  }),
}));

import { SiteFinds } from './SiteFinds';

const ATTICA = { id: 6918, name: 'Attica', world_view_id: 5, world_view_name: 'Administrative' };
const ENGLAND = { id: 7386, name: 'England', world_view_id: 5, world_view_name: 'Administrative' };
const ATHENS = { id: 14551, name: 'National Archaeological Museum of Athens', kind_id: 5, regions: [ATTICA] };
const ACROPOLIS_MUSEUM = { id: 14560, name: 'Acropolis Museum', kind_id: 5, regions: [ATTICA] };
const BRITISH_MUSEUM = { id: 14532, name: 'British Museum', kind_id: 5, regions: [ENGLAND] };

/** The Mask of Agamemnon, as the finds read answers it for Mycenae. */
function find(over: Partial<SiteFind> = {}): SiteFind {
  return {
    id: 3452,
    external_id: 'Q1126741',
    name: 'Mask of Agamemnon',
    treasure_type: 'death mask',
    year: -1600,
    image_url: 'http://commons.wikimedia.org/wiki/Special:FilePath/Athens%20%E2%80%94%20Mask%20of%20Agamemnon.jpg',
    image_credit: { author: 'Gleb Simonov', license: 'CC BY-SA 4.0', licenseUrl: null, detailsUrl: null },
    is_iconic: true,
    sitelinks_count: 38,
    shown_at: [ATHENS],
    ...over,
  };
}

function renderFinds(finds: SiteFind[], total = finds.length, onPreview?: () => void) {
  return render(
    <MemoryRouter initialEntries={['/wv/5/r/6922-peloponnese/e/14730-mycenae']}>
      <SiteFinds finds={finds} total={total} onPreview={onPreview} />
    </MemoryRouter>,
  );
}

describe('SiteFinds', () => {
  it('names the find, what it is and when, and the museum that shows it as a way there', () => {
    renderFinds([find()]);

    expect(screen.getByText('Finds dug up here (1)')).toBeInTheDocument();
    expect(screen.getByText('Mask of Agamemnon')).toBeInTheDocument();
    // "1,600 BC", never the signed integer the column stores.
    expect(screen.getByText('death mask · 1,600 BC')).toBeInTheDocument();
    expect(screen.getByText(/shown at/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'National Archaeological Museum of Athens' })).toBeInTheDocument();
  });

  it('names every museum a find is shown in', () => {
    // The Parthenon Frieze is in London and in Athens, and a traveller at the
    // Acropolis is told both.
    renderFinds([find({ name: 'Parthenon Frieze', shown_at: [BRITISH_MUSEUM, ACROPOLIS_MUSEUM] })]);

    expect(screen.getByText(/shown at/)).toHaveTextContent(
      'shown at British Museum and Acropolis Museum',
    );
  });

  it('hangs the credit on the picture, and takes it down with the picture', () => {
    renderFinds([find()]);
    expect(screen.getByText(/Gleb Simonov/)).toBeInTheDocument();

    fireEvent.error(screen.getByRole('img', { name: 'Mask of Agamemnon' }));

    // A photographer named under nothing credits nobody (#557).
    expect(screen.queryByText(/Gleb Simonov/)).not.toBeInTheDocument();
  });

  it('opens the larger picture over the map only where a surface has a map to draw on', () => {
    const onPreview = vi.fn();
    renderFinds([find()], 1, onPreview);

    fireEvent.mouseEnter(screen.getByRole('img', { name: 'Mask of Agamemnon' }).parentElement!);
    // The 500 px copy, sized once from the stored value: `toThumbnailUrl`
    // appends its width unconditionally, so sizing the 48 px answer again
    // would hand the overlay `?width=120?width=500`.
    expect(onPreview).toHaveBeenCalledWith({
      url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Athens%20%E2%80%94%20Mask%20of%20Agamemnon.jpg?width=500',
      credit: expect.objectContaining({ author: 'Gleb Simonov' }),
    });

    fireEvent.mouseLeave(screen.getByRole('img', { name: 'Mask of Agamemnon' }).parentElement!);
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });

  it('draws nothing at all for a site with no find to list', () => {
    const { container } = renderFinds([]);

    expect(container).toBeEmptyDOMElement();
  });

  it('mounts ten and puts the rest behind a control', () => {
    const many = Array.from({ length: 12 }, (_, i) => find({ id: i + 1, name: `Find ${i + 1}` }));
    renderFinds(many);

    expect(screen.queryByText('Find 11')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 12 finds' }));
    expect(screen.getByText('Find 12')).toBeInTheDocument();
  });
});
