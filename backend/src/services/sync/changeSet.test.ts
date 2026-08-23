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

/**
 * What the upsert answered about the row it just wrote — `was_held`, handed back
 * by the statement rather than recomputed here.
 *
 * The rule behind the answer (gated **and** the row is not `pending`) is SQL and
 * is tested as SQL: `syncUtils.upsert.test.ts` pins the expression's text and
 * that the guards and the report use the same one, and the live scenarios in
 * `.superpowers/sdd/.../task-7-report.md` walk a pending row and a visible one
 * through a real gated run. What is testable here is what the diff does with the
 * answer.
 */
const WROTE = false;
const HELD = true;

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
    const result = computeChangeSet(null, snapshot(), [], WROTE);

    expect(result.changeType).toBe('created');
    expect(result.changedFields).toEqual([]);
    expect(result.significance).toBeNull();
  });

  it('reports unchanged when nothing differs', () => {
    const result = computeChangeSet(snapshot(), snapshot(), [], WROTE);

    expect(result.changeType).toBe('unchanged');
    expect(result.changedFields).toEqual([]);
    expect(result.significance).toBeNull();
  });

  it('ignores JSONB key order', () => {
    const before = snapshot({ metadata: { inDanger: false, dateInscribed: 1981, areaHectares: 1476300 } });
    const incoming = snapshot({ metadata: { areaHectares: 1476300, dateInscribed: 1981, inDanger: false } });

    expect(computeChangeSet(before, incoming, [], WROTE).changeType).toBe('unchanged');
  });

  it('treats country arrays as sets, not sequences', () => {
    const before = snapshot({ countryCodes: ['FR', 'ES'], countryNames: ['France', 'Spain'] });
    const incoming = snapshot({ countryCodes: ['ES', 'FR'], countryNames: ['Spain', 'France'] });

    expect(computeChangeSet(before, incoming, [], WROTE).changeType).toBe('unchanged');
  });

  it('treats null, empty string and missing text as the same absence', () => {
    const before = snapshot({ description: null });
    const incoming = snapshot({ description: '' });

    expect(computeChangeSet(before, incoming, [], WROTE).changeType).toBe('unchanged');
  });

  it('ignores coordinate jitter below the threshold', () => {
    // ~5 m north of the original point
    const incoming = snapshot({ lat: -2.3333 + 0.000045 });

    expect(computeChangeSet(snapshot(), incoming, [], WROTE).changeType).toBe('unchanged');
  });

  it('reports a moderate coordinate shift as minor', () => {
    // ~500 m east
    const incoming = snapshot({ lon: 34.8333 + 0.0045 });
    const result = computeChangeSet(snapshot(), incoming, [], WROTE);

    expect(result.changeType).toBe('updated');
    expect(result.changedFields.map(f => f.field)).toEqual(['location']);
    expect(result.significance).toBe('minor');
  });

  it('reports a kilometre-scale coordinate shift as major', () => {
    // ~5 km east
    const incoming = snapshot({ lon: 34.8333 + 0.045 });
    const result = computeChangeSet(snapshot(), incoming, [], WROTE);

    expect(result.significance).toBe('major');
  });

  it('reports a description rewrite as minor', () => {
    const incoming = snapshot({ shortDescription: 'A completely rewritten summary.' });
    const result = computeChangeSet(snapshot(), incoming, [], WROTE);

    expect(result.changeType).toBe('updated');
    expect(result.significance).toBe('minor');
    expect(result.changedFields[0]).toMatchObject({ field: 'shortDescription', significance: 'minor' });
  });

  it('reports a danger-list entry as a major metadata change', () => {
    const incoming = snapshot({ metadata: { inDanger: true, dateInscribed: 1981, areaHectares: 1476300 } });
    const result = computeChangeSet(snapshot(), incoming, [], WROTE);

    expect(result.significance).toBe('major');
    expect(result.changedFields).toContainEqual({
      field: 'metadata.inDanger',
      old: false,
      new: true,
      significance: 'major',
      curatedConflict: false,
      held: false,
    });
  });

  it('reports unremarkable metadata edits as one minor change', () => {
    const incoming = snapshot({ metadata: { inDanger: false, dateInscribed: 1981, areaHectares: 1476999 } });
    const result = computeChangeSet(snapshot(), incoming, [], WROTE);

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
    const result = computeChangeSet(snapshot(), incoming, ['name'], WROTE);

    expect(result.changeType).toBe('unchanged');
    expect(result.changedFields).toEqual([]);
    expect(result.curatedConflicts).toEqual([{
      field: 'name',
      old: 'Serengeti National Park',
      new: 'Serengeti NP (renamed upstream)',
      significance: 'major',
      curatedConflict: true,
      // The claim is why this was not written, and the gate is not: a field
      // carries exactly one reason, or the queue and the publish writer — which
      // both key on `held` — would offer a curator's own value back to them.
      held: false,
    }]);
  });

  it('still reports unprotected fields when another field is curated', () => {
    const incoming = snapshot({
      name: 'Serengeti NP (renamed upstream)',
      shortDescription: 'New summary.',
    });
    const result = computeChangeSet(snapshot(), incoming, ['name'], WROTE);

    expect(result.changeType).toBe('updated');
    expect(result.changedFields.map(f => f.field)).toEqual(['shortDescription']);
    expect(result.curatedConflicts).toHaveLength(1);
  });

  it('keeps a major curated conflict visible when a routine edit rides along', () => {
    const incoming = snapshot({
      name: 'Serengeti NP (renamed upstream)',
      shortDescription: 'New summary.',
    });
    const result = computeChangeSet(snapshot(), incoming, ['name'], WROTE);

    // The applied half is minor; the refused half is the part needing a
    // decision, and filing the row as minor would hide it from the default view
    expect(result.changeType).toBe('updated');
    expect(result.significance).toBe('major');
  });

  it('escalates the row to major when any field is major', () => {
    const incoming = snapshot({ name: 'Renamed', shortDescription: 'New summary.' });
    const result = computeChangeSet(snapshot(), incoming, [], WROTE);

    expect(result.significance).toBe('major');
  });
});

