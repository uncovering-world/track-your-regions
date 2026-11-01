/**
 * Tests for a proposal as a table of facts.
 *
 * What is worth pinning is the shape a curator reads: which rows a proposal makes, of
 * what kind, and which fields never make one. The examples are the queue's own — Bamiyan's
 * held card from run 68, the Louvre's from museum run 64.
 */

import { describe, it, expect, vi } from 'vitest';
import { partGroups, rowsFor, summarize } from './factRows';

const NO_CONTEXT = { proposed: [] };

/** Bamiyan's held card from run 68, as the queue carries it. */
const bamiyan = [
  { field: 'tags', old: [], new: ['criterion_i', 'criterion_ii', 'in_danger'], held: true },
  { field: 'metadata.inDanger', old: false, new: true, held: true },
  {
    field: 'metadata',
    old: { website: 'https://whc.unesco.org/en/list/208', region: 'Asia and the Pacific' },
    new: {
      website: 'https://whc.unesco.org/en/list/208', region: 'Asia and the Pacific',
      criteria: '(i)(ii)(iii)(iv)', imageCredit: { author: 'Graciela Gonzalez Brigas', license: '© UNESCO' },
    },
    held: true,
  },
];

describe('rowsFor', () => {
  it('marks a Wikidata item replaced as an event, and one arriving as none (#1794)', () => {
    const [arrived] = rowsFor([{ field: 'metadata.wikidataQid', old: null, new: 'Q184427' }], NO_CONTEXT);
    const [replaced] = rowsFor([{ field: 'metadata.wikidataQid', old: 'Q184427', new: 'Q1' }], NO_CONTEXT);
    expect([arrived.event, replaced.event]).toEqual([false, true]);
    expect(rowsFor([{ field: 'metadata.inDanger', old: false, new: true }], NO_CONTEXT)[0].event).toBe(true);
  });

  it("credits UNESCO's text on the place's description row, never on a point's, whose line is Wikidata's", () => {
    const rewritten = { field: 'description', old: 'The property comprises four component parts…', new: 'The property comprises six component parts…' };

    expect(rowsFor([rewritten], NO_CONTEXT)[0].sentence)
      .toBe("The new text is UNESCO World Heritage Centre's, under CC BY-SA 4.0.");
    expect(rowsFor([{ field: 'description', old: null, new: 'prehistoric pile dwelling in Switzerland' }], { ...NO_CONTEXT, part: true })[0].sentence)
      .toBeNull();
  });

  it('makes one row per fact that moved, named as the fact, in the order the queue gave', () => {
    const rows = rowsFor(bamiyan, NO_CONTEXT);
    expect(rows.map(r => r.meaning.label)).toEqual(['in danger', 'inscription criteria', 'picture credit']);
    // The keys that agree are not rows, and the storage grouping is not a row either.
    expect(rows.map(r => r.id)).toEqual(['metadata.inDanger', 'metadata.criteria', 'metadata.imageCredit']);
  });

  it('keeps tags off the card, even where an older run filed them', () => {
    expect(rowsFor(bamiyan, NO_CONTEXT).some(r => r.field === 'tags')).toBe(false);
  });

  it('says what kind of change each row is', () => {
    const rows = rowsFor(bamiyan, NO_CONTEXT);
    expect(rows.map(r => r.kind)).toEqual(['changed', 'new', 'new']);
    expect(rowsFor([{ field: 'metadata', old: { criteria: '(i)' }, new: {} }], NO_CONTEXT)[0].kind).toBe('removed');
    // An empty list is nothing, to a person.
    expect(rowsFor([{ field: 'countryNames', old: [], new: ['France'] }], NO_CONTEXT)[0].kind).toBe('new');
  });

  it('keeps the rows of one field together and lets them share its answer', () => {
    const rows = rowsFor(bamiyan, NO_CONTEXT);
    expect(rows.filter(r => r.field === 'metadata').map(r => r.id)).toEqual(['metadata.criteria', 'metadata.imageCredit']);
  });

  it('gives each local name a row of its own, and its own field to be answered by', () => {
    // Getbol's card, both ways round. A run files one entry per language now
    // (#728), so each row already carries its own field and the answer cell
    // spans one row; a card filed before that carries the whole map, splits into
    // the same rows, and they all carry `nameLocal` — which is what makes one
    // pair of buttons answer six facts, and why `Answers all N.` is on screen.
    const perLanguage = rowsFor([
      { field: 'nameLocal.en', old: 'Getbol, Korean Tidal Flats (Phase II)', new: 'Getbol, Korean Tidal Flats' },
      { field: 'nameLocal.ko', old: '한국의 갯벌', new: '한국의 갯벌 (2단계)' },
    ], NO_CONTEXT);
    expect(perLanguage.map(r => r.meaning.label)).toEqual(['name in English', 'name in Korean']);
    expect(perLanguage.map(r => r.field)).toEqual(['nameLocal.en', 'nameLocal.ko']);

    const wholeMap = rowsFor([{
      field: 'nameLocal',
      old: { en: 'Getbol, Korean Tidal Flats (Phase II)', ko: '한국의 갯벌' },
      new: { en: 'Getbol, Korean Tidal Flats', ko: '한국의 갯벌 (2단계)' },
    }], NO_CONTEXT);
    // The same rows, read the same way — only the answer's reach differs.
    expect(wholeMap.map(r => r.meaning.label)).toEqual(perLanguage.map(r => r.meaning.label));
    expect(new Set(wholeMap.map(r => r.field))).toEqual(new Set(['nameLocal']));
  });

  it('keeps a claimed credit whole, because the vocabulary can say it and its parts have no meaning of their own', () => {
    // `editExperience` claims `metadata.imageCredit` per key, so a run bringing a
    // different credit reports it as its own field with an object on each side.
    const rows = rowsFor([{
      field: 'metadata.imageCredit',
      old: { author: 'Graciela Gonzalez Brigas', license: '© UNESCO' },
      new: { author: 'Someone Else', license: '© UNESCO' },
    }], NO_CONTEXT);
    expect(rows).toHaveLength(1);
    expect(rows[0].meaning.label).toBe('picture credit');
    expect(rows[0].sentence).toBe('The same file: Wikimedia Commons names its author differently now.');
  });

  it('gives a credit no row where its picture is proposed beside it, at either level', () => {
    // One answer, so one row: the picture row draws each side's credit under it.
    for (const picture of ['imageUrl', 'image_url']) {
      const rows = rowsFor([
        { field: picture, old: 'https://commons.wikimedia.org/wiki/Special:FilePath/Old.jpg', new: 'https://commons.wikimedia.org/wiki/Special:FilePath/New.jpg' },
        { field: 'metadata.imageCredit', old: { author: 'Thomas Wolf' }, new: { author: 'VitVit' } },
        { field: 'metadata.wikipediaUrl', old: null, new: 'https://en.wikipedia.org/wiki/Museum_Island' },
      ], NO_CONTEXT);
      expect(rows.map(r => r.field)).toEqual([picture, 'metadata.wikipediaUrl']);
    }
  });

  it('keeps a credit\'s row where the picture beside it has no value on either side', () => {
    // The picture makes no row (#1774), so a credit folded into it would be shown nowhere.
    const rows = rowsFor([
      { field: 'imageUrl', old: null, new: null },
      { field: 'metadata.imageCredit', old: { author: 'Thomas Wolf' }, new: { author: 'VitVit' } },
    ], NO_CONTEXT);
    expect(rows.map(r => r.field)).toEqual(['metadata.imageCredit']);
  });

  it('keeps a coordinate whole, because a place is not two numbers', () => {
    const rows = rowsFor([{ field: 'location', old: { lon: 4, lat: 49 }, new: { lon: 4, lat: 49.3 } }], NO_CONTEXT);
    expect(rows).toHaveLength(1);
    expect(rows[0].sentence).toBe('Moved 33.4 km north — may fall in a different region; check the pin.');
  });

  it('carries the sentence the fact has about this change, with the object as readers see it', () => {
    const [danger] = rowsFor([bamiyan[1]], { proposed: [], inDanger: true, dangerSince: 2003 });
    expect(danger.sentence).toContain('Readers already see this badge');
  });

  it('carries who claimed the field a conflict card asks about', () => {
    const [row] = rowsFor([{
      field: 'description', old: 'Six housing estates', new: 'The serial property comprises seven',
      claim: { by: 'admin', at: '2026-08-04T12:24:20Z' }, decidedBefore: [],
    }], NO_CONTEXT);
    expect(row.provenance?.claim?.by).toBe('admin');
  });

  it('makes no row for a fact that is empty on both sides', () => {
    // The Reina Sofía's held card from Art Museums run 177: an empty list stored,
    // and no value of the run's own. Nothing moves, so nothing is asked.
    const reinaSofia = [
      { field: 'metadata.creators', old: [], new: undefined },
      { field: 'description', old: '', new: null },
      { field: 'metadata.inDanger', old: false, new: true },
    ];
    expect(rowsFor(reinaSofia, NO_CONTEXT).map(r => r.field)).toEqual(['metadata.inDanger']);
  });

  it('makes no row for a key that is empty on both sides inside a field with named parts', () => {
    const rows = rowsFor([{
      field: 'metadata', old: { region: 'Europe', tags: [] }, new: { region: 'Europe and North America', tags: null },
    }], NO_CONTEXT);
    expect(rows.map(r => r.id)).toEqual(['metadata.region']);
  });
});

