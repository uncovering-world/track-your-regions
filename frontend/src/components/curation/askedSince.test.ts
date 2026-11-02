import { describe, it, expect } from 'vitest';
import { askedSince } from './askedSince';
import { formatDay } from '../../utils/dateFormat';

// My Son Sanctuary's held Wikipedia article: first proposed by the Places of worship run of
// 1 October, proposed again by every run since (#2229).
const FIRST = '2026-10-01T09:00:00Z';
const LATEST = '2026-11-01T09:00:00Z';

describe('askedSince', () => {
  it('says when the question was first asked and which run proposed it again', () => {
    expect(askedSince({ sync_log_id: 430, run_completed_at: LATEST, first_asked_run_id: 168, first_asked_at: FIRST }))
      .toBe(`asked since ${formatDay(FIRST)}, proposed again by the run of ${formatDay(LATEST)}`);
  });

  it('says nothing where the run proposing it is the one that asked first', () => {
    expect(askedSince({ sync_log_id: 430, run_completed_at: LATEST, first_asked_run_id: 430, first_asked_at: LATEST })).toBeNull();
    // A card filed before the date was recorded.
    expect(askedSince({ sync_log_id: 430, run_completed_at: LATEST, first_asked_run_id: null, first_asked_at: null })).toBeNull();
  });

  it('tells two runs of one day apart by number', () => {
    expect(askedSince({ sync_log_id: 431, run_completed_at: LATEST, first_asked_run_id: 429, first_asked_at: LATEST }))
      .toBe('asked by run 429, proposed again by run 431');
  });
});