describe('a gated source over a row a reader can already see', () => {
  it('files a differing field as held rather than as one the run applied', async () => {
    const incoming = snapshot({ shortDescription: 'A summary the source now offers.' });
    const result = computeChangeSet(snapshot(), incoming, [], HELD);

    // The upsert refused this write, so `changedFields` — the bucket that means
    // written — must not carry it: a curator reading `old → new` there reads the
    // held value as the one now live (#519).
    expect(result.changedFields).toEqual([]);
    expect(result.heldFields.map(f => f.field)).toEqual(['shortDescription']);
  });

  it('reports the row as unchanged, because nothing about it changed', () => {
    const incoming = snapshot({ shortDescription: 'A summary the source now offers.' });

    expect(computeChangeSet(snapshot(), incoming, [], HELD).changeType).toBe('unchanged');
  });

  it('marks the held field with the reason it was not written', () => {
    const incoming = snapshot({ shortDescription: 'A summary the source now offers.' });
    const result = computeChangeSet(snapshot(), incoming, [], HELD);

    // Whole-object equality on the one entry, not `held: true` somewhere in the
    // list: the queue's `held` card, the publish writer and the chip all read
    // both flags off each field, and `curatedConflict: true` here would say a
    // person had claimed the field when nobody has looked at it at all.
    expect(result.heldFields).toEqual([{
      field: 'shortDescription',
      old: 'Vast plains of the Serengeti.',
      new: 'A summary the source now offers.',
      significance: 'minor',
      curatedConflict: false,
      held: true,
    }]);
  });

  it('keeps a claimed field a curated conflict, and holds only the rest', () => {
    const incoming = snapshot({
      name: 'Serengeti NP (renamed upstream)',
      shortDescription: 'A summary the source now offers.',
    });
    const result = computeChangeSet(snapshot(), incoming, ['name'], HELD);

    // Both were refused, for different reasons and with different answers: the
    // claim is answerable through `accept-source`, the hold through publishing.
    // One field in both buckets would carry two contradictory cards.
    expect(result.curatedConflicts.map(f => f.field)).toEqual(['name']);
    expect(result.heldFields.map(f => f.field)).toEqual(['shortDescription']);
    expect(result.changedFields).toEqual([]);
    // And the flags say the same thing the buckets do. A claimed field on a held
    // row is `held: false`, or the queue's `held` card and the publish writer —
    // which read the flag, not the bucket — would offer the curator their own
    // value back as though the source had sent it.
    expect(result.curatedConflicts[0].held).toBe(false);
    expect(result.heldFields[0].curatedConflict).toBe(false);
  });

  it('weighs a held field, so the proposal is not the hidden half', () => {
    // `name` is major. A held row whose significance came out null or minor
    // would drop out of the run report's default view — the same argument the
    // curated-conflict half already makes, one bucket over.
    const incoming = snapshot({ name: 'Serengeti NP (renamed upstream)' });
    const result = computeChangeSet(snapshot(), incoming, [], HELD);

    expect(result.significance).toBe('major');
  });

  it('holds nothing on a row it has just inserted', () => {
    const result = computeChangeSet(null, snapshot(), [], HELD);

    // The insert writes every column; `pending` is what the gate does about a
    // new row, so there is no refused write to report.
    expect(result.changeType).toBe('created');
    expect(result.heldFields).toEqual([]);
  });

  it('marks an ordinary applied change with neither reason', () => {
    const incoming = snapshot({ shortDescription: 'A summary the source now offers.' });
    const result = computeChangeSet(snapshot(), incoming, [], WROTE);

    // The three sites that used to infer "held" by elimination now read this
    // flag. A field that was actually written must therefore say so positively:
    // `curatedConflict: false` alone no longer means anything.
    expect(result.changedFields).toEqual([{
      field: 'shortDescription',
      old: 'Vast plains of the Serengeti.',
      new: 'A summary the source now offers.',
      significance: 'minor',
      curatedConflict: false,
      held: false,
    }]);
  });
});

