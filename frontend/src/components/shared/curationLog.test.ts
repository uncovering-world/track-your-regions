/**
 * Tests for what the object's History makes of a verdict on one point.
 *
 * This screen is the only place a point's verdict is readable at all: answering one takes
 * the point off every list, and taking the verdict back moves the row's note to whoever
 * took it, so the wording that explained the answer survives here or nowhere (#544). The
 * card that destroys it says so and points here — a promise this file is what keeps true.
 *
 * Before this, both halves failed silently: the chip fell through to the raw
 * `location_marked_former` and the detail line returned null, so the History said a
 * machine word and nothing else.
 */

import { describe, it, expect } from 'vitest';
import { ACTION_LABELS, formatLogDetails } from './curationLog';

/** A verdict as `locationStateController.ts` writes it. */
function entry(action: string, details: Record<string, unknown>) {
  return { id: 1, action, details, curator_id: 1, created_at: '2026-08-15T09:12:00Z' } as never;
}

describe('a point verdict in the object’s history', () => {
  it('names every verdict, so the row does not print a machine word', () => {
    // The fallback is `{ label: entry.action }`, which reads as `location_marked_former`
    // on a screen a curator is meant to read.
    for (const action of [
      'location_marked_former', 'location_marked_lost',
      'location_state_restored', 'location_missing_dismissed',
    ]) {
      expect(ACTION_LABELS[action]?.label).toBeTruthy();
      expect(ACTION_LABELS[action]?.label).not.toContain('location_');
    }
  });

  it('carries the note, which has no other screen once the verdict moves', () => {
    const line = formatLogDetails(entry('location_marked_lost', {
      locationId: 13211,
      membership: { old: 'present', new: 'present' },
      existence: { old: 'extant', new: 'lost' },
      note: 'Demolished in the 2019 fire; the source still lists it',
    }));

    expect(line).toContain('Demolished in the 2019 fire');
    expect(line).toContain('13211');
  });

  it('does not repeat an axis the act never moved', () => {
    // `details` carries both axes whatever the verdict was about, so a formatter reading
    // them off would print `existence: extant → extant` beside a membership verdict. The
    // chip already names the transition.
    const line = formatLogDetails(entry('location_marked_former', {
      locationId: 13211,
      membership: { old: 'present', new: 'former' },
      existence: { old: 'extant', new: 'extant' },
      note: null,
    }));

    expect(line).toBe('Place #13211');
  });

  it('names the correction beside the verdicts, being the same family and the same list', () => {
    // Left out, the History reads "Place: source dropped it" on one row and
    // `location_edited` on the next — the inconsistency naming four of five creates.
    expect(ACTION_LABELS.location_edited?.label).toBeTruthy();

    const line = formatLogDetails(entry('location_edited', {
      locationId: 13211,
      name: { old: 'Shahr-i-Zuhak', new: 'Shahr-e Zohak' },
    }));
    expect(line).toContain('Place #13211');
    expect(line).toContain('Shahr-e Zohak');
  });

  it('prints a moved point as a coordinate, not as [object Object]', () => {
    // A point edit records the move as a pair of objects, unlike every scalar the
    // object-level `edited` action carries — so the row that exists to say what moved is
    // the one shape the shared formatter could not render.
    const line = formatLogDetails(entry('location_edited', {
      locationId: 13211,
      location: { old: { lon: -2.93785, lat: 43.265974 }, new: { lon: -2.9378, lat: 43.2661 } },
      anchorMoved: true,
    }));

    expect(line).not.toContain('[object Object]');
    expect(line).toContain('43.265974, -2.93785');
    expect(line).toContain('43.2661, -2.9378');
  });

  it('does not round a correction smaller than the writer’s tolerance away', () => {
    // Four decimals is about 11 m, which is right for naming where a place is and wrong
    // here: the catalogue's own case is 1.2 cm (#543), and a row saying X → X about a
    // move is worse than no row.
    const line = formatLogDetails(entry('location_edited', {
      locationId: 13211,
      location: {
        old: { lon: -2.93785, lat: 43.26597 },
        new: { lon: -2.93785, lat: 43.265973888 },
      },
    })) as string;
    const [before, after] = line.split('→');

    expect(before).not.toBe(after);
    expect(line).toContain('43.265973888');
  });

  it('leaves the other kinds of entry as they were', () => {
    expect(formatLogDetails(entry('rejected', { reason: 'duplicate' }))).toBe('Reason: duplicate');
    expect(formatLogDetails(entry('added_to_region', { regionId: 4 }))).toBeNull();
  });
});
