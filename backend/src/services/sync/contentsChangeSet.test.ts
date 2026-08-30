/**
 * Tests for the per-item diff, written against what the sources actually did.
 *
 * Every case below is a real one, measured on 2026-08-20 by re-comparing the
 * catalogue against both live sources: 6264 UNESCO components and a sample of 120
 * works. Two renames and eleven moves came out of that, and the shape of those
 * eleven is what the thresholds here have to get right — six of them were one site
 * re-surveyed, which is a question worth asking, and the rest were metres.
 */

import { describe, it, expect } from 'vitest';
import { pointChanges, workChanges } from './contentsChangeSet.js';

const BOMA = { name: 'Boma-Badingilo Migratory Landscape', lon: 31.5, lat: 6.1 };

describe('pointChanges', () => {
  it('says nothing about a name the source only re-typeset', () => {
    // The real one: a hyphen became an en dash between two runs. A card asking a
    // curator to rule on that is a card that teaches them to skim.
    expect(pointChanges(BOMA, { ...BOMA, name: 'Boma–Badingilo Migratory Landscape' })).toEqual([]);
  });

  it('reports a name that lost its subtitle', () => {
    // The other real rename: the source dropped everything after the colon.
    const before = { name: 'Village de Sidi Bou Saïd : Hub d’inspiration Culturelle', lon: 10.3, lat: 36.8 };
    const changes = pointChanges(before, { ...before, name: 'Village de Sidi Bou Saïd' });

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ field: 'name', significance: 'minor' });
  });

  it('says nothing when a claimed name meets a source that offers none', () => {
    // `upsertSingleLocation` writes `name: null` for the one point of every museum
    // and every landmark — a venue's point has no name of its own — so this is not
    // a proposal to blank the label, it is silence about it. Reported, a curator
    // who names such a point gets "renamed, kept over the source" on every run for
    // ever, about something Wikidata never said.
    const named = { name: 'Main entrance', lon: 4.0, lat: 49.0 };
    expect(pointChanges(named, { ...named, name: null }, ['name'])).toEqual([]);

    // Unclaimed, the same null still reports: there the writer really does blank
    // the stored name, and a record that hid it would describe a different run.
    expect(pointChanges(named, { ...named, name: null })).toHaveLength(1);
  });

  it('ignores a coordinate rewritten more precisely', () => {
    // ADR-0027's ten metres, asked of a component instead of an object — one
    // arithmetic for both, or a site and its parts disagree about what a move is.
    expect(pointChanges(BOMA, { ...BOMA, lat: BOMA.lat + 0.00005 })).toEqual([]);
  });

  it('calls a re-survey major and a small correction minor', () => {
    // 1465-001 moved 2.0 km when Champagne Hillsides was re-surveyed; the small
    // one is the shape of the other five moves that fortnight.
    const far = pointChanges(BOMA, { ...BOMA, lat: BOMA.lat + 0.02 });
    expect(far).toHaveLength(1);
    expect(far[0]).toMatchObject({ field: 'location', significance: 'major' });

    const near = pointChanges(BOMA, { ...BOMA, lat: BOMA.lat + 0.0005 });
    expect(near[0]).toMatchObject({ field: 'location', significance: 'minor' });
  });

  it('marks what a curator had claimed, by the column name the claim uses', () => {
    const changes = pointChanges(
      BOMA,
      { name: 'Something else entirely', lon: BOMA.lon, lat: BOMA.lat + 0.02 },
      ['location'],
    );

    expect(changes.find(c => c.field === 'location')).toMatchObject({ curatedConflict: true });
    expect(changes.find(c => c.field === 'name')).toMatchObject({ curatedConflict: false });
    // Nothing held: the caller said the row was not under the gate.
    expect(changes.every(c => c.held === false)).toBe(true);
  });

  it('says the gate held a rename on a point readers can already see', () => {
    // Château de Montésgur → Château de Montségur: a typo fix from the source
    // that landed on a gated category without anyone looking (#717). Under
    // ADR-0037 the writer keeps the stored name, and this is how it says so.
    const before = { name: 'Château de Montésgur', lon: 1.83, lat: 42.88 };
    const changes = pointChanges(before, { ...before, name: 'Château de Montségur' }, [], true);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ field: 'name', held: true, curatedConflict: false });
  });

  it('lets a claim win over the hold, as the object diff does', () => {
    // The claim is the narrower and separately answerable refusal: accept-source
    // owns it, and publishing leaves a claimed field alone — so a field carrying
    // both would raise two contradictory cards over one value (changeSet.ts).
    const changes = pointChanges(
      BOMA,
      { name: 'Something else entirely', lon: BOMA.lon, lat: BOMA.lat + 0.02 },
      ['location'],
      true,
    );

    expect(changes.find(c => c.field === 'location')).toMatchObject({ curatedConflict: true, held: false });
    expect(changes.find(c => c.field === 'name')).toMatchObject({ curatedConflict: false, held: true });
  });

  it('stamps the hold on the name alone, since the coordinate is written whatever the gate says', () => {
    // The writer's guard covers `name`; the keeping arm adopts the source's
    // coordinate regardless (ADR-0027 decision 4). A kept row is within the
    // pairing's ten metres, but the pairing measures on the spheroid and this
    // diff on a sphere, and the two disagree by up to 0.6 % — so a point kept at
    // 9.95 m can still report a move here, and a `location` entry stamped held
    // would be one publishing cannot write: a card no answer clears.
    const changes = pointChanges(
      BOMA,
      { name: 'Something else entirely', lon: BOMA.lon, lat: BOMA.lat + 0.0001 },
      [],
      true,
    );

    expect(changes.find(c => c.field === 'name')).toMatchObject({ held: true });
    expect(changes.find(c => c.field === 'location')).toMatchObject({ held: false, curatedConflict: false });
  });
});

