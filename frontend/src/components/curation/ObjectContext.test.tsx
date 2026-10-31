/**
 * Tests for the object a review card is asking about.
 *
 * The property that matters is what happens when a piece is missing. Every field here is
 * genuinely absent on real rows — a few dozen have no image, a landmark commonly has no
 * website — so the card has to render what exists and claim nothing about the rest. An
 * empty frame or a link to nowhere would say the object has something it does not, on the
 * screen whose whole job is to be trusted about the object.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ObjectContext } from './ObjectContext';
import type { ReviewQueueItem } from '../../api/reviewQueue';

function item(over: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    id: 96,
    external_id: '15',
    name: 'Aksum',
    kind_id: 1,
    kind_name: 'World Heritage Sites',
    missing_since: null,
    source_membership: 'present',
    existence: 'extant',
    kind: 'conflict',
    // Required rather than optional on purpose (`api/reviewQueue.ts`): every queue
    // selects it explicitly so `item.proposed === null` is the whole check anywhere.
    proposed: null,
    ...over,
  };
}

describe('ObjectContext', () => {
  it('shows the place, the picture, the source and the regions it crosses', () => {
    render(<ObjectContext item={item({
      image_url: 'http://commons.wikimedia.org/wiki/Special:FilePath/Aksum%20stelae.jpg',
      latitude: 14.1303,
      longitude: 38.7186,
      unesco_url: 'https://whc.unesco.org/en/list/15',
      wikipedia_url: 'https://en.wikipedia.org/wiki/Aksum',
      region_names: ['Africa', 'Ethiopia', 'Tigray'],
    })} />);

    // A button and not an image with a click handler: 96×72 answers "is there a picture"
    // while the question a curator has is "is this the building I think it is", so the
    // thumbnail opens a larger copy — and a control that cannot be reached from the
    // keyboard is one a screen reader announces and then cannot operate.
    expect(screen.getByRole('button', { name: /Aksum — enlarge the picture/ })).toBeInTheDocument();
    // A button, not a link: nothing in the app reads `lat`/`lon`/`zoom`, so a link would
    // navigate the whole document to the default map view and drop the curator out of the
    // queue mid-decision. It opens the map in place instead.
    const point = screen.getByRole('button', { name: /14\.1303, 38\.7186/ });
    expect(point).toBeInTheDocument();
    expect(point.closest('a')).toBeNull();
    expect(screen.getByRole('link', { name: 'UNESCO page' })).toHaveAttribute(
      'href', 'https://whc.unesco.org/en/list/15',
    );
    expect(screen.getByText('Tigray')).toBeInTheDocument();
  });

  it('folds a long list of regions to the broadest, and unfolds the rest on request (#2195)', () => {
    // The Beech Forests count in 68 regions — Europe, 18 countries and 49 regions of
    // theirs — and a wall of chips on every one of the site's cards said nothing a curator
    // could read. Ten regions here, the smallest list that folds.
    const regions = ['Austria', 'Bavaria', 'Carinthia', 'Europe', 'Germany', 'Hesse', 'Lower Austria', 'Slovakia', 'Thuringia', 'Ukraine'];
    render(<ObjectContext item={item({
      name: 'Ancient and Primeval Beech Forests of the Carpathians and Other Regions of Europe',
      region_names: regions,
      top_region_names: ['Europe', 'Austria', 'Germany', 'Slovakia', 'Ukraine'],
    })} />);

    expect(screen.getByText('Europe')).toBeInTheDocument();
    expect(screen.getByText('Slovakia')).toBeInTheDocument();
    expect(screen.queryByText('Bavaria')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+5 regions' }));
    expect(screen.getByText('Bavaria')).toBeInTheDocument();
    expect(screen.getByText('Thuringia')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /regions/ })).not.toBeInTheDocument();
  });

  it('shows up to nine regions whole, the broadest among them', () => {
    // Most places count in three; a fold there would hide the one region a curator looks for.
    render(<ObjectContext item={item({
      region_names: ['Africa', 'Ethiopia', 'Tigray'], top_region_names: ['Africa', 'Ethiopia'],
    })} />);
    expect(screen.getByText('Tigray')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /regions/ })).not.toBeInTheDocument();
  });

  it('says what the object is in one line, whole on hover (#1780)', () => {
    const line = 'museum in Saint Petersburg, Russia';
    render(<ObjectContext item={item({ name: 'Hermitage Museum', object_description: `  ${line} ` })} />);

    const description = screen.getByText(line);
    expect(description).toHaveAttribute('title', line);
  });

  it('draws no description line for a blank one', () => {
    const { container } = render(<ObjectContext item={item({ object_description: '   ' })} />);
    expect(container.querySelector('p[title]')).toBeNull();
  });

  it("links the list's table of a serial site's parts, and no table for a place that is no whole (#2183)", () => {
    // Western Tien-Shan (1490): the property's page names "Mount Chatkal" alone; its
    // thirteen parts are in the table, which a lost-places question is decided off.
    render(<ObjectContext item={item({
      external_id: '1490', name: 'Western Tien-Shan', unesco_url: 'https://whc.unesco.org/en/list/1490', parts_total: 13,
    })} />);
    expect(screen.getByRole('link', { name: 'the list of its parts' }))
      .toHaveAttribute('href', 'https://whc.unesco.org/en/list/1490/maps/');
    expect(screen.getByRole('link', { name: 'UNESCO page' })).toHaveAttribute('href', 'https://whc.unesco.org/en/list/1490');
    cleanup();
    // The row another kind names, by its Wikidata item: the property's page still names the number.
    render(<ObjectContext item={item({
      external_id: 'Q5684', kind_id: 5, kind_name: 'Archaeology', unesco_url: 'https://whc.unesco.org/en/list/278', parts_total: 3,
    })} />);
    expect(screen.getByRole('link', { name: 'the list of its parts' })).toHaveAttribute('href', 'https://whc.unesco.org/en/list/278/maps/');
    cleanup();
    render(<ObjectContext item={item({ external_id: '15', unesco_url: 'https://whc.unesco.org/en/list/15', parts_total: 0 })} />);
    expect(screen.queryByRole('link', { name: 'the list of its parts' })).not.toBeInTheDocument();
  });

  it('offers one link where the official website is UNESCO\'s page (#1538)', () => {
    render(<ObjectContext item={item({
      unesco_url: 'https://whc.unesco.org/en/list/15',
      website_url: 'https://whc.unesco.org/en/list/15',
    })} />);
    expect(screen.getByRole('link', { name: 'UNESCO page' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'official site' })).not.toBeInTheDocument();
  });

  it('offers no official site that is a World Heritage Centre page under another scheme or page (#1851)', () => {
    // Zvartnots: Wikidata's website is UNESCO's documents page of its property.
    render(<ObjectContext item={item({
      unesco_url: 'https://whc.unesco.org/en/list/1011',
      website_url: 'https://whc.unesco.org/en/list/1011/documents/',
    })} />);
    expect(screen.getByRole('link', { name: 'UNESCO page' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'official site' })).not.toBeInTheDocument();
  });

  it('opens an outbound link without handing it this page', () => {
    render(<ObjectContext item={item({ unesco_url: 'https://whc.unesco.org/en/list/15' })} />);

    // These go to a source's own site, and `noopener` is what stops that page reaching
    // back into the tab a curator is deciding in.
    const link = screen.getByRole('link', { name: 'UNESCO page' });
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('links neither page when the stored value is not a web address', () => {
    // A sync writes both columns through no request schema, so a value the curator's
    // form would refuse can still be stored. The card names no link for it rather than
    // handing the value to an href.
    render(<ObjectContext item={item({
      region_names: ['Africa', 'Ethiopia', 'Tigray'],
      website_url: 'javascript:alert(document.cookie)',
      wikipedia_url: 'data:text/html,<script>alert(1)</script>',
    })} />);

    expect(screen.getByText('Tigray')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText('official site')).not.toBeInTheDocument();
    expect(screen.queryByText('Wikipedia')).not.toBeInTheDocument();
  });

  it('links the page that is a web address and leaves out the one that is not', () => {
    render(<ObjectContext item={item({
      website_url: ' javascript:alert(1)',
      wikipedia_url: 'https://en.wikipedia.org/wiki/Aksum',
    })} />);

    expect(screen.getByRole('link', { name: 'Wikipedia' })).toHaveAttribute(
      'href', 'https://en.wikipedia.org/wiki/Aksum',
    );
    expect(screen.queryByRole('link', { name: 'official site' })).not.toBeInTheDocument();
  });

  it('renders nothing for an object whose only link is refused', () => {
    // A refused link is not something the object has: the card stays away rather
    // than drawing a frame around nothing.
    const { container } = render(<ObjectContext item={item({ website_url: 'javascript:alert(1)' })} />);

    expect(container).toBeEmptyDOMElement();
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
    expect(screen.queryByRole('button', { name: /enlarge the picture/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    // Bounded rather than `\d+\.\d+`: two unbounded runs either side of a literal is
    // the backtracking shape the linter refuses, and a coordinate has a known width.
    expect(screen.queryByText(/\d{1,3}\.\d{4}, /)).not.toBeInTheDocument();
  });

  it('loads no map until someone asks to see the place', () => {
    render(<ObjectContext item={item({ latitude: 14.1303, longitude: 38.7186 })} />);

    // Each map holds a WebGL context and browsers keep about a dozen per tab, while this
    // page renders up to 25 cards per kind across every kind the queue returns — and one
    // of those cards can hold 25 dialogs of its own. Mounting one per card
    // would evict the earlier contexts and blank the maps, so nothing is built until the
    // button is pressed — and a dialog can only be open once, which caps it at one.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /14\.1303, 38\.7186/ }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog.textContent).toContain('Aksum');
    expect(dialog.textContent).toContain('14.1303, 38.7186');
  });

  it('says an object is made of several places, so a diff about one part reads as one part', () => {
    // UNESCO 1239, Berlin Modernism Housing Estates: the source proposed a
    // description of one of its seven estates and the card showed it against the
    // site's own text with nothing to say the site had parts.
    render(<ObjectContext item={item({ offered_locations: 7, latitude: 52.4506, longitude: 13.2636 })} />);

    expect(screen.getByText(/made of 7 places/)).toBeInTheDocument();
    // A place of several points has no coordinate of its own (ADR-0095): the stored
    // point is the anchor of one of its estates, and its number is not shown.
    expect(screen.queryByText('52.4506, 13.2636')).not.toBeInTheDocument();
  });

  it('says how many works a venue holds', () => {
    render(<ObjectContext item={item({ offered_locations: 1, counted_works_total: 122 })} />);

    expect(screen.getByText(/holds 122 famous works/)).toBeInTheDocument();
  });

  it('counts one work in the singular, beside the plural above', () => {
    // 43 of the 128 work-holding objects hold exactly one, so this is the ordinary
    // museum rather than an edge. Asserted beside the 122 case on purpose: a
    // hardcoded noun satisfies one of the two, so the pair is what holds the count.
    render(<ObjectContext item={item({ offered_locations: 1, counted_works_total: 1 })} />);

    expect(screen.getByText(/holds 1 famous work/)).toBeInTheDocument();
    expect(screen.queryByText(/famous works/)).not.toBeInTheDocument();
  });

  it('says nothing about the shape of a single place holding nothing', () => {
    // Most objects are exactly this. A line that reads "made of 1 place" on
    // all of them is one a curator learns to skip before meeting the one that counts.
    render(<ObjectContext item={item({ offered_locations: 1, counted_works_total: 0 })} />);

    expect(screen.queryByText(/made of/)).not.toBeInTheDocument();
    expect(screen.queryByText(/holds/)).not.toBeInTheDocument();
  });

  it('names whoever took the photograph it is showing', () => {
    // A curator's screen is the catalogue being worked on rather than published,
    // which changes nothing about the licence — and it answers a question only
    // this screen raises: somebody deciding whether to replace a picture needs
    // to know whose it is.
    render(<ObjectContext item={item({
      image_url: 'http://commons.wikimedia.org/wiki/Special:FilePath/Mesha%20stele.jpg',
      image_credit: {
        author: 'Mbzt',
        license: 'CC BY-SA 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
        detailsUrl: 'https://commons.wikimedia.org/wiki/File:Mesha_stele.jpg',
      },
    })} />);

    expect(screen.getByRole('link', { name: 'Mbzt' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CC BY-SA 4.0' })).toBeInTheDocument();
  });

  it('takes the credit away with a picture that did not arrive', () => {
    // Not an edge case on this screen: most of what the queue holds is UNESCO,
    // whose URLs largely answered 403 before ADR-0043 (#557), which reached it as an
    // image error. A photographer named under a broken frame is the one claim
    // the credit feature exists to avoid making.
    render(<ObjectContext item={item({
      image_url: 'http://commons.wikimedia.org/wiki/Special:FilePath/Mesha%20stele.jpg',
      // Something other than the picture, so the card is still on screen after the
      // failure: without it `ObjectContext` renders nothing at all and the assertion
      // would hold even if the credit's own guard were removed.
      region_names: ['Tigray'],
      image_credit: {
        author: 'Mbzt',
        license: 'CC BY-SA 4.0',
        licenseUrl: null,
        detailsUrl: 'https://commons.wikimedia.org/wiki/File:Mesha_stele.jpg',
      },
    })} />);
    expect(screen.getByRole('link', { name: 'Mbzt' })).toBeInTheDocument();

    fireEvent.error(screen.getByRole('button', { name: /enlarge the picture/ }).querySelector('img')!);

    expect(screen.queryByRole('link', { name: 'Mbzt' })).not.toBeInTheDocument();
    expect(screen.getByText('Tigray')).toBeInTheDocument();
  });

  it('does not carry one object\'s failed picture onto the next', () => {
    // The bench draws one card at a time with no key, so a new `item` reconciles
    // into the same instance. Held as a flag, a single 403 would blank every
    // object after it — a photoless card for a picture that is there.
    const broken = item({
      external_id: '1', name: 'Aksum',
      image_url: 'http://commons.wikimedia.org/wiki/Special:FilePath/Broken.jpg',
      region_names: ['Tigray'],
      image_credit: {
        author: 'Mbzt', license: 'CC BY-SA 4.0', licenseUrl: null,
        detailsUrl: 'https://commons.wikimedia.org/wiki/File:Broken.jpg',
      },
    });
    const { rerender } = render(<ObjectContext item={broken} />);
    fireEvent.error(screen.getByRole('button', { name: /enlarge the picture/ }).querySelector('img')!);
    expect(screen.queryByRole('link', { name: 'Mbzt' })).not.toBeInTheDocument();

    rerender(<ObjectContext item={item({
      external_id: '2', name: 'Stonehenge',
      image_url: 'http://commons.wikimedia.org/wiki/Special:FilePath/Stonehenge.jpg',
      region_names: ['Wiltshire'],
      image_credit: {
        author: 'Stefan Kühn', license: 'CC BY-SA 3.0', licenseUrl: null,
        detailsUrl: 'https://commons.wikimedia.org/wiki/File:Stonehenge.jpg',
      },
    })} />);

    expect(screen.getByRole('button', { name: /Stonehenge — enlarge the picture/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Stefan Kühn' })).toBeInTheDocument();
  });

  it('credits nobody where it is drawing no picture', () => {
    // A row whose `image_url` is a local path draws no thumbnail here, and a
    // photographer named under no photograph is credited for nothing.
    render(<ObjectContext item={item({
      image_url: '/images/unesco/15.jpg',
      region_names: ['Tigray'],
      image_credit: { author: 'Mbzt', license: 'CC BY-SA 4.0', licenseUrl: null, detailsUrl: null },
    })} />);

    expect(screen.queryByText(/Mbzt/)).not.toBeInTheDocument();
  });

  it('does not print a coordinate for an object that has no point', () => {
    // `latitude` absent is not `0`: the equator is a real place, and a card that read a
    // missing point as "0.0000, 0.0000" would send a curator to the Gulf of Guinea.
    render(<ObjectContext item={item({ region_names: ['Europe'] })} />);

    expect(screen.queryByText(/0\.0000/)).not.toBeInTheDocument();
  });
});
