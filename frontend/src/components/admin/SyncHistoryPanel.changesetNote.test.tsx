/**
 * Tests for how the run card explains a per-object record that is missing or
 * short.
 *
 * A missing changeset has three causes with three different meanings, and the
 * card used to conflate them: an initial sync (creates, no updates) showed a
 * non-zero Created tile over "No changes recorded for this run", while a run
 * whose changeset write failed minutes ago was labelled as predating the
 * feature entirely. The fourth case is a record that is there and short — the
 * insert goes in batches with no transaction around them, so part of a run's
 * changeset can land under the same lost-changeset marker — which
 * `has_changeset` alone cannot tell from a whole one, and which the card once
 * drew with no note at all. The marker is the evidence in every case it is
 * present, ahead of `has_changeset` and of the counters (#523).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { changesetNote } from './SyncHistoryPanel';
import type { SyncLog } from '../../api/admin';

function log(overrides: Partial<SyncLog> = {}) {
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
    total_held: 0,
    total_filtered: 0,
    total_errors: 0,
    is_dry_run: false,
    detection_skipped_reason: null,
    has_changeset: false,
    changeset_lost: false,
    triggered_by: null,
    triggered_by_name: null,
    ...overrides,
  } as SyncLog;
}

describe('changesetNote', () => {
  it('says nothing when the run kept a record', () => {
    expect(changesetNote(log({ has_changeset: true, total_created: 12 }))).toBeNull();
  });

  it('says the record is short when part of it landed', () => {
    // The insert goes in batches of 500 with no transaction around them: a
    // failure on the third batch of run 68's 1272 rows leaves a thousand
    // committed, so `has_changeset` is true and the marker is stamped anyway.
    // Read off `has_changeset` alone, the dialog drew that list with no note
    // beside a Held tile saying 1,272.
    render(<>{changesetNote(log({
      has_changeset: true,
      total_held: 1272,
      changeset_lost: true,
    }))}</>);

    expect(screen.getByText(/could not be written in full/i)).toBeInTheDocument();
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
      changeset_lost: true,
    }))}</>);

    expect(screen.getByText(/could not be written/i)).toBeInTheDocument();
    expect(screen.queryByText(/predates change provenance/i)).not.toBeInTheDocument();
  });

  it('calls a lost changeset what it is on a run that only held', () => {
    // Run 68's shape with its insert failed: nothing created, changed or
    // missing, 1272 held. Gating on the three older counters read that as
    // "nothing happened" under a Held tile saying 1,272.
    render(<>{changesetNote(log({
      total_held: 1272,
      changeset_lost: true,
    }))}</>);

    expect(screen.getByText(/could not be written/i)).toBeInTheDocument();
  });

  it('believes the marker over the counters when every counter reads 0', () => {
    // A gated run from before migration 038 that held every row and lost its
    // record: the migration leaves marker runs unfilled, so Held reads 0 with
    // the rest. The marker is only ever stamped when records existed and did
    // not land, so it is the evidence, and the counters are not.
    render(<>{changesetNote(log({
      total_unchanged: 1272,
      changeset_lost: true,
    }))}</>);

    expect(screen.getByText(/could not be written/i)).toBeInTheDocument();
  });

  it('counts a refused claim as something that happened, too', () => {
    // The same gap for the other refusal: a run whose only events were three
    // curated conflicts, and whose record of them was lost.
    render(<>{changesetNote(log({
      total_curated_conflicts: 3,
      changeset_lost: true,
    }))}</>);

    expect(screen.getByText(/could not be written/i)).toBeInTheDocument();
  });
});
