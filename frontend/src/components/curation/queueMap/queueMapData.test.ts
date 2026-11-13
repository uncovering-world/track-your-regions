/**
 * The review queue's map as data (#2477): the colour and the count a marker is drawn
 * with, the place drawn as selected, the kinds the legend names and the key a question
 * opens its card by. The places are in Rome; their ids and questions are made up for the test.
 */

import { describe, expect, it } from 'vitest';
import type { QueueMapPlace } from '../../../api/reviewQueue';
import { KIND_COLOR } from '../queueRows';
import {
  chipKindOf, legendKinds, placeOfRow, questionColor, questionCount, questionRow, questionWord, queueMarkers,
  selectedMarker, spreadOf,
} from './queueMapData';

/** A place two kinds ask about: a conflict first, then a held change. */
const PANTHEON: QueueMapPlace = {
  placeId: 4120, lon: 12.47685, lat: 41.89861,
  questions: [{ kind: 'conflict', subs: [] }, { kind: 'waiting', subs: ['held'] }],
};
/** An arrival nobody has looked at. */
const SANTA_PRASSEDE: QueueMapPlace = {
  placeId: 88213, lon: 12.49845, lat: 41.89622,
  questions: [{ kind: 'waiting', subs: ['arrival'] }],
};
/** Works that arrived under a museum readers already see. */
const BORGHESE: QueueMapPlace = {
  placeId: 2011, lon: 12.49218, lat: 41.91420,
  questions: [{ kind: 'waiting', subs: ['contents'] }],
};

describe('a question’s word and colour', () => {
  it('names a waiting question by its sub-kind, as the Question chip does', () => {
    expect(chipKindOf({ kind: 'waiting', subs: ['arrival'] })).toBe('arrival');
    expect(chipKindOf({ kind: 'waiting', subs: ['contents'] })).toBe('contents');
    expect(chipKindOf({ kind: 'waiting', subs: ['held'] })).toBe('held');
    expect(chipKindOf({ kind: 'waiting', subs: ['held', 'contents'] })).toBe('held');
    expect(chipKindOf({ kind: 'conflict', subs: [] })).toBe('conflict');
  });

  it('draws a question in its kind’s colour, a waiting one in its sub-kind’s', () => {
    expect(questionColor({ kind: 'conflict', subs: [] })).toBe(KIND_COLOR.conflicts);
    expect(questionColor({ kind: 'waiting', subs: ['arrival'] })).toBe(KIND_COLOR.arrival);
    expect(questionColor({ kind: 'waiting', subs: ['contents'] })).toBe(KIND_COLOR.contents);
    expect(questionColor({ kind: 'waiting', subs: ['held'] })).toBe(KIND_COLOR.waiting);
    expect(questionColor({ kind: 'find-sites', subs: [] })).toBe(KIND_COLOR['find-sites']);
  });

  it('says a question in the chip’s words', () => {
    expect(questionWord({ kind: 'conflict', subs: [] })).toBe('disagreements');
    expect(questionWord({ kind: 'waiting', subs: ['arrival'] })).toBe('new arrivals');
  });
});

describe('the markers', () => {
  it('draws one marker per place, by its id, in its first question’s colour, with its count', () => {
    const { features } = queueMarkers([PANTHEON, SANTA_PRASSEDE, BORGHESE]);

    expect(features.map(f => [f.id, f.properties.color, f.properties.count])).toEqual([
      [4120, KIND_COLOR.conflicts, 2],
      [88213, KIND_COLOR.arrival, 1],
      [2011, KIND_COLOR.contents, 1],
    ]);
    expect(features[0].geometry.coordinates).toEqual([12.47685, 41.89861]);
  });

  it('draws the open question’s place as selected, whichever of its questions is open', () => {
    const places = [PANTHEON, SANTA_PRASSEDE];

    expect(selectedMarker(places, placeOfRow('waiting:4120')).features.map(f => f.id)).toEqual([4120]);
    expect(selectedMarker(places, placeOfRow('conflicts:4120')).features[0].properties)
      .toEqual({ color: KIND_COLOR.conflicts, count: 2 });
    // No row open, or a row whose place the chips leave off the map: nothing selected.
    expect(selectedMarker(places, placeOfRow(null)).features).toEqual([]);
    expect(selectedMarker(places, placeOfRow('missing:7')).features).toEqual([]);
  });

  it('opens a question by the list’s key of its row, a conflict as the list spells it', () => {
    expect(questionRow(PANTHEON, PANTHEON.questions[0])).toBe('conflicts:4120');
    expect(questionRow(PANTHEON, PANTHEON.questions[1])).toBe('waiting:4120');
    expect(placeOfRow('conflicts:4120')).toBe(4120);
    expect(placeOfRow('nonsense')).toBeNull();
  });
});

describe('the legend and the count', () => {
  it('names every kind the map draws once, in the chip’s order, a shared place’s second kind included', () => {
    expect(legendKinds([BORGHESE, SANTA_PRASSEDE, PANTHEON]).map(k => [k.key, k.word, k.color])).toEqual([
      ['conflict', 'disagreements', KIND_COLOR.conflicts],
      ['arrival', 'new arrivals', KIND_COLOR.arrival],
      ['held', 'holding a change', KIND_COLOR.waiting],
      ['contents', 'unread contents', KIND_COLOR.contents],
    ]);
    expect(legendKinds([])).toEqual([]);
  });

  it('counts every question, the ones with no point included', () => {
    expect(questionCount([PANTHEON, SANTA_PRASSEDE], 0)).toBe(3);
    expect(questionCount([PANTHEON], 2)).toBe(4);
  });

  it('frames every point as one shape, and nothing when there is none', () => {
    expect(spreadOf([PANTHEON, BORGHESE])?.geometry.coordinates).toEqual([[12.47685, 41.89861], [12.49218, 41.9142]]);
    expect(spreadOf([])).toBeNull();
  });
});
