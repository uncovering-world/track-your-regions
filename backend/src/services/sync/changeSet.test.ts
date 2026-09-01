/**
 * Tests for the sync change-set diff.
 *
 * The diff decides what a run reports, so its false positives are expensive:
 * a JSONB key reordering or a 3-metre coordinate jitter must not be announced
 * as a change to 1247 objects.
 */

import { describe, it, expect } from 'vitest';
import {
  claimKeyFor, computeChangeSet, CURATED_KEY_BY_FIELD, METADATA_CLAIM_PREFIX,
  type ExperienceSnapshot,
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

  it('reports an unremarkable metadata edit under the key that moved', () => {
    const incoming = snapshot({ metadata: { inDanger: false, dateInscribed: 1981, areaHectares: 1476999 } });
    const result = computeChangeSet(snapshot(), incoming, [], WROTE);

    expect(result.significance).toBe('minor');
    // One entry per key that moved, and none for the keys that did not: a
    // curator answers a fact, and a key is a fact. A single `metadata` entry
    // carrying every moved key made the card fold them into one answer, which
    // is what stopped a curator taking inscription criteria without also
    // taking a picture credit they had not checked.
    expect(result.changedFields.map(f => f.field)).toEqual(['metadata.areaHectares']);
    expect(result.changedFields[0].old).toBe(1476300);
    expect(result.changedFields[0].new).toBe(1476999);
  });

  it('keeps the flag that decides a claim off the reported change', () => {
    const result = computeChangeSet(snapshot(), snapshot({
      metadata: { inDanger: false, dateInscribed: 1981, areaHectares: 1476999 },
    }), [], WROTE);

    // `protectedByClaim` is how `metadataChanges` answers what a field name
    // cannot. Spread into the reported change it reached `changed_fields`, which
    // is provenance and is never deleted, and an API shape that does not declare
    // it. A reported change is exactly these six keys.
    expect(Object.keys(result.changedFields[0]).sort()).toEqual(
      ['curatedConflict', 'field', 'held', 'new', 'old', 'significance'],
    );
  });

  it('reads a metadata key only where the side owns it, prototype names included', () => {
    // The keys come from the source. `right.__proto__` on a side that does not
    // carry it answers with the accessor on `Object.prototype`, so the diff would
    // report `old: Object.prototype` -- stored as `{}` -- for a key the row never
    // had, and would decide whether to report it at all against that same wrong
    // value. The read-side half of the rule `publishHeldFields.ts` keeps on the
    // write side.
    const hostile = JSON.parse('{"inDanger":false,"dateInscribed":1981,"areaHectares":1476300,"__proto__":{"x":1}}');
    const result = computeChangeSet(snapshot(), snapshot({ metadata: hostile }), [], WROTE);

    const entry = result.changedFields.find(f => f.field === 'metadata.__proto__');
    expect(entry).toBeDefined();
    expect(entry!.old).toBeUndefined();
    expect(entry!.new).toEqual({ x: 1 });
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
    // decision, and filing the row as minor would hide it from `?significance=major`
    // and take the major chip off it. The report's default view keeps a row with
    // a refused claim on its own terms (#516), so it is not what this protects.
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
    // would read as routine under `?significance=major` and carry no major chip
    // — the same argument the curated-conflict half already makes, one bucket
    // over. The report's default view keeps a `held` row either way.
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
  // held out of the diff entirely and raises no entry at all, and these cases are
  // about what a per-key entry does with a key a run really is proposing.
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

    // Each key names itself, so the claimed one and the applied one are two
    // rows rather than a row and a payload — the separation #488 asked for,
    // now structural: there is no shared payload a claimed value could leak
    // into.
    expect(result.changedFields.map(c => c.field)).toEqual(['metadata.wikipediaUrl']);
    expect(result.curatedConflicts.map(c => c.field)).toEqual(['metadata.website']);
    expect(result.changeType).toBe('updated');

    expect(result.changedFields[0].new).toBe('https://en.wikipedia.org/wiki/Serengeti_National_Park');
  });

  it('keeps a whole-column claim as a conflict, with nothing else applied', () => {
    const result = computeChangeSet(before, incoming, ['metadata'], WROTE);

    // A claim on the column protects every key under it, which no per-key name
    // matches — so the keys themselves have to carry the answer. Without this
    // the source's values would be reported as applied over a curator's claim.
    expect(result.curatedConflicts.map(c => c.field).sort())
      .toEqual(['metadata.website', 'metadata.wikipediaUrl']);
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
    expect(result.changedFields.map(c => c.field).sort())
      .toEqual(['metadata.website', 'metadata.wikipediaUrl']);
    expect(result.changedFields.find(c => c.field === 'metadata.website')?.new)
      .toBe('https://source.example');
  });
});

