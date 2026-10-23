import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn(), connect: vi.fn() }, rollbackQuietly: vi.fn() }));

import { questionFor } from './pointHintSuggestionController.js';

/**
 * The question Jev is asked about a hint (#1913): the component, why the
 * list's point is rough, the hint with its source, distance and what its tags
 * say it is. Echmiatsin's Church of Saint Gayaneh, on the point three
 * components share, and OpenStreetMap's church carrying its reference 341 m off.
 */
const GAYANEH = {
  locationId: 10741, pointName: 'Church Saint Gayaneh and surrounding buildings', pointRef: '1011-002',
  reason: 'shared' as const, lat: 40.15931, lon: 44.29514,
  source: 'osm-ref' as const, ref: 'W194252618', label: 'Saint Gayane Church', metres: 341,
  tags: { name: 'Սուրբ Գայանե', amenity: 'place_of_worship', religion: 'christian', building: 'church', 'ref:whc': '1011-002' },
  hintLat: 40.1587, hintLon: 44.2925, stored: null,
};

describe('the question about a hint of where a rough component stands', () => {
  it('names the component, why its point is rough, and the hint with what its tags say it is', () => {
    const { instructions, criteria } = questionFor(GAYANEH);
    expect(instructions).toContain('"Church Saint Gayaneh and surrounding buildings" (reference 1011-002)');
    expect(instructions).toContain('the same point as other components');
    expect(instructions).toContain('"Saint Gayane Church" (W194252618)');
    expect(instructions).toContain('carries this component\'s World Heritage reference');
    expect(instructions).toContain('341 m from the listed point');
    expect(instructions).toContain('amenity=place_of_worship');
    expect(instructions).toContain('ref:whc=1011-002');
    // Its names are in the label already: not repeated from the tags.
    expect(instructions).not.toContain('Սուրբ Գայանե');
    expect(Object.keys(criteria)).toEqual(['same', 'other']);
  });

  it('asks about an item, which has no tags, without any', () => {
    const { instructions } = questionFor({ ...GAYANEH, source: 'item', ref: 'Q1450786', tags: null, reason: 'whole-minute' });
    expect(instructions).toContain('the whole minute of arc');
    expect(instructions).not.toContain('OpenStreetMap tags');
  });
});
