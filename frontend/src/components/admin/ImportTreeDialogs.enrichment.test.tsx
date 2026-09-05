/**
 * The enrichment row of the suggest-children dialog: what the model answered,
 * shown to the admin who is about to approve it.
 *
 * The Wikidata id there is the model's own `wikidataQID`, held by the schema to a
 * string of at most 100 characters and nothing more, and approving the action
 * stores it (`region_import_state.source_external_id`). So the row has two duties
 * that pull apart: link the id only when it *is* a Wikidata item, and show it
 * whatever it is — a malformed answer is the one the admin most needs to see
 * before it is written.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReviewChildAction } from '../../api/admin/worldViewImport';
import { AISuggestChildrenDialog } from './ImportTreeDialogs';

function renderDialog(actions: ReviewChildAction[]) {
  render(
    <AISuggestChildrenDialog
      state={{
        regionId: 1,
        regionName: 'Occitanie',
        result: { actions, analysis: '', stats: null },
        selected: new Set<string>(),
      }}
      onClose={vi.fn()}
      onToggle={vi.fn()}
      onSubmit={vi.fn()}
      isPending={false}
    />,
  );
}

const enrich = (name: string, sourceExternalId: string | null): ReviewChildAction => ({
  type: 'enrich', name, reason: 'matched on Wikidata', sourceUrl: null, sourceExternalId, verified: true,
});

describe('the enrichment row of the suggest-children dialog', () => {
  it('links an id that is a Wikidata item to that item', () => {
    renderDialog([enrich('Eesti Rahva Muuseum', 'Q1370397')]);

    expect(screen.getByRole('link', { name: 'Q1370397' }))
      .toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q1370397');
  });

  it('shows an id that is not one as text, linked nowhere', () => {
    // Approving stores this value, so hiding it would hide exactly the answer
    // the admin needs to catch; linking it would open a page that does not exist.
    renderDialog([enrich('Somewhere', 'unknown'), enrich('Elsewhere', 'Q42 (Douglas Adams)')]);

    expect(screen.getByText('unknown')).toBeInTheDocument();
    expect(screen.getByText('Q42 (Douglas Adams)')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
