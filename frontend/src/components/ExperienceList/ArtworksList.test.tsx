/**
 * Tests for what a works list does when a picture does not arrive.
 *
 * Both cases below are regressions this branch shipped and then fixed, one after
 * the other, which is why they are pinned rather than argued in a comment.
 *
 * The first: the credit line was added outside the thumbnail's own guard, so a
 * failed request left a photographer named under nothing — the exact claim the
 * whole feature exists to avoid making.
 *
 * The second came out of fixing the first. Hiding the picture by emptying the
 * URL unmounted the wrapper that carries `onMouseLeave`, and that handler is the
 * only thing that closes the map's artwork overlay. A failure while the pointer
 * rested on the row therefore left a sheet painted over the whole map with
 * nothing able to lift it. The frame is now hung on the URL rather than on
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

import { ArtworksList } from './ArtworksList';

/** The Mesha Stele at the Louvre: a photograph under CC BY-SA, so the credit is owed. */
function work(overrides: Partial<ExperienceTreasure> = {}): ExperienceTreasure {
  return {
    id: 1,
    external_id: 'Q724954',
    name: 'Mesha Stele',
    treasure_type: 'stele',
    artist: null,
    year: null,
    image_url: 'http://commons.wikimedia.org/wiki/Special:FilePath/Mesha%20stele.jpg',
    image_credit: {
      author: 'Mbzt', license: 'CC BY-SA 4.0', licenseUrl: null, detailsUrl: null,
    },
    sitelinks_count: 40,
    ...overrides,
  };
}

function renderList(contents = [work()]) {
  return render(<ArtworksList contents={contents} total={contents.length} experienceId={7} />);
}

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
    expect(setArtworkPreview).toHaveBeenLastCalledWith(expect.objectContaining({
      credit: expect.objectContaining({ author: 'Mbzt' }),
    }));

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
