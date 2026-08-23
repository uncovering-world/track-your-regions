/**
 * Tests for one work in Discover's grid of a museum's holdings.
 *
 * Two promises, both invisible in the markup at a glance.
 *
 * The tile *is* the control: clicking it is how a reader records having seen a
 * work, and there is no other affordance for it on this screen. Built as a plain
 * `<div onClick>` — which it was — a keyboard reader could read every work in the
 * Louvre and record none of them. `jsx-a11y` is not installed, so nothing in the
 * gate would say so.
 *
 * And the credit belongs to the picture rather than to the row: a photographer
 * named beside a frame whose image answered 403 is a claim made where the thing
 * that would justify it is not.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ExperienceTreasure } from '../../api/experiences';
import { ContentTile } from './ContentTile';

/** The Mesha Stele at the Louvre: a CC BY-SA photograph, so the credit is owed. */
function work(over: Partial<ExperienceTreasure> = {}): ExperienceTreasure {
  return {
    id: 1,
    external_id: 'Q724954',
    name: 'Mesha Stele',
    treasure_type: 'stele',
    artist: null,
    year: null,
    image_url: 'http://commons.wikimedia.org/wiki/Special:FilePath/Mesha%20stele.jpg',
    image_credit: {
      author: 'Mbzt', license: 'CC BY-SA 4.0', licenseUrl: null,
      detailsUrl: 'https://commons.wikimedia.org/wiki/File:Mesha_stele.jpg',
    },
    sitelinks_count: 40,
    ...over,
  };
}

function renderTile(
  over: Partial<ExperienceTreasure> = {}, isViewed = false, isAuthenticated = true,
) {
  const onToggleViewed = vi.fn();
  const utils = render(
    <ContentTile
      content={work(over)}
      isViewed={isViewed}
      isAuthenticated={isAuthenticated}
      onToggleViewed={onToggleViewed}
    />,
  );
  return { ...utils, onToggleViewed };
}

describe('a work in the contents grid', () => {
  it('is a control a keyboard can reach and operate', () => {
    const { onToggleViewed } = renderTile();

    const tile = screen.getByRole('button', { name: /Mesha Stele — mark as seen/ });
    expect(tile).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(tile, { key: 'Enter' });
    expect(onToggleViewed).toHaveBeenCalled();
  });

  it('says what the press will do, not what the tile is', () => {
    // A reader hears the label before the press, so it has to name the outcome —
    // and the outcome is the opposite one once the work is already seen.
    renderTile({}, true);

    expect(screen.getByRole('button', { name: /mark as not seen/ })).toBeInTheDocument();
  });

  it('offers no control to a reader who has nothing to record it against', () => {
    // `/discover` is public and the write behind this needs a session, so a tab
    // stop here would announce an action that answers 401 in silence — worse for
    // a screen-reader user than announcing nothing.
    renderTile({}, false, false);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // The work itself is still there to look at, credit and all.
    expect(screen.getByAltText('Mesha Stele')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mbzt' })).toBeInTheDocument();
  });

  it('hangs the work\'s details on the element a keyboard can reach', async () => {
    // `Tooltip` binds its listeners to its own child. Bound to the name strip — a
    // plain div that never takes focus — the artist, the year and the credit were
    // shown to a pointer alone, on a tile that is a focus stop.
    //
    // What is asserted is *which element carries the listeners*, not the focus path
    // itself: MUI opens on focus only for `:focus-visible`, which jsdom does not
    // implement, so a focus-based assertion would pass or fail for reasons that have
    // nothing to do with this. Reaching the control opens the tooltip; bound to the
    // inner strip, as it was, this event never reaches it.
    renderTile({ artist: 'Mesha', year: -840 });

    fireEvent.mouseOver(screen.getByRole('button', { name: /Mesha Stele/ }));

    expect(await screen.findByRole('tooltip')).toHaveTextContent(/Mesha.*840.*Mbzt/);
  });

  it('keeps saying what the press will do, rather than describing the work', () => {
    // Without `describeChild` MUI writes the tooltip into the child's `aria-label`,
    // and the announcement becomes the description instead of the action.
    renderTile({ artist: 'Mesha' });

    expect(screen.getByRole('button', { name: /Mesha Stele — mark as seen/ }))
      .toBeInTheDocument();
  });

  it('names the photographer under the picture it draws', () => {
    renderTile();

    expect(screen.getByRole('link', { name: 'Mbzt' })).toBeInTheDocument();
  });

  it('takes the credit away with a picture that did not arrive', () => {
    renderTile();

    fireEvent.error(screen.getByAltText('Mesha Stele'));

    expect(screen.queryByRole('link', { name: 'Mbzt' })).not.toBeInTheDocument();
    // The tile stays, and stays operable: the work is still there to be marked.
    expect(screen.getByRole('button', { name: /Mesha Stele/ })).toBeInTheDocument();
  });
});
