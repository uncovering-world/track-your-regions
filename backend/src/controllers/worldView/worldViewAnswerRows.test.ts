import { describe, expect, it } from 'vitest';
import { DeleteImpact, WorldView } from '../../api/responses/worldViews.js';
import { deleteImpactOf, worldViewOf } from './worldViewAnswerRows.js';

describe('worldViewOf', () => {
  it('reads a world view whose tile version was never bumped as version 0', () => {
    const worldView = worldViewOf({
      id: 1, name: 'GADM', description: null, source: null, is_default: true, is_public: true, tile_version: null,
    });
    expect(worldView.tileVersion).toBe(0);
    expect(WorldView.safeParse(worldView).success).toBe(true);
  });
});

describe('deleteImpactOf', () => {
  it('reads a world view whose default flag is null as not the default', () => {
    const impact = deleteImpactOf({ region_count: 3831, experience_assignment_count: 11817, user_visit_count: 0 }, null);
    expect(impact.isDefault).toBe(false);
    expect(DeleteImpact.safeParse(impact).success).toBe(true);
  });
});
