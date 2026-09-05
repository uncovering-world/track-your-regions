/**
 * Tests for the id a source knows an object by.
 *
 * The chip used to copy the id and do nothing else, which left a curator holding
 * `Q1662392` with nowhere to take it. What is worth pinning is where each kind of
 * id now opens — the item for a Wikidata id, the source's own page for a World
 * Heritage number — and that an id nothing names keeps the copy affordance
 * rather than gaining a link to nowhere.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SourceId, sourceIdHref } from './SourceId';

describe('sourceIdHref', () => {
  it('opens the item for a Wikidata id, whatever the source page is', () => {
    // The Louvre's website is the museum's own, not a page about the id.
    expect(sourceIdHref('Q19675', 'https://www.louvre.fr/zh-hans'))
      .toBe('https://www.wikidata.org/wiki/Q19675');
    expect(sourceIdHref('Q19675', null)).toBe('https://www.wikidata.org/wiki/Q19675');
  });

  it('opens the source page for an id that page names', () => {
    // Every World Heritage row: the Centre's id, and the portal page of that id.
    expect(sourceIdHref('738', 'https://whc.unesco.org/en/list/738'))
      .toBe('https://whc.unesco.org/en/list/738');
    expect(sourceIdHref('738', 'https://whc.unesco.org/en/list/738/'))
      .toBe('https://whc.unesco.org/en/list/738/');
  });

  it('opens nothing for an id the source page does not name', () => {
    // A path segment, not a substring: the page of site 7380 is not the page of 738.
    expect(sourceIdHref('738', 'https://whc.unesco.org/en/list/7380')).toBeNull();
    // A page that is about the object but not about the id is the object's own
    // site, and the chip says how the *source* knows the object.
    expect(sourceIdHref('738', 'https://example.org/about')).toBeNull();
    expect(sourceIdHref('738', null)).toBeNull();
    expect(sourceIdHref('738', undefined)).toBeNull();
  });

  it('refuses a source page that is not a safe link', () => {
    expect(sourceIdHref('738', 'javascript:alert(738)')).toBeNull();
    expect(sourceIdHref('738', '/en/list/738')).toBeNull();
  });
});

describe('SourceId', () => {
  it('links a Wikidata id to its item, with the id to copy beside it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<SourceId id="Q1662392" category="Top Art Museums" sourcePage="https://www.peramuseum.org" />);

    const link = screen.getByRole('link', { name: 'Q1662392' });
    expect(link).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q1662392');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    fireEvent.click(screen.getByRole('button', { name: 'Copy Q1662392' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Q1662392'));
  });

  it('links a World Heritage id to its portal page', () => {
    render(<SourceId id="738" category="UNESCO World Heritage Sites" sourcePage="https://whc.unesco.org/en/list/738" />);

    expect(screen.getByRole('link', { name: '738' }))
      .toHaveAttribute('href', 'https://whc.unesco.org/en/list/738');
    expect(screen.getByRole('button', { name: 'Copy 738' })).toBeInTheDocument();
  });

  it('keeps an id nothing names as the thing to copy, and links it nowhere', () => {
    render(<SourceId id="manual-12" category="Top Art Museums" />);

    expect(screen.queryByRole('link')).toBeNull();
    // The id itself is the copy control, as it was before the chip could open anything.
    expect(screen.getByRole('button', { name: 'manual-12' })).toBeInTheDocument();
  });
});
