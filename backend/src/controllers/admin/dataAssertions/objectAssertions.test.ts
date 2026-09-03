/**
 * The object rules ask the product's own question about a row, and every term
 * a composite carries is pinned here against the fragment it must come from
 * rather than against a string spelled a second time — a test that repeats
 * the literal passes when both copies drift together.
 */
import { describe, it, expect } from 'vitest';
import { heldFieldAnsweredSql, heldFieldRefusedSql } from '../../experience/heldDecisions.js';
import { iconicPinnedSql } from '../../../services/sync/admission.js';
import { objectAssertions } from './objectAssertions.js';

const byId = (id: string) => {
  const assertion = objectAssertions.find(a => a.id === id);
  if (!assertion) throw new Error(`no assertion ${id}`);
  return assertion;
};
const collapse = (sql: string) => sql.replace(/\s+/g, ' ');

describe('the object assertions', () => {
  it('all live in the objects area, with a title and a meaning', () => {
    for (const a of objectAssertions) {
      expect(a.area).toBe('objects');
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.meaning.length).toBeGreaterThan(0);
    }
  });
});

describe('the danger flag against its tag', () => {
  const assertion = byId('danger-flag-disagrees-with-its-tag');
  const sql = collapse(assertion.sql);

  it('reads a null tag column as no tag, rather than dropping the row', () => {
    // `tags` is nullable and reachable as null -- `createManualExperience`
    // writes NULL for an object created with none -- and `NULL ? 'in_danger'`
    // is NULL, so `NULL <> FALSE` is neither true nor false and Postgres drops
    // the row. That would lose the direction this rule calls the worse one: a
    // hand-made object flagged in danger with nothing tagging it. Measured
    // against the live catalogue with one such row inserted in a transaction:
    // uncoalesced finds nothing, this finds it.
    expect(sql).toContain("COALESCE(e.tags ? 'in_danger', FALSE) <> COALESCE(e.metadata->'inDanger' = 'true'::jsonb, FALSE)");
  });

  it('asks the two stored columns, not UNESCO\'s own field', () => {
    // A rule about this catalogue's two copies of one fact. Re-reading
    // `dangerList` here would make the assertion a second copy of the
    // importer's reading, which is the copy that would rot.
    expect(sql).toContain("e.tags ? 'in_danger'");
    // And not while the flag itself is held: under a gate the run writes the tag
    // past it and holds the flag, so the two are apart by design until the card
    // is published (#570). The held *flag*, not the held row -- any held field
    // sets the pointer, and every UNESCO row on the dev database carries one
    // (criteria and a credit held on all 1272), so a bare pointer test would
    // switch the check off for the whole category. The flag is named on its
    // own, never inside the `metadata` catch-all, so only its own name is asked.
    expect(sql).toContain("AND ch.sync_log_id = e.pending_change_sync_log_id");
    expect(sql).toContain("AND (f->>'held')::boolean");
    expect(sql).toContain("AND f->>'field' = 'metadata.inDanger')");
    expect(sql).not.toContain("'metadata')");
    expect(sql).not.toContain('AND e.pending_change_sync_log_id IS NULL');
    // Excused on *any* answer, which is where this parts company with the credit
    // check one assertion over (#722): a published flag is a flag that landed, so
    // the two halves agree and there is nothing left to reconcile. A published
    // credit is not — see `heldFieldRefusedSql`.
    expect(sql).toContain(collapse(heldFieldAnsweredSql('e.id')));
    expect(sql).not.toContain(collapse(heldFieldRefusedSql('e.id')));
    expect(sql).toContain("e.metadata->'inDanger' = 'true'::jsonb");
  });

  it('catches the disagreement whichever half is missing', () => {
    // Tagged and not flagged is the shape 035 repaired; flagged and not tagged
    // is a badge on a site nothing lists, and a one-sided test would report the
    // catalogue clean while a traveller is told a place is in peril.
    expect(sql).toMatch(/<>/);
    expect(assertion.describe({
      experience_id: 21, experience_name: 'Ancient City of Aleppo',
      tagged: true, flagged: false, listing: 'Y 2013',
    })).toBe('Ancient City of Aleppo: tagged as in danger since 2013, with no badge on it '
      + '(experience 21)');
    expect(assertion.describe({
      experience_id: 764, experience_name: 'Belize Barrier Reef Reserve System',
      tagged: false, flagged: true, listing: null,
    })).toBe('Belize Barrier Reef Reserve System: badged as in danger with nothing in the '
      + 'catalogue listing it (experience 764)');
  });

  it('says the year only where the listing carries one', () => {
    expect(assertion.describe({
      experience_id: 1, experience_name: 'A site', tagged: true, flagged: false, listing: null,
    })).toBe('A site: tagged as in danger, with no badge on it (experience 1)');
  });
});

describe('a refused row still wearing the Iconic badge', () => {
  const assertion = byId('refused-row-wearing-iconic');
  const sql = collapse(assertion.sql);

  it('asks the admission axis and the flag together, on the row itself', () => {
    // Both are columns of `experiences`, written by the same refusal paths, so
    // the question is whether one moved without the other (#760). The flag as
    // stored is what a read of it on its own -- the Iconic filter, an export --
    // would hand a reader, so it is the stored value that is asked, not a
    // reader composite.
    expect(sql).toContain("WHERE e.admission = 'refused' AND e.is_iconic");
    expect(assertion.kind).toBe('invariant');
  });

  it('leaves alone the one row the writers leave alone: a flag a curator pinned', () => {
    // The refusal writes keep a pinned flag (`CLEAR_ICONIC`), so a pinned
    // refused row is the badge kept on purpose rather than a defect. The guard
    // is the writers' own, imported, so the two cannot drift apart.
    expect(sql).toContain(`AND NOT ${iconicPinnedSql('e')}`);
  });

  it('names the row and the category that turned it away', () => {
    expect(assertion.describe({
      experience_id: 6205, experience_name: 'British Museum', category_name: 'Top Art Museums',
    })).toBe('British Museum: turned away from Top Art Museums and still badged as a must-see '
      + '(experience 6205)');
  });

  it('sends the admin to the migration for the rows refused before the writers cleared the flag', () => {
    expect(assertion.meaning).toContain('042');
  });
});