describe("a monument's makers, which are a set and not a list", () => {
  // Public art's half of ADR-0040. The source says who made a monument and not in
  // what order — the landmark queries answer in their planner's order, as the
  // museum pool does — so a run restating the same people another way round has
  // changed nothing, and under the gate a reported change is a held card asking a
  // curator to choose between two orderings of one fact.
  const monument = (creators: string[]) => snapshot({
    name: 'Christ the Redeemer',
    metadata: { wikidataQid: 'Q79961', creators },
  });

  it('says nothing when the same people come back the other way round', () => {
    const changes = computeChangeSet(
      monument(['Paul Landowski', 'Carlos Oswald']),
      monument(['Carlos Oswald', 'Paul Landowski']), [], WROTE,
    );
    expect(changes.changedFields.filter(f => f.field === 'metadata.creators')).toEqual([]);
  });

  it('folds their typesetting, as the works comparison does', () => {
    const changes = computeChangeSet(
      monument(['Paul Landowski', 'Carlos Oswald']),
      monument(['paul  landowski', 'Carlos Oswald']), [], WROTE,
    );
    expect(changes.changedFields.filter(f => f.field === 'metadata.creators')).toEqual([]);
  });

  it('reports a maker gained or dropped, which is what the source really said', () => {
    const gained = computeChangeSet(
      monument(['Paul Landowski']),
      monument(['Paul Landowski', 'Carlos Oswald']), [], WROTE,
    );
    expect(gained.changedFields.find(f => f.field === 'metadata.creators')).toMatchObject({
      old: ['Paul Landowski'], new: ['Paul Landowski', 'Carlos Oswald'],
    });
  });

  it('leaves every other list compared as a list', () => {
    // The set rule is one key's, not a new rule for arrays: `countryNames` and
    // the rest keep their own comparisons.
    const before = snapshot({ metadata: { criteria: ['i', 'ii'] } });
    const after = snapshot({ metadata: { criteria: ['ii', 'i'] } });
    expect(computeChangeSet(before, after, [], WROTE).changedFields.find(f => f.field === 'metadata.criteria'))
      .toBeDefined();
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

    // The curator is asked about the website and nothing else. With one entry
    // per key the counters cannot ride along in a payload at all -- they raise
    // no entry, so there is nothing for a publication to wipe them back to.
    // `admittedFor` goes with them (#570): derived from them, seen by nobody.
    expect(result.heldFields.map(f => f.field)).toEqual(['metadata.website']);
    expect(result.heldFields[0].new).toBe('https://www.louvre.fr/en');
    const named = [...result.heldFields, ...result.changedFields, ...result.curatedConflicts]
      .map(f => f.field);
    expect(named).not.toContain('metadata.artworkCount');
    expect(named).not.toContain('metadata.totalArtworkSitelinks');
    expect(named).not.toContain('metadata.admittedFor');
  });

  it('asks nobody about the work that did the qualifying', () => {
    // The admission rule re-runs every pass and files its own card if the museum
    // stops qualifying; the name of the work that tipped it is not a decision.
    const result = computeChangeSet(
      museum(2363),
      museum(2363, { admittedFor: { qid: 'Q45130', label: 'The Geographer' } }),
      [], HELD,
    );

    expect(result.changeType).toBe('unchanged');
    expect(result.heldFields).toEqual([]);
  });

  it('applies the same rule to a landmark\'s language-edition count', () => {
    // Monument to Salavat Yulaev, as the landmark source stores it: the count is
    // Wikidata's, moves with every translation anyone adds, and reaches no reader.
    const landmark = (sitelinksCount: number) => snapshot({
      name: 'Monument to Salavat Yulaev',
      metadata: { wikidataQid: 'Q4304093', creator: 'Soslanbek Tavasiev', year: 1967, type: 'monument', sitelinksCount },
    });

    const result = computeChangeSet(landmark(14), landmark(15), [], HELD);

    expect(result.changeType).toBe('unchanged');
    expect(result.heldFields).toEqual([]);
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

/**
 * The one lookup four readers share.
 *
 * The diff, the queue's conflict card, `accept-source` and the publish writer all ask
 * "which `curated_fields` entry protects this?" and have to reach the same answer or one
 * of them protects nothing. Three arms, and the middle one is why this block exists: the
 * per-part entries of a column claimed whole (#728).
 */
describe('claimKeyFor', () => {
  it('sends a column field to its column', () => {
    expect(claimKeyFor('shortDescription')).toBe('short_description');
    expect(claimKeyFor('nameLocal')).toBe('name_local');
  });

  it('sends every language of the local names to the column claimed whole', () => {
    // No `nameLocal.<lang>` can be in the map — the languages are the source's —
    // and the claim they fall under is the column. Without this the diff would
    // call the source's name applied while the upsert kept the curator's, and
    // publishing would write over the claimed column.
    expect(claimKeyFor('nameLocal.ko')).toBe('name_local');
    expect(claimKeyFor('nameLocal.zh-hant')).toBe('name_local');
  });

  it('leaves a per-key metadata claim naming itself', () => {
    // The asymmetry the family map exists to keep: `editExperience` claims
    // `metadata.website` under that literal name and no column matches it (#488),
    // so `metadata` is deliberately not a family. A rule that folded it in would
    // answer a whole-column question of a per-key claim.
    expect(claimKeyFor('metadata.website')).toBe('metadata.website');
    // Except the two the map itself carries, which a whole-column claim protects.
    expect(claimKeyFor('metadata.inDanger')).toBe('metadata');
  });

  it('sends a name it has never heard of to itself', () => {
    expect(claimKeyFor('somethingNew')).toBe('somethingNew');
    expect(claimKeyFor('somethingNew.key')).toBe('somethingNew.key');
  });
});

/**
 * Six local names are six facts (#728).
 *
 * `name_local` is one jsonb column and used to be reported as one entry carrying the
 * whole map, so run 68's six proposed names for Getbol, Korean Tidal Flats (Phase II)
 * reached a curator under one pair of buttons: take the corrected Korean name and the
 * English one comes with it, or refuse both. That is the defect ADR-0039 removed for
 * `metadata`, one column over, and these state the same rule for the language map.
 *
 * What each entry says is what the card used to derive for itself — same equality, same
 * alphabetical order (`objectDiff.ts` § `changedKeys`) — so the rows a curator reads do
 * not move; only where the answer lands does.
 */
describe('a local name is a fact of its own', () => {
  const named = (nameLocal: Record<string, string>) => snapshot({ nameLocal });

  it('reports one entry per language that differs, and none for the rest', () => {
    const before = named({ en: 'Getbol, Korean Tidal Flats (Phase II)', ko: '한국의 갯벌', fr: 'Getbol' });
    const incoming = named({ en: 'Getbol, Korean Tidal Flats', ko: '한국의 갯벌', fr: 'Getbol' });
    const result = computeChangeSet(before, incoming, [], WROTE);

    // `ko` and `fr` did not move, so they are not questions — the whole-map entry
    // asked about them anyway, which is what made the answer cover six facts.
    expect(result.changedFields.map(f => f.field)).toEqual(['nameLocal.en']);
    expect(result.changedFields[0].old).toBe('Getbol, Korean Tidal Flats (Phase II)');
    expect(result.changedFields[0].new).toBe('Getbol, Korean Tidal Flats');
    expect(result.changedFields[0].significance).toBe('minor');
  });

  it('names a language the source added and one it dropped', () => {
    const result = computeChangeSet(named({ en: 'Getbol', fr: 'Getbol' }), named({ en: 'Getbol', ko: '갯벌' }), [], WROTE);

    // Alphabetical, because a jsonb column does not keep the order the keys went
    // in and the same card has to read the same way twice.
    expect(result.changedFields.map(f => f.field)).toEqual(['nameLocal.fr', 'nameLocal.ko']);
    // Both sides of each, so a value going missing on the side that is supposed to
    // carry one would fail here. A language the source dropped is recorded only by
    // having no value — which is what publishing deletes on, and what stops the
    // removal being proposed for ever and applied never.
    expect(result.changedFields[0].old).toBe('Getbol');
    expect(result.changedFields[0].new).toBeUndefined();
    expect(result.changedFields[1].old).toBeUndefined();
    expect(result.changedFields[1].new).toBe('갯벌');
  });

  it('files no entry at all where every language agrees', () => {
    const result = computeChangeSet(named({ ko: '갯벌', en: 'Getbol' }), named({ en: 'Getbol', ko: '갯벌' }), [], WROTE);

    expect(result.changeType).toBe('unchanged');
    expect(result.changedFields).toEqual([]);
  });

  it('treats an absent map and an empty one as the same thing', () => {
    // The same reading `jsonEquals` gives everywhere else, and the one the card's
    // copy gives: a source that stops publishing local names for a row that never
    // had any has proposed nothing.
    expect(computeChangeSet(snapshot({ nameLocal: null }), snapshot({ nameLocal: {} }), [], WROTE).changeType)
      .toBe('unchanged');
  });

  it('reports every language as refused where a curator claims the column', () => {
    // `name_local` is claimed whole — the upsert's guard is `curated_fields ?
    // 'name_local'` and keeps or replaces the map entire — so a claim covers every
    // language under it. Resolved by `claimKeyFor`'s family lookup; without it the
    // run would report the source's names as applied while the upsert kept the
    // curator's, which is the changeset lying about what the run did.
    const result = computeChangeSet(
      named({ en: 'Old', ko: '옛' }), named({ en: 'New', ko: '새' }), ['name_local'], WROTE,
    );

    expect(result.changedFields).toEqual([]);
    expect(result.curatedConflicts.map(f => f.field)).toEqual(['nameLocal.en', 'nameLocal.ko']);
    expect(result.curatedConflicts.every(f => f.curatedConflict)).toBe(true);
  });

  it('holds every language back behind the gate, each answerable on its own', () => {
    const result = computeChangeSet(named({ en: 'Old', ko: '옛' }), named({ en: 'New', ko: '새' }), [], HELD);

    expect(result.changeType).toBe('unchanged');
    expect(result.heldFields.map(f => f.field)).toEqual(['nameLocal.en', 'nameLocal.ko']);
  });
});

/**
 * The equality a second copy depends on (#570).
 *
 * `frontend/src/components/curation/objectDiff.ts` holds `valuesEqual`, a copy of
 * `jsonEquals` below, because the curation card has to decide *which keys* of a change
 * this diff reported are worth a row. The two must answer alike: a card that finds no
 * differing key in a field the queue raised falls back to printing the object whole,
 * and one that finds a key this diff considers equal asks a curator about a value that
 * never moved.
 *
 * Nothing structural can hold them together — the two packages share no runtime, which
 * is what #527 is open about — so the pin is behavioural and lives on both sides. These
 * cases state the properties inside a metadata value; `objectDiff.test.ts` states the
 * same ones against its own copy, and each names the other. Relaxing any of them here
 * fails here, which is the point: the drift would otherwise be invisible until a
 * curator read a row that should not exist.
 */
describe('the equality a curation card mirrors (#570)', () => {
  it('does not treat key order inside a metadata value as a difference', () => {
    const before = snapshot({ metadata: { imageCredit: { author: 'G. Brigas', license: '© UNESCO' } } });
    const incoming = snapshot({ metadata: { imageCredit: { license: '© UNESCO', author: 'G. Brigas' } } });

    expect(computeChangeSet(before, incoming, [], WROTE).changeType).toBe('unchanged');
  });

  it('does not treat a null or empty metadata key as different from a missing one', () => {
    // 17 entries in this catalogue's log carry `criteria` appearing as `null`, and the
    // card must not raise a row for any of them.
    const before = snapshot({ metadata: { areaHectares: 1476300 } });
    const incoming = snapshot({ metadata: { areaHectares: 1476300, criteria: null, website: '' } });

    expect(computeChangeSet(before, incoming, [], WROTE).changeType).toBe('unchanged');
  });

  it('does treat the order of an array inside a metadata value as a difference', () => {
    // Deliberately unlike `countryCodes`, which is compared as a set two blocks above.
    // Relaxing this one to match it is the drift that would silently split the card
    // from the queue, since the copy compares arrays by position.
    const before = snapshot({ metadata: { criteria: ['(i)', '(ii)'] } });
    const incoming = snapshot({ metadata: { criteria: ['(ii)', '(i)'] } });
    const result = computeChangeSet(before, incoming, [], WROTE);

    expect(result.changeType).toBe('updated');
    expect(result.changedFields.map(f => f.field)).toEqual(['metadata.criteria']);
  });

  it('holds a string apart from the number that reads the same', () => {
    // The trap the card's "shown as stored" note exists for: a word comparison over
    // `"2003"` and `2003` marks nothing while the two really disagree.
    const before = snapshot({ metadata: { yearBuilt: '2003' } });
    const incoming = snapshot({ metadata: { yearBuilt: 2003 } });

    expect(computeChangeSet(before, incoming, [], WROTE).changeType).toBe('updated');
  });
});

/**
 * Tags are the run's own labels, and no reader sees them (#570).
 *
 * The import derives them from facts it also stores by name, and no reader-facing
 * read returns the column, so a card about them asked a person to decide something
 * nobody could see the outcome of. Bamiyan's held card from run 68 carried
 * `[] → ["criterion_i", …, "in_danger"]` beside a criteria row saying the same thing.
 */
describe('a tags change is not a change', () => {
  const bamiyan = (tags: string[]) => snapshot({
    name: 'Cultural Landscape and Archaeological Remains of the Bamiyan Valley',
    tags,
  });

  it('raises no card, held or applied, when only the tags moved', () => {
    const result = computeChangeSet(bamiyan([]), bamiyan(['criterion_i', 'criterion_ii', 'in_danger']), [], HELD);

    expect(result.changeType).toBe('unchanged');
    expect(result.heldFields).toEqual([]);
    expect(result.changedFields).toEqual([]);
  });

  it('reports no conflict on a claimed value either, since nobody reads the outcome', () => {
    // The upsert keeps the curator's tags -- a person's write is not a
    // measurement -- and there is no decision to ask for: whichever value stands,
    // no reader sees it.
    const result = computeChangeSet(bamiyan(['in_danger']), bamiyan(['criterion_i']), ['tags'], WROTE);

    expect(result.curatedConflicts).toEqual([]);
    expect(result.changeType).toBe('unchanged');
  });
});
