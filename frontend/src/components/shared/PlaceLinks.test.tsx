/**
 * A place's pages, in words a visitor reads without hovering (#1190).
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlaceLinks } from './PlaceLinks';

describe('PlaceLinks', () => {
  it("names St Bavo's Cathedral's two pages in words", () => {
    render(<PlaceLinks metadata={{
      wikipediaUrl: 'https://en.wikipedia.org/wiki/St_Bavo%27s_Cathedral', website: 'https://www.sintbaafskathedraal.be/',
    }} />);

    expect(screen.getByRole('link', { name: 'Wikipedia' })).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/St_Bavo%27s_Cathedral');
    expect(screen.getByRole('link', { name: 'Official website' })).toHaveAttribute('href', 'https://www.sintbaafskathedraal.be/');
    expect(screen.queryByRole('link', { name: 'UNESCO page' })).toBeNull();
  });

  it("offers a World Heritage site's UNESCO page, and not its site again where that is the same page", () => {
    const unesco = 'https://whc.unesco.org/en/list/943';
    render(<PlaceLinks metadata={{ unescoUrl: unesco, website: unesco }} />);

    expect(screen.getByRole('link', { name: 'UNESCO page' })).toHaveAttribute('href', unesco);
    expect(screen.queryByRole('link', { name: 'Official website' })).toBeNull();
  });

  it("offers no website that is a World Heritage Centre page under another scheme (#1851)", () => {
    // Gelati Monastery: Wikidata's website is its UNESCO page over http.
    render(<PlaceLinks metadata={{ website: 'http://whc.unesco.org/en/list/710', unescoUrl: 'https://whc.unesco.org/en/list/710' }} />);
    expect(screen.queryByRole('link', { name: 'Official website' })).toBeNull();
    expect(screen.getByRole('link', { name: 'UNESCO page' })).toHaveAttribute('href', 'https://whc.unesco.org/en/list/710');
  });

  it('offers nothing for an address the rule refuses', () => {
    render(<PlaceLinks metadata={{ website: 'javascript:alert(1)' }} />);

    expect(screen.queryByRole('link')).toBeNull();
  });
});
