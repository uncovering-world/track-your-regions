/**
 * The point dialog's two references (#2206): Nominatim's answer read as a
 * name, an address and an area, and a place's article read by the place,
 * never by a link the caller sends.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/index.js', () => ({ pool: { query: vi.fn() } }));
vi.mock('../services/wikipediaCoordinate.js', () => ({ articleCoordinate: vi.fn() }));

import { pool } from '../db/index.js';
import { articleCoordinate } from '../services/wikipediaCoordinate.js';
import { articlePoint, placeAtPointOf } from './pointReferenceController.js';

const query = pool.query as unknown as ReturnType<typeof vi.fn>;
const coordinate = articleCoordinate as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  query.mockReset();
  coordinate.mockReset();
});

describe('placeAtPointOf', () => {
  it('names a named object with its street and its area, and links it on openstreetmap.org', () => {
    expect(placeAtPointOf({
      osm_type: 'way', osm_id: 26965478, category: 'highway', type: 'residential', name: 'Αχιλλέα',
      address: { road: 'Αχιλλέα', suburb: 'Άγιος Παύλος', city: 'Thessaloniki' },
    })).toEqual({
      name: 'Αχιλλέα', street: 'Αχιλλέα', area: 'Άγιος Παύλος', category: 'highway', type: 'residential',
      osmUrl: 'https://www.openstreetmap.org/way/26965478',
    });
  });

  it('reads an unnamed building by its address', () => {
    expect(placeAtPointOf({
      osm_type: 'way', osm_id: 759002052, category: 'building', type: 'yes', name: '',
      address: { house_number: '6', road: 'Π. Παπαγεωργίου', suburb: 'Kamara' },
    })).toMatchObject({ name: null, street: '6 Π. Παπαγεωργίου', area: 'Kamara', category: 'building', type: 'yes' });
  });

  it('holds nothing where Nominatim holds nothing', () => {
    expect(placeAtPointOf({})).toEqual({ name: null, street: null, area: null, category: null, type: null, osmUrl: null });
  });
});

describe('articlePoint', () => {
  it('reads the article the place links to, and its coordinate', async () => {
    query.mockResolvedValue({ rows: [{ id: 40144, article: 'https://en.wikipedia.org/wiki/Church_of_the_Acheiropoietos' }] });
    coordinate.mockResolvedValue({ latitude: 40.6347, longitude: 22.9478 });
    expect(await articlePoint({ params: { id: 40144 } })).toEqual({
      article: 'https://en.wikipedia.org/wiki/Church_of_the_Acheiropoietos',
      coordinate: { latitude: 40.6347, longitude: 22.9478 },
    });
    expect(query.mock.calls[0][1]).toEqual([40144]);
  });

  it('asks no wiki for a place that links no article', async () => {
    query.mockResolvedValue({ rows: [{ id: 1, article: null }] });
    expect(await articlePoint({ params: { id: 1 } })).toEqual({ article: null, coordinate: null });
    expect(coordinate).not.toHaveBeenCalled();
  });

  it('answers 404 for a place that does not exist', async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(articlePoint({ params: { id: 999999 } })).rejects.toMatchObject({ statusCode: 404 });
  });
});
