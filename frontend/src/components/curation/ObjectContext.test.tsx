/**
 * Tests for the object a review card is asking about.
 *
 * The property that matters is what happens when a piece is missing. Every field here is
 * genuinely absent on real rows — 14 of 1604 have no image, a landmark commonly has no
 * website — so the card has to render what exists and claim nothing about the rest. An
 * empty frame or a link to nowhere would say the object has something it does not, on the
 * screen whose whole job is to be trusted about the object.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ObjectContext } from './ObjectContext';
import type { ReviewQueueItem } from '../../api/experiences';

function item(over: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    id: 96,
    external_id: '15',
    name: 'Aksum',
    category_id: 1,
    category_name: 'UNESCO World Heritage Sites',
    missing_since: null,
    source_membership: 'present',
    existence: 'extant',
    kind: 'conflict',
    ...over,
  };
}

describe('ObjectContext', () => {
  it('shows the place, the picture, the source and the regions it crosses', () => {
    render(<ObjectContext item={item({
      image_url: 'https://whc.unesco.org/document/12345.jpg',
      latitude: 14.1303,
      longitude: 38.7186,
      website_url: 'https://whc.unesco.org/en/list/15',
      wikipedia_url: 'https://en.wikipedia.org/wiki/Aksum',
      region_names: ['Africa', 'Ethiopia', 'Tigray'],
    })} />);

    expect(screen.getByRole('presentation')).toBeInTheDocument();
    // A button, not a link: nothing in the app reads `lat`/`lon`/`zoom`, so a link would
    // navigate the whole document to the default map view and drop the curator out of the
    // queue mid-decision. It opens the map in place instead.
    const point = screen.getByRole('button', { name: /14\.1303, 38\.7186/ });
    expect(point).toBeInTheDocument();
    expect(point.closest('a')).toBeNull();
    expect(screen.getByRole('link', { name: 'source page' })).toHaveAttribute(
      'href', 'https://whc.unesco.org/en/list/15',
    );
    expect(screen.getByText('Tigray')).toBeInTheDocument();
  });

  it('opens an outbound link without handing it this page', () => {
    render(<ObjectContext item={item({ website_url: 'https://whc.unesco.org/en/list/15' })} />);

    // These go to a source's own site, and `noopener` is what stops that page reaching
    // back into the tab a curator is deciding in.
    const link = screen.getByRole('link', { name: 'source page' });
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders nothing at all when the object carries none of it', () => {
    const { container } = render(<ObjectContext item={item()} />);

    // Not an empty frame and not a row of blanks: a landmark with no image, no point and
    // no links is ordinary, and a placeholder would be the card asserting otherwise.
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the pieces that exist without waiting for the ones that do not', () => {
    render(<ObjectContext item={item({ region_names: ['Berlin', 'Europe', 'Germany'] })} />);

    expect(screen.getByText('Berlin')).toBeInTheDocument();
    expect(screen.queryByRole('presentation')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    // Bounded rather than `\d+\.\d+`: two unbounded runs either side of a literal is
    // the backtracking shape the linter refuses, and a coordinate has a known width.
    expect(screen.queryByText(/\d{1,3}\.\d{4}, /)).not.toBeInTheDocument();
  });

  it('loads no map until someone asks to see the place', () => {
    render(<ObjectContext item={item({ latitude: 14.1303, longitude: 38.7186 })} />);

    // Each map holds a WebGL context and browsers keep about a dozen per tab, while this
    // page renders up to 25 cards per kind across seven kinds. Mounting one per card
    // would evict the earlier contexts and blank the maps, so nothing is built until the
    // button is pressed — and a dialog can only be open once, which caps it at one.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /14\.1303, 38\.7186/ }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog.textContent).toContain('Aksum');
    expect(dialog.textContent).toContain('14.1303, 38.7186');
  });

  it('does not print a coordinate for an object that has no point', () => {
    // `latitude` absent is not `0`: the equator is a real place, and a card that read a
    // missing point as "0.0000, 0.0000" would send a curator to the Gulf of Guinea.
    render(<ObjectContext item={item({ region_names: ['Europe'] })} />);

    expect(screen.queryByText(/0\.0000/)).not.toBeInTheDocument();
  });
});