const MONA = {
  name: 'Mona Lisa', artist: 'Leonardo da Vinci', year: 1503,
  imageUrl: 'https://commons.wikimedia.org/mona.jpg',
};

describe('workChanges', () => {
  it('says nothing when the source repeats itself', () => {
    // What the measurement found for all 120 sampled works: nothing had moved.
    expect(workChanges(MONA, { ...MONA })).toEqual([]);
  });

  it('calls a change of attribution major and the rest description', () => {
    const reattributed = workChanges(MONA, { ...MONA, artist: 'Workshop of Leonardo da Vinci' });
    expect(reattributed).toHaveLength(1);
    expect(reattributed[0]).toMatchObject({ field: 'artist', significance: 'major' });

    // A traveller stands in front of a work because of who made it; a year
    // settling down and a better photograph are the catalogue tidying itself.
    expect(workChanges(MONA, { ...MONA, year: 1506 })[0]).toMatchObject({ significance: 'minor' });
    expect(workChanges(MONA, { ...MONA, imageUrl: null })[0])
      .toMatchObject({ field: 'image_url', significance: 'minor' });
  });

  it('treats an absent year the same whichever way it is absent', () => {
    expect(workChanges({ ...MONA, year: null }, { ...MONA, year: undefined as unknown as null }))
      .toEqual([]);
  });

  it('says the gate held a re-attribution on a work readers can already see', () => {
    // The Wine Glass, Gemäldegalerie: Wikidata moved the attribution from
    // Johannes Vermeer to an obscure namesake, and run 64 wrote it live under a
    // gated category (#717). Held, the card asks; written, nobody was asked.
    const glass = { ...MONA, name: 'The Wine Glass', artist: 'Johannes Vermeer', year: 1660 };
    const changes = workChanges(
      glass, { ...glass, artist: 'Jan Vermeer van Haarlem the Elder' }, [], true,
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ field: 'artist', significance: 'major', held: true });
  });

  it('holds every unclaimed field of a work at once, and none of the claimed ones', () => {
    const changes = workChanges(
      MONA, { ...MONA, artist: 'Workshop', year: 1506, imageUrl: null }, ['artist'], true,
    );

    expect(changes.find(c => c.field === 'artist')).toMatchObject({ curatedConflict: true, held: false });
    expect(changes.find(c => c.field === 'year')).toMatchObject({ curatedConflict: false, held: true });
    expect(changes.find(c => c.field === 'image_url')).toMatchObject({ curatedConflict: false, held: true });
  });
});
