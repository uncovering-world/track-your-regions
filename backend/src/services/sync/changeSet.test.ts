/**
 * Tests for the sync change-set diff.
 *
 * The diff decides what a run reports, so its false positives are expensive:
 * a JSONB key reordering or a 3-metre coordinate jitter must not be announced
 * as a change to 1247 objects.
 */

import { describe, it, expect } from 'vitest';
import {
  computeChangeSet, CURATED_KEY_BY_FIELD, METADATA_CLAIM_PREFIX, type ExperienceSnapshot,
} from './changeSet.js';

function snapshot(overrides: Partial<ExperienceSnapshot> = {}): ExperienceSnapshot {
  return {
    name: 'Serengeti National Park',
    nameLocal: { en: 'Serengeti National Park', fr: 'Parc national du Serengeti' },
    description: null,
    shortDescription: 'Vast plains of the Serengeti.',
    category: 'natural',
    tags: ['natural', 'unesco'],
    lon: 34.8333,
    lat: -2.3333,
    countryCodes: ['TZ'],
    countryNames: ['Tanzania'],
    imageUrl: 'https://whc.unesco.org/uploads/sites/site_156.jpg',
    metadata: { inDanger: false, dateInscribed: 1981, areaHectares: 1476300 },
    ...overrides,
  };
}

describe('computeChangeSet', () => {
  it('reports created when there is no prior row', () => {
    const result = computeChangeSet(null, snapshot(), []);

    expect(result.changeType).toBe('created');
    expect(result.changedFields).toEqual([]);
    expect(result.significance).toBeNull();
  });

  it('reports unchanged when nothing differs', () => {
    const result = computeChangeSet(snapshot(), snapshot(), []);

    expect(result.changeType).toBe('unchanged');
    expect(result.changedFields).toEqual([]);
    expect(result.significance).toBeNull();
  });

  it('ignores JSONB key order', () => {
    const before = snapshot({ metadata: { inDanger: false, dateInscribed: 1981, areaHectares: 1476300 } });
    const incoming = snapshot({ metadata: { areaHectares: 1476300, dateInscribed: 1981, inDanger: false } });

    expect(computeChangeSet(before, incoming, []).changeType).toBe('unchanged');
  });

  it('treats country arrays as sets, not sequences', () => {
    const before = snapshot({ countryCodes: ['FR', 'ES'], countryNames: ['France', 'Spain'] });
    const incoming = snapshot({ countryCodes: ['ES', 'FR'], countryNames: ['Spain', 'France'] });

    expect(computeChangeSet(before, incoming, []).changeType).toBe('unchanged');
  });

  it('treats null, empty string and missing text as the same absence', () => {
    const before = snapshot({ description: null });
    const incoming = snapshot({ description: '' });

    expect(computeChangeSet(before, incoming, []).changeType).toBe('unchanged');
  });

  it('ignores coordinate jitter below the threshold', () => {
    // ~5 m north of the original point
    const incoming = snapshot({ lat: -2.3333 + 0.000045 });

    expect(computeChangeSet(snapshot(), incoming, []).changeType).toBe('unchanged');
  });

  it('reports a moderate coordinate shift as minor', () => {
    // ~500 m east
    const incoming = snapshot({ lon: 34.8333 + 0.0045 });
    const result = computeChangeSet(snapshot(), incoming, []);

    expect(result.changeType).toBe('updated');
    expect(result.changedFields.map(f => f.field)).toEqual(['location']);
    expect(result.significance).toBe('minor');
  });

  it('reports a kilometre-scale coordinate shift as major', () => {
    // ~5 km east
    const incoming = snapshot({ lon: 34.8333 + 0.045 });
    const result = computeChangeSet(snapshot(), incoming, []);

    expect(result.significance).toBe('major');
  });

  it('reports a description rewrite as minor', () => {
    const incoming = snapshot({ shortDescription: 'A completely rewritten summary.' });
    const result = computeChangeSet(snapshot(), incoming, []);

    expect(result.changeType).toBe('updated');
    expect(result.significance).toBe('minor');
    expect(result.changedFields[0]).toMatchObject({ field: 'shortDescription', significance: 'minor' });
  });

  it('reports a danger-list entry as a major metadata change', () => {
    const incoming = snapshot({ metadata: { inDanger: true, dateInscribed: 1981, areaHectares: 1476300 } });
    const result = computeChangeSet(snapshot(), incoming, []);

    expect(result.significance).toBe('major');
    expect(result.changedFields).toContainEqual({
      field: 'metadata.inDanger',
      old: false,
      new: true,
      significance: 'major',
      curatedConflict: false,
    });
  });

  it('reports unremarkable metadata edits as one minor change', () => {
    const incoming = snapshot({ metadata: { inDanger: false, dateInscribed: 1981, areaHectares: 1476999 } });
    const result = computeChangeSet(snapshot(), incoming, []);

    expect(result.significance).toBe('minor');
    expect(result.changedFields.map(f => f.field)).toEqual(['metadata']);

    // The catch-all's payload is stripped of the major keys too, not only a
    // claimed one: `inDanger`/`dateInscribed` get their own entry whenever
    // they change, so carrying them here as well -- unchanged, in this
    // fixture -- would put the same value in two rows, one of them
    // mislabelled as something this run "applied" alongside areaHectares.
    expect(result.changedFields[0].old).toEqual({ areaHectares: 1476300 });
    expect(result.changedFields[0].new).toEqual({ areaHectares: 1476999 });
  });

  it('records a curated field as a conflict and not as an applied change', () => {
    const incoming = snapshot({ name: 'Serengeti NP (renamed upstream)' });
    const result = computeChangeSet(snapshot(), incoming, ['name']);

    expect(result.changeType).toBe('unchanged');
    expect(result.changedFields).toEqual([]);
    expect(result.curatedConflicts).toEqual([{
      field: 'name',
      old: 'Serengeti National Park',
      new: 'Serengeti NP (renamed upstream)',
      significance: 'major',
      curatedConflict: true,
    }]);
  });

  it('still reports unprotected fields when another field is curated', () => {
    const incoming = snapshot({
      name: 'Serengeti NP (renamed upstream)',
      shortDescription: 'New summary.',
    });
    const result = computeChangeSet(snapshot(), incoming, ['name']);

    expect(result.changeType).toBe('updated');
    expect(result.changedFields.map(f => f.field)).toEqual(['shortDescription']);
    expect(result.curatedConflicts).toHaveLength(1);
  });

  it('keeps a major curated conflict visible when a routine edit rides along', () => {
    const incoming = snapshot({
      name: 'Serengeti NP (renamed upstream)',
      shortDescription: 'New summary.',
    });
    const result = computeChangeSet(snapshot(), incoming, ['name']);

    // The applied half is minor; the refused half is the part needing a
    // decision, and filing the row as minor would hide it from the default view
    expect(result.changeType).toBe('updated');
    expect(result.significance).toBe('major');
  });

  it('escalates the row to major when any field is major', () => {
    const incoming = snapshot({ name: 'Renamed', shortDescription: 'New summary.' });
    const result = computeChangeSet(snapshot(), incoming, []);

    expect(result.significance).toBe('major');
  });
});

