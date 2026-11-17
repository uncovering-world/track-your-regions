import { describe, expect, it } from 'vitest';
import { actNote, actRecord, actRows, actWhy, againstTheRule, type Act } from './actRows';

/** Acts as dev's curation log holds them (2026-11-17). */
const act = (action: Act['action'], details: Record<string, unknown> | null, kind_name: string | null = null): Act =>
  ({ action, details, kind_name });

describe('an act of the curation log as rows of an audit table (#956)', () => {
  it("lays an edit out as its fact before and after, and the run's proposal it turned down", () => {
    const rows = actRows(act('edited', {
      'metadata.commemorates': { old: null, new: { via: 'curator', subjects: [{ item: 'Q814235', label: 'German campaign of 1813' }] } },
      heldSettled: [{ field: 'metadata.commemorates', answer: 'refused', proposed: { via: 'memorials-category', subjects: [{ item: 'Q361', label: 'World War I' }] } }],
    }));
    expect(rows[0]).toMatchObject({ before: '(empty)', after: 'German campaign of 1813' });
    expect(rows[1].note).toBe("Turned down the run's: World War I");
    expect(rows.every((row) => row.fact)).toBe(true);
  });

  it("moves a point by its two coordinates, and keeps the edit's bookkeeping out of the facts", () => {
    const rows = actRows(act('location_edited', {
      location: { old: { lat: 34.006111111111, lon: 36.208611111111 }, new: { lat: 34.006440556697925, lon: 36.2065162893291 } },
      locationId: 14700, anchorMoved: true,
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ before: '34.006111111111, 36.208611111111', after: '34.006440556697925, 36.2065162893291' });
    // Which of a serial site's points, as the History has always named it.
    expect(rows[0].fact).toMatch(/^Place #14700 · /);
  });

  it("corrects a work's makers as two lists", () => {
    const [row] = actRows(act('work_edited', { artists: { old: ['Nicolas Cordier', 'Agasias of Ephesus'], new: ['Agasias of Ephesus'] }, treasureId: 2443 }));
    expect(row.after).toBe('Agasias of Ephesus');
    expect(row.before).toContain('Nicolas Cordier');
    expect(row.fact).toMatch(/^Work #2443 · /);
  });

  it("says the source's value taken was over a value the log never recorded", () => {
    const [row] = actRows(act('accepted_source', { fields: [{ field: 'metadata.commemorates', applied: { via: 'memorials-category', subjects: [{ item: 'Q361', label: 'World War I' }] } }] }));
    expect(row).toMatchObject({ before: null, after: 'World War I' });
  });

  it('reads a verdict as the place in or out of its kind, and marks the calls against the rule', () => {
    const putBack = act('admission_overridden', { reason: 'below the surroundings tier’s cut', pinned: true, membershipId: 152296 }, 'Places of worship');
    expect(actRows(putBack)).toEqual([
      { fact: 'Places of worship', before: 'Out, by the rule', after: 'In' },
      { fact: null, note: 'Remembered on later runs' },
    ]);
    expect(againstTheRule(putBack)).toBe(true);

    const refused = act('arrival_refused', { reason: 'kept out by a curator', membershipId: 155469, note: null }, 'Bridges & engineering marvels');
    expect(actRows(refused)).toEqual([{ fact: 'Bridges & engineering marvels', before: 'In, by the rule', after: 'Out' }]);
    expect(againstTheRule(refused)).toBe(true);
    expect(actWhy(refused)).toBeNull();

    const confirmed = act('admission_confirmed', { reason: 'no monument or memorial class', membershipId: 1 }, 'Monuments & memorials');
    expect(actRows(confirmed)[0]).toMatchObject({ before: 'Out, by the rule', after: 'Out' });
    expect(againstTheRule(confirmed)).toBe(false);
    expect(actWhy(confirmed)).toBeTruthy();
  });

  it('says "Its kind" for a verdict logged before the log named the membership', () => {
    expect(actRows(act('admission_overridden', { reason: 'not an artwork, and typed: guardhouse', note: null }))[0])
      .toEqual({ fact: 'Its kind', before: 'Out, by the rule', after: 'In' });
  });

  it('names where an arrival went when a curator answered that it belongs in another kind', () => {
    const [row] = actRows(act('arrival_refused', { movedTo: { kind: 'Monuments & memorials' }, membershipId: 1 }, 'Public art'));
    expect(row.after).toBe('Out, into Monuments & memorials');
  });

  it("keeps the curator's own words for the row's Why", () => {
    expect(actNote(act('kept_out', { kind: 'Archaeology', note: '  Nothing a visitor can see or enter.  ', reason: 'kept out by a curator' })))
      .toBe('Nothing a visitor can see or enter.');
  });

  it('keeps the History sentence for an act with no fact to lay out', () => {
    // A merge keeps its sentence: it names the kinds the merge moved, which no two columns hold.
    const [row] = actRows(act('merged', { foldedId: 1430, foldedName: 'Torre de Hércules', survivorId: 761, survivorName: 'Tower of Hercules' }));
    expect(row.fact).toBeNull();
    expect(row.note).toBeTruthy();
  });

  it("lays a whole's parts out as before and after: a list line moved, a part taken out", () => {
    expect(actRows(act('part_replaced', {
      lineName: 'Rotunda', reference: '456-002', wholeName: 'Paleochristian and Byzantine Monuments of Thessalonika',
      fromName: 'Arch of Galerius and Rotunda', toName: 'Rotunda',
    }))).toEqual([{ fact: 'Rotunda (456-002) in Paleochristian and Byzantine Monuments of Thessalonika', before: 'Arch of Galerius and Rotunda', after: 'Rotunda' }]);
    expect(actRows(act('part_taken_out', { partName: 'Giralda', wholeName: 'Cathedral, Alcázar and Archivo de Indias in Seville', keptOut: false })))
      .toEqual([{ fact: 'Part of Cathedral, Alcázar and Archivo de Indias in Seville', before: 'Giralda', after: 'No' }]);
  });

  it('names a fact with a capital, as a column heads it', () => {
    expect(actRows(act('published', { fields: ['metadata.commemorates'] }))[0].fact).toBe('Commemorates');
  });

  it('publishes a run\'s fields from waiting to shown, and a whole arrival under its kind', () => {
    expect(actRows(act('published', { scope: 'fields', fields: ['metadata.commemorates'] }))[0])
      .toMatchObject({ before: 'Waiting', after: 'Shown to readers' });
    expect(actRows(act('published', { fields: [], parts: [] }, 'Squares & streets'))[0])
      .toEqual({ fact: 'Squares & streets', before: 'Waiting', after: 'Shown to readers' });
  });
  it("shows what taking the source's value did beside the field: a pin moved back, a credit dropped", () => {
    const rows = actRows(act('accepted_source', {
      fields: [{ field: 'image_url', applied: 'https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg' }],
      movedPoints: [14700], releasedCredit: true,
    }));
    expect(rows.map((r) => r.note)).toEqual(expect.arrayContaining(['1 point moved back to the source’s coordinate', 'Picture credit dropped with it']));
  });

  it('reads a publication of contents alone as what it released, never as the place appearing', () => {
    const rows = actRows(act('published', { scope: 'contents', fields: [], locations: 2, treasures: 0, withdrawalsReleased: 0 }, 'World Heritage Sites'));
    expect(rows.find((r) => r.after === 'Shown to readers')).toBeUndefined();
    expect(rows.map((r) => r.note)).toEqual(['2 points now visible']);
  });

  it('keeps the fields a publication left as the curator wrote them, and what it left waiting', () => {
    const notes = actRows(act('published', { fields: ['name'], claimedFieldsSkipped: ['metadata.commemorates'], heldLeftOpen: 1 })).map((r) => r.note);
    expect(notes).toEqual(expect.arrayContaining(['Kept as the curator wrote it', 'Left waiting: 1']));
  });

  it('says whether a put-back is remembered on later runs or lasts until the next one', () => {
    expect(actRows(act('admission_overridden', { pinned: true }, 'Places of worship'))[1].note).toBe('Remembered on later runs');
    expect(actRows(act('admission_overridden', { pinned: false }, 'Places of worship'))[1].note).toBe('For now: the next run applies the rule again');
  });

  it('keeps the whole record of an act whose rows lay out only part of it', () => {
    const added = act('kind_added', { kind: 'Monuments & memorials', kindId: 6, type: 'monument', fromArrival: { kind: 'Public art', stays: false } });
    expect(actRecord(added)).toMatch(/from its arrival in Public art/i);
    expect(actRecord(act('merged', { foldedId: 1, foldedName: 'A', survivorId: 2, survivorName: 'B' }))).toBeNull();
  });

  it("keeps what the part writers record, with their ids, on a row or under it", () => {
    // partRecordController's details for a place made a whole by its first part.
    const added = act('part_added', { wholeId: 21160, partId: 21161, recordId: 9001, partName: 'Giralda', wholeName: 'Cathedral of Seville', becameWhole: true, note: null });
    expect(actRows(added)).toContainEqual({ fact: 'Cathedral of Seville', before: 'One place', after: 'A place made of parts' });
    // partLineController's details for a line moved off a place a source still names.
    const moved = act('part_replaced', {
      recordId: 9002, fromId: 1, fromName: 'Arch of Galerius and Rotunda', toId: 2, toName: 'Rotunda', wholeId: 3,
      wholeName: 'Paleochristian and Byzantine Monuments of Thessalonika', lineName: 'Rotunda', reference: '456-002',
      keptOut: true, refusalId: 7, points: 1, note: null,
    });
    expect(actRows(moved).map((r) => r.note)).toContain('Arch of Galerius and Rotunda kept out while a source still names it');
    // keepOutController's details: the row says it all, and More has nothing to add.
    expect(actRecord(act('kept_out', { membershipId: 5278, kind: 'Archaeology', reason: 'kept out by a curator', note: 'Nothing to see' }, 'Archaeology'))).toBeNull();
    expect(actRecord(act('kind_added', { membershipId: 1, kind: 'Monuments & memorials', kindId: 6, type: 'monument', note: null }))).toBeNull();
  });

  it("keeps every part of a gated run's proposal turned down, and what the card still holds open", () => {
    // declineHeldController's details, as for the Sacred City of Caral-Supe's website.
    const withFields = actRows(act('declined_held', {
      fields: [{ field: 'metadata.website', declined: 'http://www.caralperu.gob.pe/nueva/principal_ing.html' }],
      parts: [], fromSyncLogId: 426, heldLeftOpen: 2, movedPointRefused: 14700,
    }));
    expect(withFields.map((r) => r.note)).toEqual([
      'Turned down the run’s: http://www.caralperu.gob.pe/nueva/principal_ing.html',
      'The moved point turned down with it',
      '2 still waiting on this card',
    ]);
    const partsAlone = act('declined_held', {
      fields: [], parts: [{ name: 'Torre del Oro', field: 'image_url', declined: 'https://commons.wikimedia.org/wiki/Special:FilePath/T.jpg' }],
      fromSyncLogId: 427, heldLeftOpen: 0, movedPointRefused: null,
    });
    expect(actRows(partsAlone)).toHaveLength(1);
    expect(actRows(partsAlone)[0].fact).toMatch(/^Torre del Oro · /);
    expect(actRecord(partsAlone)).toBeNull();
  });

  it("lays out a part's fields a publication applied, and says no place appeared", () => {
    // publishController's details for a work's renamed title, the place itself already shown.
    const rows = actRows(act('published', { scope: 'fields', fields: [], claimedFieldsSkipped: [], parts: [{ kind: 'treasures', name: 'The Surrender of Breda', fields: ['name'], claimedFieldsSkipped: [] }], locations: 0, treasures: 0 }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ before: 'Waiting', after: 'Shown to readers' });
    expect(rows[0].fact).toMatch(/^The Surrender of Breda · /);
  });

  it("shows a fallback act's note once, beside the row, not in its sentence too", () => {
    const [row] = actRows(act('contents_refused', { locations: 2, treasureLinks: 0, note: 'Two pins in the sea' }));
    expect(row.note).not.toContain('Two pins in the sea');
  });

  it('says nothing twice: an edit has no record beyond its rows, and a verdict none beyond its reason, note and pin', () => {
    expect(actRecord(act('edited', { name: { old: 'Bulguksa', new: 'Bulguksa Temple' } }))).toBeNull();
    expect(actRecord(act('admission_overridden', { reason: 'not an artwork', note: 'A guardhouse that is the memorial', pinned: true }))).toBeNull();
    const batch = actRecord(act('admission_pin_released', { membershipId: 42223, kind: 'Monuments & memorials', reason: 'no monument class', systemNote: 'released when the batch answer of 14 September 2026 was read', note: null }));
    expect(batch).toContain('released when the batch answer');
    expect(batch).not.toContain('no monument class');
  });

  it('compares two long values whole, never clipped to the same forty characters', () => {
    const before = 'A long description that runs past forty characters and then says one thing';
    const after = 'A long description that runs past forty characters and then says another';
    const [row] = actRows(act('edited', { description: { old: before, new: after } }));
    expect([row.before, row.after]).toEqual([before, after]);
  });
});
