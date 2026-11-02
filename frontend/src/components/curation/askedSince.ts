/**
 * When a held or conflict question was first asked, said where a later run
 * proposed it again (ADR-0173, #2229).
 *
 * A source repeats a proposal on every run until someone answers it: My Son
 * Sanctuary's Wikipedia article was proposed by every Places of worship run
 * since 1 October. The card is dated by the run that first asked, and this
 * line says so beside the run that proposes it now, so a curator tells a new
 * question from one that has waited for a month.
 */

import { formatDay } from '../../utils/dateFormat';

export interface AskedRuns {
  sync_log_id?: number | null;
  run_completed_at?: string | null;
  first_asked_run_id?: number | null;
  first_asked_at?: string | null;
}

/** "asked since 1 October, proposed again by the run of 1 November", or null where this run asked first. */
export function askedSince(card: AskedRuns): string | null {
  const { sync_log_id: latest, run_completed_at: latestAt, first_asked_run_id: first, first_asked_at: firstAt } = card;
  if (first == null || latest == null || first === latest || !firstAt || !latestAt) return null;
  const since = formatDay(firstAt);
  const again = formatDay(latestAt);
  // Two runs of one day are told apart by number, where the day would say nothing.
  if (since === again) return `asked by run ${first}, proposed again by run ${latest}`;
  return `asked since ${since}, proposed again by the run of ${again}`;
}
