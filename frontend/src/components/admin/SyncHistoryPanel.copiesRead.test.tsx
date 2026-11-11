/**
 * The line the run history gives the copies a run read (#2415): how many,
 * with each copy's dump date on hover, and nothing for a run from before.
 */

import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CopiesReadNote, foldWords } from './SyncHistoryPanel';

describe('CopiesReadNote', () => {
  it('says how many copies the run read, and each copy with its dump date on hover', async () => {
    render(<CopiesReadNote log={{
      copies_read: [
        { dump: 'wikidata-entities', title: 'The local Wikidata subset', dumpDate: '2026-10-26', revision: null, datedBy: 'day' },
        { dump: 'pageviews-user', title: 'Readership over the last twelve months', dumpDate: '2026-09-01', revision: '59@2026-10-01×12', datedBy: 'month' },
      ],
    }} />);

    const line = screen.getByText('Read 2 copies of the public dumps');
    fireEvent.mouseOver(line);
    expect(await screen.findByText('The local Wikidata subset: 26 Oct 2026')).toBeInTheDocument();
    expect(screen.getByText('Readership over the last twelve months: Sept 2026, folded with the redirects of 1 Oct 2026')).toBeInTheDocument();
  });

  it('says one copy, not one copies', () => {
    render(<CopiesReadNote log={{ copies_read: [{ dump: 'wikidata-entities', title: 'The local Wikidata subset', dumpDate: '2026-10-26', revision: null, datedBy: 'day' }] }} />);

    expect(screen.getByText('Read one copy of the public dumps')).toBeInTheDocument();
  });

  it('says nothing of a run from before the copies were named', () => {
    const { container } = render(<CopiesReadNote log={{ copies_read: null }} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('tells a run halfway through a refold from one before it and one after it', () => {
    expect(foldWords('59@2026-10-01×12')).toBe(', folded with the redirects of 1 Oct 2026');
    expect(foldWords('59@2026-10-01×8,64@2026-11-01×4')).toBe(', folded with the redirects of 1 Oct 2026 (8 months) and 1 Nov 2026 (4)');
    expect(foldWords('64@2026-11-01×12')).toBe(', folded with the redirects of 1 Nov 2026');
    expect(foldWords(null)).toBe('');
  });
});
