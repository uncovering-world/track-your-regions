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
    const held = { ...item, kind: 'held' as const, proposed: [{ field: 'location', old: { lat: 37.9395, lng: 27.3417 }, new: { lat: 37.9411, lng: 27.3420 } }] };
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
      proposed: [{ field: 'imageUrl', old: null, new: 'https://commons.wikimedia.org/wiki/Special:FilePath/Capitoline_Museums.jpg' }],
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

describe('a held row names only the facts its card asks about (#1774)', () => {
  it('leaves out a fact empty on both sides', () => {
    // The Reina Sofía's held card from Art Museums run 177: an empty list of makers
    // stored and none proposed, beside a year the run no longer gives.
    const held = contents({
      id: 1438, name: 'Museo Nacional Centro de Arte Reina Sofía', kind: 'held', kind_name: 'Art Museums',
      proposed: [{ field: 'metadata.creators', old: [], new: undefined }, { field: 'metadata.year', old: 1992, new: null }],
    });
    expect(rowSpecific({ kind: 'waiting', sections: [{ id: 1438, name: held.name, held }] })).toBe('year');
  });

  it('counts only the parts the card draws a group for', () => {
    const held = contents({
      id: 1438, name: 'Museo Nacional Centro de Arte Reina Sofía', kind: 'held', kind_name: 'Art Museums',
      proposed: [{ field: 'metadata.year', old: 1992, new: null }],
      proposed_parts: [{
        kind: 'treasures', item: { name: 'Guernica', ref: 'Q175036' },
        fields: [{ field: 'artists', old: [], new: undefined }],
      }] as ReviewQueueItem['proposed_parts'],
    });
    expect(rowSpecific({ kind: 'waiting', sections: [{ id: 1438, name: held.name, held }] })).toBe('year');
  });

  it('does not call a held section that asks nothing a new arrival', () => {
    // Two kinds ask about the place; the held one carries only a fact with no value on
    // either side, so it names nothing, and the line still says it holds a change.
    const arrival = contents({ name: 'Capitoline Museums', kind: 'arrival', kind_name: 'Archaeology' });
    const held = contents({
      name: 'Capitoline Museums', kind: 'held', kind_name: 'Art Museums',
      proposed: [{ field: 'metadata.creators', old: [], new: undefined }],
    });
    expect(rowSpecific({
      kind: 'waiting',
      sections: [
        { id: 6214, name: 'Capitoline Museums', membershipId: 1, arrival },
        { id: 6214, name: 'Capitoline Museums', membershipId: 2, held },
      ],
    })).toBe('Archaeology: new arrival; Art Museums: holds a change');
  });
});

