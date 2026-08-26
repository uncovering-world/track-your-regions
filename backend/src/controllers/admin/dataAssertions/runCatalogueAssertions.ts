/**
 * Running the catalogue's assertions, and reading what came back against what
 * somebody has already accepted.
 *
 * Separate from the assertions themselves because the two change for different
 * reasons: an assertion is a claim about the domain, this is how a report of
 * such claims is produced and judged. The split also lets the judging be tested
 * without a database and the claims be probed against one.
 *
 * The comparison is the part that makes the lane survivable. A catalogue built
 * from four sources over years holds rows nobody is proud of, and a panel that
 * says "28 objects are in no region" every morning is one an admin stops
 * reading by the third morning. What it says instead is "28, the number you
 * accepted" — and on the day a placement run breaks, "31, three more than you
 * accepted", which is the sentence worth interrupting somebody for.
 *
 * The accepted numbers live in the database this asks about
 * (`data_assertion_acceptances`, ADR-0032), so they travel with the rows they
 * describe and carry who accepted them.
 */

import { pool } from '../../../db/index.js';
import type { AssertionRow, CatalogueAssertion } from './catalogueAssertions.js';
import { catalogueAssertions } from './catalogueAssertions.js';

/**
 * How many violating rows travel to the panel per assertion.
 *
 * The count is always the whole truth; the rows are a sample, because the case
 * this lane exists for is not one row. A source re-published at full precision
 * would put a quarter of the catalogue's points into the first assertion at
 * once — 1642 of 6680 sit on a coordinate rounded to six decimals — and a
 * screen holding sixteen hundred sentences says less than ten and a number.
 */
export const SAMPLE_ROWS = 10;

/** What somebody accepted for one assertion, and who. */
export interface AcceptedNumber {
  count: number;
  acceptedAt: Date;
  /** The display name of whoever accepted it, where the account still exists. */
  acceptedBy: string | null;
}

export type AcceptedNumbers = Record<string, AcceptedNumber>;

export interface AssertionOutcome {
  assertion: CatalogueAssertion;
  /** Every matching row, whatever the report chooses to send. */
  rows: AssertionRow[];
  /** What went wrong, for an assertion whose query could not run at all. */
  error?: Error;
}

/**
 * What today's number means beside the accepted one.
 *
 * `unanswered` is the state a newly written assertion is in: rows found, and
 * nobody has yet said whether they are being fixed or carried. It is shown as
 * needing a person on purpose — the decision is the point — and one acceptance
 * moves it to `holding`.
 */
export type AssertionStatus =
  | 'clear'
  | 'holding'
  | 'improved'
  | 'regressed'
  | 'unanswered'
  | 'watch'
  | 'error';

export interface AssertionResult extends AssertionOutcome {
  status: AssertionStatus;
  accepted?: AcceptedNumber;
}

/** What the ledger says, or why it could not be read. */
export interface AcceptedNumbersRead {
  numbers: AcceptedNumbers;
  /**
   * Set when the ledger itself could not be read. The caller decides what to
   * say about it: an undefined table is a migration owed, and anything else is
   * a failure that must not borrow that diagnosis.
   */
  error?: Error;
}

/**
 * The newest acceptance per assertion.
 *
 * The table is a ledger — one row per act of accepting, never updated — so the
 * current number is the latest row for each id and the ones before it are the
 * history of what this catalogue has been carrying. `DISTINCT ON` is the
 * cheapest way to ask that of Postgres, and the index is built for exactly
 * this order.
 *
 * A `LEFT JOIN` on the account: the number stands whether or not the person who
 * accepted it still has one, and a report that dropped a line because an
 * account was deleted would quietly re-report accepted debt as new.
 *
 * **A failure here is carried, not thrown**, for the same reason a failed
 * assertion is: this is the one query guaranteed to fail at least once on every
 * database, because `data_assertion_acceptances` arrives with a migration
 * applied by hand. Between this landing and somebody running
 * `db/migrations/031`, throwing would make the whole screen a stack trace at
 * exactly the moment it is opened for the first time. Every assertion reported
 * with no accepted number, beside a notice naming what is owed, is the honest
 * answer — and it is what the screen would say anyway on a database nobody has
 * answered for yet.
 */
