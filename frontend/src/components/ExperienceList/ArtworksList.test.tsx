/**
 * Tests for what a works list does when a picture does not arrive.
 *
 * Both cases below are pinned rather than argued in a comment, because each is
 * a way of getting the first one wrong.
 *
 * The first: a credit line outside the thumbnail's own guard leaves a
 * photographer named under nothing when the request fails — the exact claim the
 * whole feature exists to avoid making.
 *
 * The second follows from fixing the first. Hiding the picture by emptying the
 * URL unmounts the wrapper that carries `onMouseLeave`, and that handler is the
 * only thing that closes the map's artwork overlay: a failure while the pointer
 * rests on the row then leaves a sheet painted over the whole map with
 * nothing able to lift it. So the frame hangs on the URL rather than on
 * whether the picture loaded, and only the `<img>` and the credit answer to the
 * failure — an arrangement one refactor could undo silently, since the comment
 * that explains it is not executable and this file is.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ExperienceTreasure } from '../../api/experiences';

const setArtworkPreview = vi.fn();

vi.mock('../../hooks/useExperienceContext', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../utils/imageUrl');
  return {
    useExperienceContext: () => ({ setArtworkPreview }),
    toThumbnailUrl: actual.toThumbnailUrl,
  };
});

// Mutable, because the tick box only exists for somebody with an account to
// record against — so a fixed `false` puts the labelled control out of reach of
// every case in this file, which is how its label went untested.
let signedIn = false;
/** Which works this reader has already seen, so the flipped label can be reached. */
const viewed = new Set<number>();
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: signedIn }) }));

vi.mock('../../hooks/useVisitedExperiences', () => ({
  useViewedTreasures: () => ({
    viewedIds: viewed, viewedCount: viewed.size, markViewed: vi.fn(), unmarkViewed: vi.fn(),
  }),
}));

// The link a find spot becomes (#894) reads the world view and writes the
// address; the test cases that use it render inside a router.
vi.mock('../../hooks/useNavigation', () => ({
  useNavigation: () => ({
    selectedWorldView: { id: 5, name: 'Administrative', isDefault: false },
    isCustomWorldView: true,
  }),
}));

import { MemoryRouter } from 'react-router';
import { ArtworksList } from './ArtworksList';

/** The Mesha Stele at the Louvre: a photograph under CC BY-SA, so the credit is owed. */
function work(overrides: Partial<ExperienceTreasure> = {}): ExperienceTreasure {
  return {
    id: 1,
    external_id: 'Q724954',
    name: 'Mesha Stele',
    treasure_type: 'stele',
    artists: [],
    artists_curated: false,
    year: null,
    image_url: 'http://commons.wikimedia.org/wiki/Special:FilePath/Mesha%20stele.jpg',
    image_credit: {
      author: 'Mbzt', license: 'CC BY-SA 4.0', licenseUrl: null, detailsUrl: null,
    },
    sitelinks_count: 40,
    is_iconic: false,
    curated_fields: [],
    venue_count: 1,
    found_at: null,
    found_at_site: null,
    ...overrides,
  };
}

function renderList(contents = [work()]) {
  return render(<ArtworksList contents={contents} total={contents.length} experienceId={7} />);
}

describe('a work with more than one maker', () => {
  beforeEach(() => setArtworkPreview.mockReset());

  it('names both, because that is the fact rather than a summary of it', () => {
    // Shishkin painted the forest and Savitsky the bears. Naming one was the
    // catalogue picking a winner the source never picked (#720).
    renderList([work({
      name: 'Morning in a Pine Forest',
      artists: ['Ivan Shishkin', 'Konstantin Savitsky'],
      year: 1889,
    })]);

    expect(screen.getByText(/Ivan Shishkin and Konstantin Savitsky/)).toBeInTheDocument();
  });

  it('counts them rather than naming a leader nobody chose', () => {
    // The pool's own answer for the Moon Museum arrives with David Novros in
    // front and Andy Warhol last — the banded query answers in reverse of the
    // source's order (ADR-0040) — so leading with the first name would name a
    // query planner's pick as the artist who led six.
    renderList([work({
      name: 'Moon Museum',
      artists: [
        'David Novros', 'Forrest Myers', 'John Chamberlain',
        'Robert Rauschenberg', 'Claes Oldenburg', 'Andy Warhol',
      ],
    })]);

    expect(screen.getByText(/6 artists/)).toBeInTheDocument();
    expect(screen.queryByText(/David Novros/)).not.toBeInTheDocument();
  });

  it('leads with the first name once a curator has claimed the order', () => {
    renderList([work({
      name: 'Moon Museum',
      artists: [
        'Andy Warhol', 'Claes Oldenburg', 'Robert Rauschenberg',
        'John Chamberlain', 'Forrest Myers', 'David Novros',
      ],
      artists_curated: true,
    })]);

    // Now the first name is somebody's answer rather than a row order.
    expect(screen.getByText(/Andy Warhol and 5 others/)).toBeInTheDocument();
  });

  it('drops the credit when the photographer is any of the makers, not just the first', () => {
    // Commons names the painter as the author of a photograph of a painting, so
    // a row already reading "Leonardo da Vinci and Andrea del Verrocchio" gains
    // nothing from a credit naming the second of them.
    renderList([work({
      name: 'The Baptism of Christ',
      artists: ['Leonardo da Vinci', 'Andrea del Verrocchio'],
      image_credit: {
        author: 'Andrea del Verrocchio', license: 'Public domain',
        licenseUrl: null, detailsUrl: null,
      },
    })]);

    expect(screen.queryByText(/Public domain/)).not.toBeInTheDocument();
  });
});

