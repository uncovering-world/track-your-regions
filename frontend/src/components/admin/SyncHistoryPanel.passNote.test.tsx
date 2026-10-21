/**
 * Tests for the line the run history gives a run of a pass's later source
 * (ADR-0132): it names the pass's first run, whose gather it read, and a run
 * that shared no gather carries no line.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PassNote } from './SyncHistoryPanel';

describe('PassNote', () => {
  it('names the first run of the pass and its source', () => {
    render(<PassNote log={{ pass_log_id: 181, pass_source_name: 'Monuments & memorials' }} />);

    expect(screen.getByText('One pass with the Monuments & memorials run #181, from its gather')).toBeInTheDocument();
  });

  it('says nothing of a run that shared no gather', () => {
    const { container } = render(<PassNote log={{ pass_log_id: null, pass_source_name: null }} />);

    expect(container).toBeEmptyDOMElement();
  });
});
