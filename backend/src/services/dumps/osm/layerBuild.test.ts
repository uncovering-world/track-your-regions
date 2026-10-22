import { describe, expect, it } from 'vitest';
import { goneObjects } from './layerBuild.js';

/** What `osmium getid --verbose-ids` says of the objects it did not find, as osmium 1.18.0 writes it. */

describe('goneObjects', () => {
  it('reads how many objects osmium did not find, and their ids', () => {
    expect(goneObjects('[ 0:00] Closing input file...\n[ 0:00] Did not find 2 object(s).\nMissing node IDs: 999\nMissing way IDs: 888 889\n[ 0:00] Done.\n'))
      .toEqual({ count: 2, ids: ['n999', 'w888', 'w889'] });
  });

  it('answers nothing where osmium does not say an object is gone', () => {
    expect(goneObjects('Error: PBF error: invalid BlobHeader size\n')).toBeNull();
  });
});