/**
 * Where a find was dug up.
 *
 * An archaeology museum's holdings are things taken from somewhere, and that
 * somewhere is half of what the object is (ADR-0058): the Rosetta Stone is a
 * British Museum object and a Fort Julien one — the fort at Rashid where it was
 * dug up, which is what the run stores — and a row naming only the museum
 * tells a traveller the smaller half. Only the finds carry it — a painting has
 * a maker and no find spot — so the line has to be absent rather than empty on
 * every other work in the catalogue.
 */
describe('a work that was dug up somewhere', () => {
  it('says where, under the makers', () => {
    renderList([work({
      name: 'Rosetta Stone', external_id: 'Q48584', artists: [], image_url: null,
      found_at: { qid: 'Q3077898', label: 'Fort Julien' },
    })]);

    expect(screen.getByText(/found at Fort Julien/)).toBeInTheDocument();
  });

  it('says nothing on a work with no find spot', () => {
    renderList([work({ name: 'Mona Lisa', artists: ['Leonardo da Vinci'] })]);

    expect(screen.queryByText(/found at/)).not.toBeInTheDocument();
  });

  it('makes the spot a way to the site where the catalogue holds it', () => {
    // "found at Mycenae" opens Mycenae's card where the reader's world view
    // places the site (#894); Fort Julien above stays words, since no site row
    // carries that id.
    render(
      <MemoryRouter initialEntries={['/wv/5/r/6918-attica/e/14551-athens']}>
        <ArtworksList
          contents={[work({
            name: 'Mask of Agamemnon', external_id: 'Q1126741', image_url: null,
            found_at: { qid: 'Q131594', label: 'Mycenae' },
            found_at_site: {
              id: 14730, name: 'Mycenae', kind_id: 5,
              regions: [{ id: 6922, name: 'Peloponnese', world_view_id: 5, world_view_name: 'Administrative' }],
            },
          })]}
          total={1}
          experienceId={14551}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/found at/)).toHaveTextContent('found at Mycenae');
    expect(screen.getByRole('button', { name: 'Mycenae' })).toBeInTheDocument();
  });
});

describe('a work whose picture does not arrive', () => {
  beforeEach(() => setArtworkPreview.mockReset());

  it('names the photographer while the picture is on screen', () => {
    renderList();

    expect(screen.getByText(/Mbzt/)).toBeInTheDocument();
  });

  it('takes the credit away with the picture that failed', () => {
    renderList();
    fireEvent.error(screen.getByAltText('Mesha Stele'));

    // A photographer named under no photograph is credited for nothing.
    expect(screen.queryByText(/Mbzt/)).not.toBeInTheDocument();
  });

  it('still closes the map overlay when the picture fails under the pointer', () => {
    const { container } = renderList();
    const frame = container.querySelector('img')!.parentElement!;

    fireEvent.mouseEnter(frame);
    // The 500 px copy, sized once from the stored value: `toThumbnailUrl`
    // appends its width unconditionally, so sizing the 48 px answer again
    // would hand the overlay `?width=120?width=500` — which the extraction
    // of `WorkThumbnail` did for one review round (#894).
    expect(setArtworkPreview).toHaveBeenLastCalledWith({
      url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Mesha%20stele.jpg?width=500',
      credit: expect.objectContaining({ author: 'Mbzt' }),
    });

    // The failure arrives while the pointer is still on the row — the ordering
    // `loading="lazy"` makes ordinary, since the request often starts at hover.
    fireEvent.error(screen.getByAltText('Mesha Stele'));
    fireEvent.mouseLeave(frame);

    // If the frame had been unmounted by the failure, this would never fire and
    // the overlay would stay painted over the map until some other row was hovered.
    expect(setArtworkPreview).toHaveBeenLastCalledWith(null);
  });

  it('offers no preview once the picture is known to have failed', () => {
    const { container } = renderList();
    const frame = container.querySelector('img')!.parentElement!;

    fireEvent.error(screen.getByAltText('Mesha Stele'));
    setArtworkPreview.mockReset();
    fireEvent.mouseEnter(frame);

    // The larger copy is the same file, so there is nothing to show.
    expect(setArtworkPreview).not.toHaveBeenCalled();
  });
});

