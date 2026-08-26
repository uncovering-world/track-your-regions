/**
 * What the catalogue's own rows say about themselves.
 *
 * Its own module rather than more of `admin/index.ts`, which is about running
 * and watching syncs: these are claims about the resting state of the data —
 * what the database holds right now, whoever put it there and whenever.
 */

import { authFetchJson } from '../fetchUtils';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/**
 * What today's number means beside the accepted one.
 *
 * `holding` is debt somebody has answered for and is carrying; `unanswered` is
 * a rule nobody has answered for yet. Both have rows; only the second is
 * something to do today.
 */
export type AssertionStatus =
  | 'clear'
  | 'holding'
  | 'improved'
  | 'regressed'
  | 'unanswered'
  | 'watch'
  | 'error';

export interface DataAssertion {
  id: string;
  /** What the assertion is about, so a growing list stays readable. */
  area: 'places' | 'regions' | 'boundaries' | 'pictures';
  title: string;
  /** A `watch` is a number to watch rather than a debt, and cannot be accepted. */
  kind: 'invariant' | 'watch';
  /** What a matching row means, and who has to do what about it. */
  meaning: string;
  status: AssertionStatus;
  /** Every row that matched, not only the ones in `sample`. */
  found: number;
  accepted: number | null;
  acceptedAt: string | null;
  /** The display name of whoever accepted it, where the account still exists. */
  acceptedBy: string | null;
  /** Up to ten rows, each already said the way a person would say it. */
  sample: string[];
  error: string | null;
  needsAttention: boolean;
}

export interface DataAssertionReport {
  assertions: DataAssertion[];
  /** Counted by the server, so the badge and the list cannot disagree. */
  needsAttention: number;
  /**
   * Set when the record of accepted numbers could not be read at all. The
   * checks still answer; what is missing is the memory of what was accepted,
   * so every one of them reports everything it finds.
   *
   * **Two situations, and the sentence is the only thing that tells them
   * apart** — which is why this is a sentence to show rather than a flag to
   * branch on. The ledger arrives with a migration applied by hand, so every
   * existing database passes through a first-run state once, and there the
   * sentence names the file to apply. Any other failure of that read — a pool
   * error, a lock timeout, a constraint — says the log names it instead, and
   * naming a migration there would send somebody to run a file that is already
   * applied. Copy written here that assumed the first case would be wrong on
   * the second.
   */
  acceptancesUnavailable: string | null;
}

/** A statement per assertion over the whole catalogue — a couple of seconds. */
export async function getDataAssertions(): Promise<DataAssertionReport> {
  return authFetchJson(`${API_URL}/api/admin/data-assertions`);
}

/**
 * Accept what one assertion currently finds as the debt this catalogue carries.
 *
 * The id and nothing else: the number is measured by the server as it records
 * it. A count sent from here would be a claim about a screen that may be
 * minutes old, and the whole lane rests on the accepted figure being a
 * measurement.
 */
export async function acceptDataAssertion(assertionId: string): Promise<DataAssertion> {
  return authFetchJson(`${API_URL}/api/admin/data-assertions/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assertionId }),
  });
}