describe('a metadata key claimed per key', () => {
  // The second key is deliberately an ordinary one. A key the run owns would be
  // stripped from the catch-all before the diff ran, and these cases are about
  // what the catch-all does with the keys it does speak for.
  const before = snapshot({ metadata: { website: 'https://curator.example', wikipediaUrl: 'https://en.wikipedia.org/wiki/Serengeti' } });
  const incoming = snapshot({ metadata: { website: 'https://source.example', wikipediaUrl: 'https://en.wikipedia.org/wiki/Serengeti_National_Park' } });

  it('reports the claimed key as a conflict, not as an applied change', () => {
    const result = computeChangeSet(before, incoming, ['metadata.website'], WROTE);

    const conflictFields = result.curatedConflicts.map(c => c.field);
    expect(conflictFields).toContain('metadata.website');
    expect(result.changedFields.map(c => c.field)).not.toContain('metadata.website');
  });

  it('still reports the unclaimed keys as applied, because the run applied them', () => {
    const result = computeChangeSet(before, incoming, ['metadata.website'], WROTE);

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
    expect(applied.new).toMatchObject({ wikipediaUrl: 'https://en.wikipedia.org/wiki/Serengeti_National_Park' });
  });

  it('keeps a whole-column claim as a conflict, with nothing else applied', () => {
    const result = computeChangeSet(before, incoming, ['metadata'], WROTE);

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
    const orphanedBefore = snapshot({ metadata: { wikipediaUrl: 'https://en.wikipedia.org/wiki/Serengeti' } });
    const result = computeChangeSet(orphanedBefore, incoming, ['metadata.website'], WROTE);

    expect(result.curatedConflicts).toHaveLength(0);
    expect(result.changedFields.map(c => c.field)).toEqual(['metadata']);
    expect(result.changedFields[0].new).toMatchObject({ website: 'https://source.example' });
  });
});

describe('a metadata key the run computes about its own pass', () => {
  // Run 64's Louvre card, as it stood: 122 works, and a sum over them that two
  // language links somewhere in the world had just moved.
  const museum = (totalArtworkSitelinks: number, extra: Record<string, unknown> = {}) => snapshot({
    name: 'Louvre Museum',
    metadata: {
      wikidataQid: 'Q19675',
      website: 'https://www.louvre.fr/zh-hans',
      admittedFor: { qid: 'Q12418', label: 'Mona Lisa' },
      artworkCount: 122,
      totalArtworkSitelinks,
      ...extra,
    },
  });

  it('is not a change, so a run that moved only the counters raises no card', () => {
    const result = computeChangeSet(museum(2363), museum(2365), [], HELD);

    // The whole point of #571: a card in the review queue saying
    // `totalArtworkSitelinks: 2363 → 2365`, and the same card again next run.
    expect(result.changedFields).toEqual([]);
    expect(result.heldFields).toEqual([]);
    expect(result.changeType).toBe('unchanged');
    expect(result.significance).toBeNull();
  });

  it('stays out of the card a real change does raise, on both sides', () => {
    const before = museum(2363);
    const incoming = museum(2365, { website: 'https://www.louvre.fr/en' });

    const result = computeChangeSet(before, incoming, [], HELD);

    expect(result.heldFields.map(f => f.field)).toEqual(['metadata']);
    const held = result.heldFields[0];
    // The curator is asked about the website and nothing else. Stripped from
    // `old` as well as `new`, because `publishHeldFields.ts` reads `old` as the
    // list of keys this entry speaks for: a counter named there would be wiped
    // back to the value the proposal was computed against the moment somebody
    // published the website.
    expect(held.new).toEqual({
      wikidataQid: 'Q19675',
      website: 'https://www.louvre.fr/en',
      admittedFor: { qid: 'Q12418', label: 'Mona Lisa' },
    });
    expect(held.old).not.toHaveProperty('artworkCount');
    expect(held.old).not.toHaveProperty('totalArtworkSitelinks');
  });

  it('raises no conflict when claimed, because the upsert writes it anyway', () => {
    // Unreachable through `editExperience`, which offers three keys and none of
    // them is this. Pinned because the upsert's claimed-key re-application
    // carries the same exclusion, and a conflict here would offer a curator
    // "accept source" over a value the same statement had already written.
    const result = computeChangeSet(
      museum(2363), museum(2365), ['metadata.totalArtworkSitelinks'], HELD);

    expect(result.curatedConflicts).toEqual([]);
    expect(result.changeType).toBe('unchanged');
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
