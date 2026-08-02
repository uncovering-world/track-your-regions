/**
 * Tests for how the run card explains a missing per-object record.
 *
 * "No changeset" has three causes with three different meanings, and the card
 * used to conflate them: an initial sync (creates, no updates) showed a
 * non-zero Created tile over "No changes recorded for this run", while a run
 * whose changeset write failed minutes ago was labelled as predating the
 * feature entirely.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { changesetNote } from './SyncHistoryPanel';
import type { SyncLog } from '../../api/admin';

function log(overrides: Partial<SyncLog> & { error_details?: unknown[] } = {}) {
  return {
    id: 1,
    category_id: 1,
    category_name: 'UNESCO World Heritage Sites',
    started_at: '2026-07-26T14:00:00Z',
    completed_at: '2026-07-26T14:03:59Z',
    status: 'partial',
    total_fetched: 1248,
    total_created: 0,
    total_updated: 0,
    total_unchanged: 0,
    total_missing: 0,
    total_curated_conflicts: 0,
    total_errors: 0,
    is_dry_run: false,
    detection_skipped_reason: null,
    has_changeset: false,
    triggered_by: null,
    triggered_by_name: null,
    ...overrides,
  } as SyncLog & { error_details?: unknown[] };
}

describe('changesetNote', () => {
  it('says nothing when the run kept a record', () => {
    expect(changesetNote(log({ has_changeset: true, total_created: 12 }))).toBeNull();
  });

  it('says nothing when there was genuinely nothing to record', () => {
    // Every row came through unchanged: "No changes recorded" is accurate
    expect(changesetNote(log({ total_unchanged: 1247 }))).toBeNull();
  });

  it('explains an initial sync that created rows but kept no record', () => {
    // The first run of every category: created 1247, updated 0. Gating on
    // total_updated left this one showing "Created: 1,247" above
    // "No changes recorded for this run" with nothing to explain it.
    render(<>{changesetNote(log({ total_created: 1247 }))}</>);

    expect(screen.getByText(/predates change provenance/i)).toBeInTheDocument();
    expect(screen.queryByText(/not comparable/i)).not.toBeInTheDocument();
  });

  it('adds the comparability note only when the old counter is non-zero', () => {
    render(<>{changesetNote(log({ total_created: 32, total_updated: 68 }))}</>);

    expect(screen.getByText(/predates change provenance/i)).toBeInTheDocument();
    expect(screen.getByText(/not comparable/i)).toBeInTheDocument();
  });

  it('calls a failed changeset write what it is, not an old run', () => {
    render(<>{changesetNote(log({
      total_updated: 5,
      error_details: [{ externalId: 'changeset', error: 'value too long' }],
    }))}</>);

    expect(screen.getByText(/could not be written/i)).toBeInTheDocument();
    expect(screen.queryByText(/predates change provenance/i)).not.toBeInTheDocument();
  });
});
