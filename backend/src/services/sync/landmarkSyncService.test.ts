/**
 * What one answer from the landmark queries becomes.
 *
 * The grouping is the whole of it, and it is where a monument's maker used to be
 * decided by accident: five OPTIONALs mean a monument with several creators
 * arrives several times, and each row used to become a landmark of its own that
 * then raced its twins into the same row (#720).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import { bindingsToLandmarks, fetchMonuments } from './landmarkSyncService.js';
import type { SparqlBinding } from './wikidataUtils.js';

const ENTITY = 'http://www.wikidata.org/entity/';

function row(qid: string, label: string, creator?: string, image?: string): SparqlBinding {
  const binding: SparqlBinding = {
    item: { value: `${ENTITY}${qid}` },
    itemLabel: { value: label },
    coord: { value: 'Point(-43.2105 -22.9519)' },
    sitelinks: { value: '60' },
  };
  if (creator) binding.creatorLabel = { value: creator };
  if (image) binding.image = { value: image };
  return binding;
}

describe('bindingsToLandmarks', () => {
  it('makes one landmark of a monument the answer names several times', () => {
    // Christ the Redeemer is Landowski's statue on Oswald's design; before this
    // it arrived as two monuments and the second overwrote the first.
    const landmarks = bindingsToLandmarks([
      row('Q79961', 'Christ the Redeemer', 'Paul Landowski'),
      row('Q79961', 'Christ the Redeemer', 'Carlos Oswald'),
    ], 'monument');

    expect(landmarks).toHaveLength(1);
    expect(landmarks[0].creators).toEqual(['Paul Landowski', 'Carlos Oswald']);
  });

  it('keeps all seven makers of the Fountain of Cybele', () => {
    const makers = [
      'Roberto Michel', 'Antoni Parera i Saurina', 'Francisco Gutiérrez Arribas',
      'Manuel Herrero Palacios', 'Miguel Ángel Trilles',
      'Francisco Miguel Ximénez de Alanís', 'José López Salaberry',
    ];
    const landmarks = bindingsToLandmarks(
      makers.map(maker => row('Q2736564', 'Fountain of Cybele', maker)), 'monument',
    );

    expect(landmarks).toHaveLength(1);
    expect(landmarks[0].creators).toEqual(makers);
  });

  it('counts a maker once however many rows carry them', () => {
    const landmarks = bindingsToLandmarks([
      row('Q1601986', 'The Motherland Calls', 'Yevgeny Vuchetich', 'a.jpg'),
      row('Q1601986', 'The Motherland Calls', 'Nikolai Nikitin', 'a.jpg'),
      row('Q1601986', 'The Motherland Calls', 'Yevgeny Vuchetich', 'b.jpg'),
      row('Q1601986', 'The Motherland Calls', 'Nikolai Nikitin', 'b.jpg'),
    ], 'monument');

    expect(landmarks[0].creators).toEqual(['Yevgeny Vuchetich', 'Nikolai Nikitin']);
    // The first row still fixes everything single-valued about the monument.
    expect(landmarks[0].imageUrl).toBe('a.jpg');
  });

  it('drops a maker the label service could only answer with a QID', () => {
    // An entity with no label in any of the eight languages comes back as the
    // bare id. Collecting every creator is what makes it reachable at all: it
    // used to lose the race to a labelled co-creator.
    const landmarks = bindingsToLandmarks([
      row('Q79961', 'Christ the Redeemer', 'Paul Landowski'),
      row('Q79961', 'Christ the Redeemer', 'Q1234567'),
    ], 'monument');

    expect(landmarks[0].creators).toEqual(['Paul Landowski']);
  });

  it('leaves a monument nobody is recorded for with an empty list', () => {
    const landmarks = bindingsToLandmarks([row('Q1', 'An unattributed memorial')], 'monument');
    expect(landmarks[0].creators).toEqual([]);
  });

  it('drops a row with no coordinate, and keeps the item its siblings describe', () => {
    const landmarks = bindingsToLandmarks([
      { item: { value: `${ENTITY}Q79961` }, itemLabel: { value: 'Christ the Redeemer' } },
      row('Q79961', 'Christ the Redeemer', 'Paul Landowski'),
    ], 'monument');

    expect(landmarks).toHaveLength(1);
    expect(landmarks[0].creators).toEqual(['Paul Landowski']);
  });
});

describe('fetchMonuments', () => {
  /** A door that answers every type query with the same rows. */
  const answering = (rows: SparqlBinding[]) => (async () => rows) as never;
  const progress = () => ({ cancel: false, statusMessage: '' } as never);

  it('keeps every row a monument arrived on, across the four type queries', async () => {
    // The bug this closes: the collection map kept the *first* row per item, so a
    // monument with several makers had them thrown away before the grouping ever
    // saw them — and its stored creator was the planner's pick of the first row
    // of whichever type query answered first (#720).
    const landmarks = await fetchMonuments(progress(), answering([
      row('Q154987', 'Siegessäule', 'Anton von Werner'),
      row('Q154987', 'Siegessäule', 'Albert Wolff'),
      row('Q154987', 'Siegessäule', 'Friedrich Drake'),
    ]));

    expect(landmarks).toHaveLength(1);
    expect(landmarks[0].creators)
      .toEqual(['Anton von Werner', 'Albert Wolff', 'Friedrich Drake']);
  });

  it('still makes one monument of an item two type queries both offer', async () => {
    // A memorial that is also a cenotaph is one monument, which is what the map
    // across the four queries is for. Four identical answers, one landmark, and
    // its makers named once each.
    const landmarks = await fetchMonuments(progress(), answering([
      row('Q429007', 'Monument to the Ghetto Heroes', 'Nathan Rapoport'),
      row('Q429007', 'Monument to the Ghetto Heroes', 'Rudier Foundry'),
    ]));

    expect(landmarks).toHaveLength(1);
    expect(landmarks[0].creators).toEqual(['Nathan Rapoport', 'Rudier Foundry']);
  });
});