export async function readAcceptedNumbers(): Promise<AcceptedNumbersRead> {
  try {
    return { numbers: await readLedger() };
  } catch (error) {
    return {
      numbers: {},
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

async function readLedger(): Promise<AcceptedNumbers> {
  const result = await pool.query(
    `SELECT DISTINCT ON (a.assertion_id)
            a.assertion_id, a.accepted_count, a.accepted_at, u.display_name
       FROM data_assertion_acceptances a
       LEFT JOIN users u ON u.id = a.accepted_by
      ORDER BY a.assertion_id, a.accepted_at DESC, a.id DESC`,
  );
  const accepted: AcceptedNumbers = {};
  for (const row of result.rows as {
    assertion_id: string; accepted_count: number; accepted_at: Date; display_name: string | null;
  }[]) {
    accepted[row.assertion_id] = {
      count: row.accepted_count,
      acceptedAt: row.accepted_at,
      acceptedBy: row.display_name,
    };
  }
  return accepted;
}

/**
 * Run every assertion and answer with what each found.
 *
 * One statement per assertion on the shared pool, in order, and no transaction:
 * these are reads of a resting state, and wrapping them would hold a snapshot
 * open across a scan of the whole catalogue for no gain.
 *
 * A query that *fails* is carried in the outcome rather than thrown. An
 * assertion whose table was renamed away under it must not take the others off
 * the report — the point of the lane is what the database holds, and six
 * answers plus a named failure is more of that than one stack trace.
 */
export async function runCatalogueAssertions(
  assertions: CatalogueAssertion[] = catalogueAssertions,
): Promise<AssertionOutcome[]> {
  const outcomes: AssertionOutcome[] = [];
  for (const assertion of assertions) {
    try {
      const result = await pool.query(assertion.sql);
      outcomes.push({ assertion, rows: result.rows as AssertionRow[] });
    } catch (error) {
      outcomes.push({
        assertion,
        rows: [],
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
  return outcomes;
}

function statusOf(outcome: AssertionOutcome, accepted: AcceptedNumber | undefined): AssertionStatus {
  if (outcome.error) return 'error';
  if (outcome.assertion.kind === 'watch') return 'watch';
  const found = outcome.rows.length;
  if (accepted === undefined) return found === 0 ? 'clear' : 'unanswered';
  if (found > accepted.count) return 'regressed';
  if (found < accepted.count) return 'improved';
  return found === 0 ? 'clear' : 'holding';
}

/** Today's outcomes read against what this catalogue has accepted. */
export function assess(outcomes: AssertionOutcome[], accepted: AcceptedNumbers): AssertionResult[] {
  return outcomes.map(outcome => {
    const number = accepted[outcome.assertion.id];
    return { ...outcome, accepted: number, status: statusOf(outcome, number) };
  });
}

/**
 * Does this one need a person?
 *
 * Three things, and no others. A count that **grew** past what was accepted:
 * something is writing those rows now. A rule nobody has answered for yet. A
 * query that could not run — an assertion answering nothing is not an
 * assertion that passed, and a panel showing it as clear would be worse than
 * showing nothing.
 *
 * Debt that stands still is not one of them, and neither is a `watch` however
 * large it grows: its rows are legitimate -- by ADR-0022 for one watch and by
 * geography for the other -- and calling them a fault
 * would put a red mark on the ordinary state of a catalogue that has travellers
 * in it.
 */
export function needsAttention(status: AssertionStatus): boolean {
  return status === 'regressed' || status === 'unanswered' || status === 'error';
}

/** One assertion, in the shape the panel reads. */
export interface AssertionReportEntry {
  id: string;
  area: CatalogueAssertion['area'];
  title: string;
  kind: CatalogueAssertion['kind'];
  meaning: string;
  status: AssertionStatus;
  /** Every row that matched, not only the ones sent. */
  found: number;
  accepted: number | null;
  acceptedAt: string | null;
  acceptedBy: string | null;
  /** Up to `SAMPLE_ROWS` rows, each said the way a person would say it. */
  sample: string[];
  /** Why the query did not run, where it did not. */
  error: string | null;
  needsAttention: boolean;
}

/**
 * The report, ready to send.
 *
 * Rows are turned into sentences **here**, on the server, because `describe()`
 * is the one place that knows how to say a row out loud — a panel spelling its
 * own sentences would be a second version of every claim, drifting from the
 * assertion it belongs to. The panel receives text and decides only how to
 * arrange it.
 */
export function toReport(results: AssertionResult[]): AssertionReportEntry[] {
  return results.map(result => ({
    id: result.assertion.id,
    area: result.assertion.area,
    title: result.assertion.title,
    kind: result.assertion.kind,
    meaning: result.assertion.meaning,
    status: result.status,
    found: result.rows.length,
    accepted: result.accepted?.count ?? null,
    acceptedAt: result.accepted?.acceptedAt.toISOString() ?? null,
    acceptedBy: result.accepted?.acceptedBy ?? null,
    sample: result.rows.slice(0, SAMPLE_ROWS).map(row => result.assertion.describe(row)),
    error: result.error?.message ?? null,
    needsAttention: needsAttention(result.status),
  }));
}
