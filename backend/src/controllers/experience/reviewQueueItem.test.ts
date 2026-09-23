import { describe, expect, it } from 'vitest';
import { ReviewQueueItem } from '../../api/responses/reviewQueue.js';
import { queueItemOf, type QueueRow } from './reviewQueueItem.js';

/** Bamiyan Valley's conflict card, as the driver hands the row over. */
function conflictRow(over: Record<string, unknown> = {}): QueueRow {
  return {
    id: 208, external_id: '208', name: 'Cultural Landscape and Archaeological Remains of the Bamiyan Valley',
    kind_id: 1, kind_name: 'World Heritage Sites',
    missing_since: null, source_membership: 'present', existence: 'extant', kind: 'conflict',
    run_completed_at: new Date('2026-08-21T09:12:00.000Z'), sync_log_id: 98,
    proposed: [{
      field: 'name', old: 'Bamiyan Valley', new: 'Cultural Landscape of the Bamiyan Valley',
      significance: 'minor', curatedConflict: true, held: false, acceptable: true,
      claim: { by: 'a curator', at: '2026-08-04T15:01:24.341+00:00' }, decidedBefore: [],
      // What runs before 2026-08-31 stored beside the field.
      protectedByClaim: true,
    }],
    ...over,
  } as QueueRow;
}

describe('queueItemOf', () => {
  it('answers a card the schema accepts, the run time as an ISO string', () => {
    const card = queueItemOf(conflictRow());
    expect(card.run_completed_at).toBe('2026-08-21T09:12:00.000Z');
    expect(ReviewQueueItem.safeParse(JSON.parse(JSON.stringify(card))).success).toBe(true);
  });

  it('serves a proposed field without the writer key a run once stored beside it', () => {
    const [field] = queueItemOf(conflictRow()).proposed!;
    expect(field).not.toHaveProperty('protectedByClaim');
    expect(field).toMatchObject({ field: 'name', acceptable: true, claim: { by: 'a curator' } });
  });

  it('does not serve a column the schema does not name', () => {
    const card = queueItemOf(conflictRow({ source_id: 1 }));
    expect(JSON.parse(JSON.stringify(card))).not.toHaveProperty('source_id');
  });

  it('answers an arrival no run first saw, whose run is null', () => {
    // `first_seen_sync_log_id` is nullable, and the smoke lane's seeded
    // arrivals are two rows with none.
    const card = queueItemOf(conflictRow({ kind: 'arrival', proposed: null, curation_state: 'pending', sync_log_id: null }));
    expect(card.sync_log_id).toBeNull();
    expect(ReviewQueueItem.safeParse(JSON.parse(JSON.stringify(card))).success).toBe(true);
  });

  it('keeps a held part and maps its fields key by key', () => {
    const card = queueItemOf(conflictRow({
      kind: 'held',
      proposed: null,
      proposed_parts: [{
        kind: 'locations', item: { name: null, ref: '1239-003' }, storedName: 'Siemensstadt',
        fields: [{ field: 'name', old: null, new: 'Siemensstadt Housing', significance: 'minor', curatedConflict: false, held: true, protectedByClaim: false }],
      }],
    }));
    expect(card.proposed_parts?.[0].fields[0]).not.toHaveProperty('protectedByClaim');
    expect(card.proposed_parts?.[0].item).toEqual({ name: null, ref: '1239-003' });
    expect(ReviewQueueItem.safeParse(JSON.parse(JSON.stringify(card))).success).toBe(true);
  });
});
