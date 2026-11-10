/**
 * The line the run history gives the copies a run read (#2415): how many,
 * with each copy's dump date on hover, and nothing for a run from before.
 */

import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CopiesReadNote } from './SyncHistoryPanel';

describe('CopiesReadNote', () => {
  it('says how many copies the run read, and each copy with its dump date on hover', async () => {
    render(<CopiesReadNote log={{
      copies_read: [
        { dump: 'wikidata-entities', title: 'The local Wikidata subset', dumpDate: '2026-10-26', datedBy: 'day' },
        { dump: 'pageviews-user', title: 'Readership over the last twelve months', dumpDate: '2026-09-01', datedBy: 'month' },
      ],
    }} />);

    const line = screen.getByText('Read 2 copies of the public dumps');
    fireEvent.mouseOver(line);
    expect(await screen.findByText('The local Wikidata subset: 26 Oct 2026')).toBeInTheDocument();
    expect(screen.getByText('Readership over the last twelve months: Sept 2026')).toBeInTheDocument();
  });

  it('says one copy, not one copies', () => {
    render(<CopiesReadNote log={{ copies_read: [{ dump: 'wikidata-entities', title: 'The local Wikidata subset', dumpDate: '2026-10-26', datedBy: 'day' }] }} />);

    expect(screen.getByText('Read one copy of the public dumps')).toBeInTheDocument();
  });

  it('says nothing of a run from before the copies were named', () => {
    const { container } = render(<CopiesReadNote log={{ copies_read: null }} />);

    expect(container).toBeEmptyDOMElement();
  });
});
