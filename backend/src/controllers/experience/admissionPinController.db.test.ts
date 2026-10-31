import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { handBackPinUnderLock, listAdmissionPins } from './admissionPinController.js';
import { answerAdmissionUnderLock } from './lifecycleController.js';

/**
 * A curator's admission pins, listed and handed back (#1369), executed against
 * PostgreSQL.
 *
 * Two pins as the development catalogue held them on 2026-10-12: Villa
 * Farnesina put back into Art Museums over the rule's "probe: site class
 * villa", and the British Museum kept out of it. Ids are the fixture's own,
 * deleted before and after.
 */

const FARNESINA = 9540;
const BRITISH = 9541;
const ADMIN = '00000000-0000-4000-8000-000000009540';

let adminId = 0;
const memberships: Record<number, number> = {};

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1)', [[FARNESINA, BRITISH]]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [ADMIN]);
}

async function pinned(id: number, name: string, admission: 'admitted' | 'refused', reason: string): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint(12.47, 41.89), 4326) FROM experience_sources s WHERE s.name = 'Art Museums'`,
    [id, `Q${id}-pin-fixture`, name],
  );
  memberships[id] = (await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, admission, admission_reason,
       curated_fields, admission_pin_verdict, admission_pin_reason)
     SELECT $1, s.kind_id, s.id, $2, $3::text, CASE WHEN $3::text = 'refused' THEN $4::text END, '["admission"]', 'refused', $4::text
       FROM experience_sources s WHERE s.name = 'Art Museums' RETURNING id`,
    [id, `Q${id}-pin-fixture`, admission, reason],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experience_curation_log (experience_id, curator_id, action, details) VALUES ($1, $2, $3, $4)`,
    [id, adminId, admission === 'admitted' ? 'admission_overridden' : 'admission_confirmed',
      JSON.stringify({ membershipId: memberships[id], reason, note: `${name} note` })],
  );
}

beforeEach(async () => {
  await clear();
  adminId = (await pool.query<{ id: number }>(
    "INSERT INTO users (uuid, display_name, role) VALUES ($1, 'Ada', 'admin') RETURNING id", [ADMIN],
  )).rows[0].id;
  await pinned(FARNESINA, 'Villa Farnesina (pin fixture)', 'admitted', 'probe: site class villa');
  await pinned(BRITISH, 'British Museum (pin fixture)', 'refused', 'editorial exclusion: British Museum');
});

afterAll(async () => {
  await clear();
  await pool.end();
});

const caller = () => ({ id: adminId, role: 'admin' }) as Express.User;
const membership = async (id: number) => (await pool.query<{
  admission: string; pinned: boolean; answered: boolean; pin_reason: string | null;
}>(
  `SELECT admission, curated_fields ? 'admission' AS pinned, admission_answered_at IS NOT NULL AS answered,
          admission_pin_reason AS pin_reason
     FROM experience_kind_memberships WHERE id = $1`,
  [memberships[id]],
)).rows[0];

describe("a curator's admission pins", () => {
  it("lists one place's pin with who answered, when, against which reason, and the note", async () => {
    const { pins } = await listAdmissionPins({ query: { experienceId: FARNESINA }, caller: caller() });

    expect(pins).toEqual([expect.objectContaining({
      experienceId: FARNESINA, membershipId: memberships[FARNESINA], kindName: 'Art Museums', answer: 'admitted',
      answeredReason: 'probe: site class villa', note: 'Villa Farnesina (pin fixture) note', systemNote: null,
      curatorName: 'Ada', questioned: false,
    })]);
  });

  it("lists what the system recorded about an answer apart from the curator's words (#2195)", async () => {
    await pool.query(
      `INSERT INTO experience_curation_log (experience_id, curator_id, action, details) VALUES ($1, $2, 'admission_overridden', $3)`,
      [FARNESINA, adminId, JSON.stringify({
        membershipId: memberships[FARNESINA], reason: 'probe: site class villa',
        systemNote: 'kept when the batch answer of 14 September 2026 was read',
      })],
    );
    const { pins } = await listAdmissionPins({ query: { experienceId: FARNESINA }, caller: caller() });
    expect(pins[0]).toMatchObject({ note: null, systemNote: 'kept when the batch answer of 14 September 2026 was read' });
  });

  it('hands back a put-back: the claim off, the place still admitted until a run decides', async () => {
    const outcome = await handBackPinUnderLock(FARNESINA, adminId, null, { membershipId: memberships[FARNESINA] });

    expect(outcome.result).toEqual({ experienceId: FARNESINA, membershipId: memberships[FARNESINA], admission: 'admitted' });
    expect(await membership(FARNESINA)).toEqual({ admission: 'admitted', pinned: false, answered: false, pin_reason: null });
    const log = await pool.query(
      "SELECT details FROM experience_curation_log WHERE experience_id = $1 AND action = 'admission_pin_handed_back'",
      [FARNESINA],
    );
    expect(log.rows[0].details).toMatchObject({ membershipId: memberships[FARNESINA], answer: 'admitted' });
    expect((await listAdmissionPins({ query: { experienceId: FARNESINA }, caller: caller() })).pins).toEqual([]);
  });

  it('hands back a kept-out row: still refused, and answered, so it is not asked again until a run admits it', async () => {
    await handBackPinUnderLock(BRITISH, adminId, null, { membershipId: memberships[BRITISH] });

    expect(await membership(BRITISH)).toEqual({ admission: 'refused', pinned: false, answered: true, pin_reason: null });
  });

  it("refuses to hand back a curator's own refusal of an arrival: it answered no rule, and the put-back is its way back", async () => {
    await pool.query(
      "UPDATE experience_kind_memberships SET admission_pin_verdict = 'admitted', admission_pin_reason = NULL WHERE id = $1",
      [memberships[BRITISH]],
    );
    const { pins } = await listAdmissionPins({ query: { experienceId: BRITISH }, caller: caller() });
    const outcome = await handBackPinUnderLock(BRITISH, adminId, null, { membershipId: memberships[BRITISH] });

    expect(pins[0].canHandBack).toBe(false);
    expect(outcome.refusal).toMatchObject({ status: 409 });
    expect((await membership(BRITISH)).pinned).toBe(true);
  });

  it("keeps the view a pin answered when a curator answers the row again: a put-back of their own refusal", async () => {
    await pool.query(
      `UPDATE experience_kind_memberships SET admission_pin_verdict = 'admitted', admission_pin_reason = NULL,
              admission_reason = 'kept out by a curator' WHERE id = $1`,
      [memberships[BRITISH]],
    );
    const outcome = await answerAdmissionUnderLock(BRITISH, adminId, null, {
      decision: 'override', membershipId: memberships[BRITISH],
    });

    expect(outcome.refusal).toBeUndefined();
    const { pins } = await listAdmissionPins({ query: { experienceId: BRITISH }, caller: caller() });
    // The run had admitted it all along: the pin answers that, not "kept out by a curator".
    expect(pins[0]).toMatchObject({ answer: 'admitted', answeredReason: null, canHandBack: true });
  });

  it('names the listing verdict that took a place out of its kind as the act the pin stands on', async () => {
    await pool.query(
      `INSERT INTO experience_curation_log (experience_id, curator_id, action, details, created_at)
       VALUES ($1, $2, 'marked_former', $3, NOW() + interval '1 minute')`,
      [BRITISH, adminId, JSON.stringify({ membershipId: memberships[BRITISH], takenOutOfKind: true, note: 'gone from the list' })],
    );
    const { pins } = await listAdmissionPins({ query: { experienceId: BRITISH }, caller: caller() });

    expect(pins[0].note).toBe('gone from the list');
  });

  it('refuses to hand back a pin that is not there any more, and writes nothing', async () => {
    await handBackPinUnderLock(FARNESINA, adminId, null, { membershipId: memberships[FARNESINA] });
    const second = await handBackPinUnderLock(FARNESINA, adminId, null, { membershipId: memberships[FARNESINA] });

    expect(second.refusal).toMatchObject({ status: 409 });
    const log = await pool.query(
      "SELECT count(*)::int AS n FROM experience_curation_log WHERE experience_id = $1 AND action = 'admission_pin_handed_back'",
      [FARNESINA],
    );
    expect(log.rows[0].n).toBe(1);
  });
});
