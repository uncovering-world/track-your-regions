import { describe, it, expect } from 'vitest';
import type { ReviewQueueItem } from '../../../api/reviewQueue';
import { rowSpecific } from './rowSpecific';

/** A visible object with unread contents, as the queue sends it. */
function contents(extra: Partial<ReviewQueueItem>): ReviewQueueItem {
  return {
    id: 14724, external_id: 'Q47611', name: 'Ephesus', kind_id: 5, kind_name: 'Archaeology',
    missing_since: null, source_membership: 'present', existence: 'extant',
    kind: 'contents', proposed: null,
    pending_locations: 0, pending_treasures: 0, pending_points: [], pending_works: [],
    ...extra,
  };
}

function line(item: ReviewQueueItem, held?: ReviewQueueItem): string {
  return rowSpecific({ kind: 'waiting', sections: [{ id: item.id, name: item.name, contents: item, held }] });
}

describe('a waiting row counts its contents as the card does', () => {
  it('names what arrived and leaves out a count of nothing', () => {
    // Boy with Thorn, unread under the Capitoline Museums' Archaeology row.
    expect(line(contents({ name: 'Capitoline Museums', pending_treasures: 1 }))).toBe('1 work arrived');
  });

  it('tells new points from moved ones', () => {
    expect(line(contents({ pending_locations: 3, pending_moved_locations: 1 }))).toBe('2 new points, 1 point moved');
  });

  it('does not count the point the held coordinate takes along a second time', () => {
    // Ephesus, run 146: the coordinate and its one point are one move, asked once
    // on the coordinates row, which the line already names.
    const item = contents({ pending_locations: 1, pending_moved_locations: 1, coordinates_move_point_id: 15624 });
    const held = { ...item, kind: 'held' as const, proposed: [{ field: 'location', old: null, new: null }] };
    expect(line(item, held)).toBe('coordinates');
  });
});

describe('a waiting row two kinds ask about (#1264)', () => {
  it('names each kind with its own question', () => {
    // The Capitoline Museums: an Archaeology run has just brought them, while
    // their Art Museums membership holds a new picture.
    const arrival = contents({ name: 'Capitoline Museums', kind: 'arrival', kind_name: 'Archaeology' });
    const held = contents({
      name: 'Capitoline Museums', kind: 'held', kind_name: 'Art Museums',
      proposed: [{ field: 'imageUrl', old: null, new: null }],
    });
    expect(rowSpecific({
      kind: 'waiting',
      sections: [
        { id: 6214, name: 'Capitoline Museums', membershipId: 1, arrival },
        { id: 6214, name: 'Capitoline Museums', membershipId: 2, held },
      ],
    })).toBe('Archaeology: new arrival; Art Museums: picture');
  });
});
