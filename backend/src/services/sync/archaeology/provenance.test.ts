import { describe, expect, it } from 'vitest';
import type { OsmObject } from '../osm/types.js';
import { withNamed } from './siteEntrance.js';
import { extentProvenanceOf, provenanceOf } from './sites.js';

/** Which door and time a site's `metadata.osm` names, read from the object its verdict came from (ADR-0134 decision 5). */

const object = (ref: string, source?: OsmObject['source']): OsmObject => ({
  ref, kind: 'way', tags: { historic: 'archaeological_site' }, geometryType: 'POLYGON', wkt: null, ...(source ? { source } : {}),
});

describe('provenanceOf', () => {
  it('names the layer and the instant it is current to, for an object the layer answered', () => {
    expect(provenanceOf([object('way/10', { door: 'local', asOf: '2026-10-22T00:00:00.000Z' })], 'way/10', '2026-10-30T09:00:00.000Z'))
      .toEqual({ door: 'local', readAt: '2026-10-22T00:00:00.000Z' });
  });

  it('names Overpass and when it was asked, for an object the layer could not vouch for', () => {
    expect(provenanceOf([object('way/77', { door: 'overpass', asOf: '2026-10-30T09:01:00.000Z' })], 'way/77', '2026-10-30T09:00:00.000Z'))
      .toEqual({ door: 'overpass', readAt: '2026-10-30T09:01:00.000Z' });
  });

  it('names the run\'s time and leaves the door to the run where the objects name no source', () => {
    expect(provenanceOf([object('way/10')], 'way/10', '2026-10-30T09:00:00.000Z')).toEqual({ readAt: '2026-10-30T09:00:00.000Z' });
  });

  it('names Overpass for a verdict read from an object only the enumeration brought, beside the layer\'s', () => {
    const objects = [
      object('node/1', { door: 'local', asOf: '2026-10-13T00:00:00.000Z' }),
      object('way/5', { door: 'overpass', asOf: '2026-10-22T09:00:00.000Z' }),
    ];
    expect(provenanceOf(objects, 'way/5', '2026-10-22T08:59:00.000Z')).toEqual({ door: 'overpass', readAt: '2026-10-22T09:00:00.000Z' });
  });

  it('reads a site nothing decided from the source of its objects', () => {
    expect(provenanceOf([object('node/1', { door: 'local', asOf: '2026-10-22T00:00:00.000Z' })], null, '2026-10-30T09:00:00.000Z'))
      .toEqual({ door: 'local', readAt: '2026-10-22T00:00:00.000Z' });
  });
});

describe('extentProvenanceOf', () => {
  const tumulus = object('way/1069114387', { door: 'overpass', asOf: '2026-10-30T09:01:00.000Z' });
  const zone = object('way/974945296', { door: 'local', asOf: '2026-10-21T00:00:00.000Z' });

  it('names the extent\'s own door and time where it came through another door than the verdict (Nemrut on a stale layer)', () => {
    expect(extentProvenanceOf([zone, tumulus], { object: 'way/1069114387', extentFrom: 'way/974945296' }, '2026-10-30T09:00:00.000Z'))
      .toEqual({ extentDoor: 'local', extentReadAt: '2026-10-21T00:00:00.000Z' });
  });

  it('adds nothing where the extent and the verdict share a door and a time, or are one object', () => {
    const other = object('way/5', { door: 'local', asOf: '2026-10-21T00:00:00.000Z' });
    expect(extentProvenanceOf([zone, other], { object: 'way/5', extentFrom: 'way/974945296' }, '2026-10-30T09:00:00.000Z')).toEqual({});
    expect(extentProvenanceOf([zone], { object: 'way/974945296', extentFrom: 'way/974945296' }, '2026-10-30T09:00:00.000Z')).toEqual({});
    expect(extentProvenanceOf([zone], { object: 'way/974945296', extentFrom: null }, '2026-10-30T09:00:00.000Z')).toEqual({});
  });
});

describe('withNamed across two doors', () => {
  it('keeps the per-item copy whole where the enumeration brought the same object through another door', () => {
    const layer = { ...object('way/10', { door: 'local', asOf: '2026-10-21T00:00:00.000Z' }), tags: { historic: 'archaeological_site' } };
    const live = { ...object('way/10', { door: 'overpass', asOf: '2026-10-30T09:01:00.000Z' }), tags: { historic: 'archaeological_site', ruins: 'yes' } };
    expect(withNamed([layer], [live])).toEqual([layer]);
  });

  it('merges the tags of two copies that came through one door, as before', () => {
    const one = { ...object('way/10'), tags: { historic: 'archaeological_site' } };
    const two = { ...object('way/10'), tags: { ruins: 'yes' } };
    expect(withNamed([one], [two])[0].tags).toEqual({ historic: 'archaeological_site', ruins: 'yes' });
  });
});
