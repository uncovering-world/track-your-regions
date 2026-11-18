/**
 * Tests for what a list read says about a site being in danger.
 *
 * The badge was drawn from a flag that was false on all 1272 UNESCO rows
 * (#600). What it draws from now is the open stay on the List of World
 * Heritage in Danger the site's World Heritage membership holds while that
 * stands (#2068, #2127), and the year beside it is the stay's start.
 */

import { describe, it, expect } from 'vitest';
import { dangerSelectSql, withDangerFields } from './experienceDanger.js';

describe('dangerSelectSql', () => {
  it('reads the open stay of the World Heritage membership a reader is shown', () => {
    const sql = dangerSelectSql();

    expect(sql).toContain('wh.experience_id = e.id AND wh.kind_id = 1');
    expect(sql).toContain("wh.admission <> 'refused'");
    expect(sql).toContain("wh.source_membership = 'present'");
    // A stay that ended (Cologne Cathedral, 2004 to 2006) draws nothing.
    expect(sql).toContain('FROM record_danger_periods d');
    expect(sql).toContain('NOT d.ended');
    // A run that merely missed the site changes nothing a reader sees.
    expect(sql).not.toContain('missing_since');
    expect(sql).toMatch(/AS danger_stay$/);
    expect(sql).not.toContain('facts');
  });

  it('takes an alias like the select fragments beside it', () => {
    expect(dangerSelectSql('exp')).toContain('wh.experience_id = exp.id');
  });
});

describe('withDangerFields', () => {
  it('sends the flag as a boolean and the year as a number', () => {
    // Ancient City of Aleppo: on the List of World Heritage in Danger since 2013.
    const row = withDangerFields({ id: 775, name: 'Ancient City of Aleppo', danger_stay: { since: 2013 } });

    expect(row).toEqual({
      id: 775, name: 'Ancient City of Aleppo', in_danger: true, danger_since: 2013,
    });
  });

  it('leaves the stay itself on the server', () => {
    const row = withDangerFields({ id: 1, danger_stay: { since: 2013 } });

    expect(row).not.toHaveProperty('danger_stay');
  });

  it('draws no badge where no stay is open', () => {
    // Belize Barrier Reef Reserve System, taken off the danger list in 2018,
    // and Cologne Cathedral, whose stay ended in 2006: the read hands back no
    // stay, and a year on a site out of danger would be a date with nothing to date.
    expect(withDangerFields({ id: 851, danger_stay: null }))
      .toEqual({ id: 851, in_danger: false, danger_since: null });
  });

  it('still says a site is in danger when its stay carries no year', () => {
    expect(withDangerFields({ id: 2, danger_stay: { since: null } }))
      .toEqual({ id: 2, in_danger: true, danger_since: null });
  });

  it('leaves every other field of the row alone', () => {
    const row = withDangerFields({
      id: 3, name: 'Tyre', kind_name: 'World Heritage Sites', danger_stay: { since: 2026 },
    });

    expect(row.name).toBe('Tyre');
    expect(row.kind_name).toBe('World Heritage Sites');
  });
});