describe('summarize', () => {
  it('counts the rows by kind, for the line that says what a run proposes', () => {
    const byKind = summarize(rowsFor(bamiyan, NO_CONTEXT));
    expect(byKind.changed.map(r => r.meaning.label)).toEqual(['in danger']);
    expect(byKind.new.map(r => r.meaning.label)).toEqual(['inscription criteria', 'picture credit']);
    expect(byKind.removed).toEqual([]);
  });

  it('does not count a fact that moves nothing as new', () => {
    const byKind = summarize(rowsFor([{ field: 'metadata.creators', old: [], new: undefined }], NO_CONTEXT));
    expect(byKind.new).toEqual([]);
  });
});

describe('partGroups', () => {
  // The Wine Glass under Gemäldegalerie, its attribution held (ADR-0037), and
  // one place of a serial site renamed — as the queue's held card carries them.
  const wineGlass = {
    kind: 'treasures' as const,
    item: { name: 'The Wine Glass', ref: 'Q782639' },
    fields: [{ field: 'artists', old: ['Johannes Vermeer'], new: ['Jan Vermeer van Haarlem the Elder'], held: true }],
    treasureId: 3102, artists: ['Jan Vermeer van Haarlem the Elder'], year: 1659,
    imageUrl: 'http://commons.wikimedia.org/wiki/Special:FilePath/Wine.jpg', imageCredit: null, treasureType: 'painting',
  };
  const montsegur = {
    kind: 'locations' as const,
    item: { name: 'Château de Montésgur', ref: '1755-004' },
    fields: [{ field: 'name', old: 'Château de Montésgur', new: 'Château de Montségur', held: true }],
    locationId: 11134, latitude: 42.8758, longitude: 1.8323, ordinal: 5,
  };

  it('says a part has been corrected in that part\'s own words', () => {
    // Each kind carries its own claim key — one `jsonb_build_object` builds both,
    // so a shared name could not answer for two rows — and its own vocabulary: a
    // place's rule answers `null` to a claimed `artists` and calls a claimed
    // `name` "name corrected", where a work reads "title corrected". Read with
    // the place's key and words, a held work's heading carried no chip at all
    // while the same work read "title corrected" on every other surface (#731).
    const groups = partGroups(
      [
        { ...montsegur, curatedFields: ['location'] },
        { ...wineGlass, workCuratedFields: ['name', 'artists'] },
      ],
      NO_CONTEXT, { offeredLocations: 8 }, () => {},
    );

    expect(groups[0].subject.claim).toBe('pin corrected');
    expect(groups[1].subject.claim).toBe('title and makers corrected');
  });

  it('heads a part with the name the row holds now, not the name the run saw', () => {
    // The record names the part as it was when the run wrote it and is never
    // rewritten. A work retitled since — from this card's own dialog — would
    // otherwise be headed with the old name under a chip saying it was
    // corrected, and the reopened dialog seeded with it again (#731).
    const groups = partGroups(
      [{ ...wineGlass, storedName: 'The Glass of Wine', workCuratedFields: ['name'] }],
      NO_CONTEXT, { offeredLocations: 8 }, () => {},
    );

    expect(groups[0].subject.label).toBe('The Glass of Wine');
    expect(groups[0].subject.claim).toBe('title corrected');
  });

  it('makes one group per part, headed by the record\'s name where the row was not found', () => {
    const groups = partGroups([montsegur, wineGlass], NO_CONTEXT, { offeredLocations: 8 }, () => {});

    expect(groups.map(g => [g.subject.kind, g.subject.label])).toEqual([
      ['place', 'Château de Montésgur'],
      ['work', 'The Wine Glass'],
    ]);
    expect(groups[0].rows.map(r => r.meaning.label)).toEqual(['name']);
    expect(groups[1].rows.map(r => r.meaning.label)).toEqual(['attribution']);
    expect(groups[1].rows[0].kind).toBe('changed');
  });

  it('tells a part from its siblings: which place of how many, whose work', () => {
    const [place, work] = partGroups([montsegur, wineGlass], NO_CONTEXT, { offeredLocations: 8 }, () => {});

    expect(place.subject.detail).toBe('place 5 of 8');
    // The maker readers see today, since the row is what the change is against.
    expect(work.subject.detail).toBe('by Jan Vermeer van Haarlem the Elder, 1659');
  });

  it('offers a way to open a part only where there is a row to open', () => {
    const onOpen = vi.fn();
    const withdrawn = { ...montsegur, locationId: null, latitude: null, longitude: null, ordinal: null };
    const [gone, work] = partGroups([withdrawn, wineGlass], NO_CONTEXT, { offeredLocations: 8 }, onOpen);

    // The source withdrew the place after proposing its rename: the proposal is
    // still what the run recorded, and there is no pin to look at.
    expect(gone.subject.onOpen).toBeUndefined();
    expect(gone.subject.detail).toBeNull();
    work.subject.onOpen?.();
    expect(onOpen).toHaveBeenCalledWith(wineGlass);
  });

  it('builds a part’s rows in the part’s own context: its fields, and its picture’s credit', () => {
    // A work's picture is credited to whoever photographed the work, never to the
    // museum's photographer — and a rendering looks that up on the row it draws.
    const museumCredit = { author: 'Museum photographer', license: 'CC BY 4.0', licenseUrl: null, detailsUrl: null };
    const workCredit = { author: 'Google Arts Project', license: 'Public domain', licenseUrl: null, detailsUrl: null };
    const [work] = partGroups(
      [{ ...wineGlass, imageCredit: workCredit }],
      { proposed: [{ field: 'imageUrl', old: null, new: 'http://commons.wikimedia.org/wiki/Special:FilePath/Museum.jpg' }], imageCredit: museumCredit },
      {}, () => {},
    );

    expect(work.rows[0].context.proposed).toBe(wineGlass.fields);
    expect(work.rows[0].context.imageCredit).toEqual(workCredit);
  });

  it('draws no group for a part whose fields have no value on either side', () => {
    // A work filed the way the Reina Sofía's place was (#1774): no makers stored, and
    // none proposed. A heading over no rows would read as a question with nothing in it.
    const unattributed = { ...wineGlass, item: { name: 'Guernica', ref: 'Q175036' }, fields: [{ field: 'artists', old: [], new: undefined }] };
    const groups = partGroups([unattributed, montsegur], NO_CONTEXT, {}, vi.fn());
    expect(groups.map(g => g.subject.label)).toEqual(['Château de Montésgur']);
  });

  it('names a part by its reference where the source gave it no name', () => {
    const [group] = partGroups([{ ...montsegur, item: { name: null, ref: '1755-004' } }], NO_CONTEXT, {}, () => {});
    expect(group.subject.label).toBe('1755-004');
  });

  it('tells two parts with one name apart by the reference, so the table can key them', () => {
    // The Getty holds two works called Spring inside its best-known twelve, and a
    // label is a Wikidata string with no uniqueness about it; the reference is the
    // identity the record stores.
    const [first, second] = partGroups([
      { ...wineGlass, item: { name: 'Spring', ref: 'Q1' } },
      { ...wineGlass, item: { name: 'Spring', ref: 'Q2' } },
    ], NO_CONTEXT, {}, () => {});

    expect(first.subject.label).toBe(second.subject.label);
    expect(first.subject.key).toBeDefined();
    expect(first.subject.key).not.toBe(second.subject.key);
  });
});