describe('a metadata key claimed per key', () => {
  const before = snapshot({ metadata: { website: 'https://curator.example', artworkCount: 5 } });
  const incoming = snapshot({ metadata: { website: 'https://source.example', artworkCount: 9 } });

  it('reports the claimed key as a conflict, not as an applied change', () => {
    const result = computeChangeSet(before, incoming, ['metadata.website']);

    const conflictFields = result.curatedConflicts.map(c => c.field);
    expect(conflictFields).toContain('metadata.website');
    expect(result.changedFields.map(c => c.field)).not.toContain('metadata.website');
  });

  it('still reports the unclaimed keys as applied, because the run applied them', () => {
    const result = computeChangeSet(before, incoming, ['metadata.website']);

    // Exactly one applied field, named 'metadata', and exactly one conflict —
    // not just "changedFields contains 'metadata' somewhere", which would
    // hold even if the claimed key leaked into the same catch-all entry.
    expect(result.changedFields.map(c => c.field)).toEqual(['metadata']);
    expect(result.curatedConflicts).toHaveLength(1);
    expect(result.changeType).toBe('updated');

    // The applied row's own payload must not carry the value that was not
    // applied — only what this run actually wrote lives in the row labelled
    // applied (#488, one layer in).
    const applied = result.changedFields[0];
    expect(applied.old).not.toHaveProperty('website');
    expect(applied.new).not.toHaveProperty('website');
    expect(applied.new).toMatchObject({ artworkCount: 9 });
  });

  it('keeps a whole-column claim as a conflict, with nothing else applied', () => {
    const result = computeChangeSet(before, incoming, ['metadata']);

    expect(result.curatedConflicts.map(c => c.field)).toContain('metadata');
    expect(result.changedFields).toHaveLength(0);
    expect(result.changeType).toBe('unchanged');
  });

  it('lets an orphaned claim fall through as applied, because the guard would too', () => {
    // The claim survives in curated_fields, but the key itself is gone from
    // the stored row — e.g. wiped by a run that predates this guard. The SQL
    // guard only re-applies a claimed key that `experiences.metadata ?
    // claimed.k`, so a missing key gets no protection and the source's value
    // is written; the report must agree, not raise a conflict over a write
    // that already happened.
    const orphanedBefore = snapshot({ metadata: { artworkCount: 5 } });
    const result = computeChangeSet(orphanedBefore, incoming, ['metadata.website']);

    expect(result.curatedConflicts).toHaveLength(0);
    expect(result.changedFields.map(c => c.field)).toEqual(['metadata']);
    expect(result.changedFields[0].new).toMatchObject({ website: 'https://source.example' });
  });
});

describe('CURATED_KEY_BY_FIELD', () => {
  it('keeps every dotted key spelled with the shared claim prefix', () => {
    const dottedKeys = Object.keys(CURATED_KEY_BY_FIELD).filter(key => key.includes('.'));

    // Not a computed key -- the map stays a readable literal on purpose --
    // but every dotted entry still has to start with the same prefix the
    // major-key loop composes a diff's field name from. If the prefix ever
    // changed here and not there, a diff for `metadata.inDanger` would stop
    // matching this map's key of the same literal spelling, the `?? diff.field`
    // fallback would take over, and a whole-column claim on 'metadata' would
    // stop protecting the major keys -- with no behavioural test catching it,
    // since none combines a whole-column claim with a major-key change.
    expect(dottedKeys.length).toBeGreaterThan(0);
    dottedKeys.forEach(key => expect(key.startsWith(METADATA_CLAIM_PREFIX)).toBe(true));
  });
});