/**
 * The way past the first ten works.
 *
 * This list has no fold and no heading — it renders `ARTWORKS_INITIAL_LIMIT`
 * works and hides the rest behind one reveal. So that control is the only route
 * to works eleven and up, and as a `<div onClick>` it was a route for a mouse
 * alone: a keyboard reader could tick off ten of the Louvre's holdings and reach
 * none of the other hundred-odd. Nothing in the gates would say so — `jsx-a11y`
 * is not installed — so the check is here.
 */
describe('the way past the first ten works', () => {
  function many(n: number) {
    return Array.from({ length: n }, (_, i) => work({ id: i + 1, name: `Work ${i + 1}` }));
  }

  it('is a control the keyboard can reach and operate', () => {
    renderList(many(12));

    // Eleven and twelve are not rendered at all until this is pressed.
    expect(screen.queryByText('Work 11')).not.toBeInTheDocument();

    const reveal = screen.getByRole('button', { name: /Show all 12 works/ });
    expect(reveal).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(reveal, { key: 'Enter' });

    expect(screen.getByText('Work 11')).toBeInTheDocument();
    expect(screen.getByText('Work 12')).toBeInTheDocument();
  });

  it('is absent when there is nothing behind it', () => {
    renderList(many(3));

    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });
});

/**
 * The tick box beside a work.
 *
 * A bare `Checkbox` is announced as "checkbox, not checked" and nothing else —
 * neither which work it is nor what ticking it says about it — which on a list of
 * a hundred and twenty is unusable. It is also a native checkbox, so it answers
 * Space and not Enter; the tile in Discover is a button and answers both, and the
 * two are easy to state as one rule and get wrong.
 */
describe('the tick box beside a work', () => {
  beforeEach(() => { signedIn = true; });
  afterEach(() => { signedIn = false; viewed.clear(); });

  it('names the work and what ticking it will do', () => {
    renderList();

    expect(screen.getByRole('checkbox', { name: /Mesha Stele — mark as seen/ }))
      .toBeInTheDocument();
  });

  it('names the other outcome once the work is recorded', () => {
    viewed.add(1);
    renderList();

    expect(screen.getByRole('checkbox', { name: /Mesha Stele — mark as not seen/ }))
      .toBeInTheDocument();
  });
});

/**
 * What the box of holdings is called.
 *
 * An archaeology museum holds finds, not works: the Rosetta Stone was dug up,
 * not made for a wall, and "Notable works" over a case of steles and pottery is
 * the art museum's noun borrowed for a room it does not describe (ADR-0058).
 */
describe('what the box of holdings is called', () => {
  const ARCHAEOLOGY = 5;
  const ART_MUSEUMS = 2;

  it('calls an archaeology museum\'s holdings finds, heading and control alike', () => {
    const finds = Array.from({ length: 12 }, (_, i) => work({ id: i + 1, name: `Find ${i + 1}` }));
    render(
      <ArtworksList contents={finds} total={12} experienceId={7} kindId={ARCHAEOLOGY} />,
    );

    expect(screen.getByText(/Notable finds \(12\)/)).toBeInTheDocument();
    // The control that opens the rest of the list names the same things the
    // heading does: "Notable finds" over "Show all 12 works" is one box giving a
    // traveller two words for one case of steles.
    expect(screen.getByRole('button', { name: /Show all 12 finds/ })).toBeInTheDocument();
  });

  it('calls every other kind\'s holdings works, as it always has', () => {
    render(
      <ArtworksList contents={[work()]} total={1} experienceId={7} kindId={ART_MUSEUMS} />,
    );

    expect(screen.getByText(/Notable works \(1\)/)).toBeInTheDocument();
  });

  it('says works where no kind came with the row', () => {
    renderList();

    expect(screen.getByText(/Notable works \(1\)/)).toBeInTheDocument();
  });
});
