/**
 * The picker draws every candidate a region's import carried, and each goes
 * through `toThumbnailUrl` rather than into `src={`${url}?width=300`}` raw
 * (#694). A candidate is wiki content, not an admin's own typing, so the
 * picker is the surface where an unrenderable value would meet the DOM first;
 * one `toThumbnailUrl` refuses is not offered at all -- a picture no `<img>`
 * may draw is not a map to choose.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MapImagePickerDialog } from './MapImagePickerDialog';

const COMMONS_MAP = 'https://commons.wikimedia.org/wiki/Special:FilePath/Algeria_regions_map.png';

function renderPicker(candidates: string[], currentSelection: string | null = null) {
  render(
    <MapImagePickerDialog
      open
      regionName="Algeria"
      candidates={candidates}
      currentSelection={currentSelection}
      onSelect={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

/** What the picker put into every `<img>` it drew -- the dialog renders into a portal, so the document is asked. */
const drawnSrcs = () => Array.from(document.querySelectorAll('img')).map(img => img.getAttribute('src'));

describe('MapImagePickerDialog', () => {
  it('sizes a Commons map through the shared thumbnail rule', () => {
    renderPicker([COMMONS_MAP]);
    expect(drawnSrcs()).toEqual([`${COMMONS_MAP}?width=300`]);
  });

  it('offers no candidate that no <img> may draw', () => {
    renderPicker([
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '//evil.example.com/map.png',
      'https://evil.example.com/map.png',
      COMMONS_MAP,
    ]);
    expect(drawnSrcs()).toEqual([`${COMMONS_MAP}?width=300`]);
    expect(screen.getByText(/1 candidate$/)).toBeInTheDocument();
  });

  it('says so when nothing it was given can be drawn', () => {
    renderPicker(['javascript:alert(1)']);
    expect(drawnSrcs()).toEqual([]);
    expect(screen.getByText('No valid images found.')).toBeInTheDocument();
  });

  it('will not confirm a current selection it refused to draw', () => {
    // The region's stored map seeds the selection. Stored before the rule, it
    // may be a value the picker now hides -- and a hidden value must not be
    // re-posted as a pick just because it was the selection on the way in.
    renderPicker(['javascript:alert(1)', COMMONS_MAP], 'javascript:alert(1)');
    expect(screen.getByRole('button', { name: 'Confirm Selection' })).toBeDisabled();
  });

  it('confirms a current selection it does draw', () => {
    renderPicker([COMMONS_MAP], COMMONS_MAP);
    expect(screen.getByRole('button', { name: 'Confirm Selection' })).toBeEnabled();
  });
});
