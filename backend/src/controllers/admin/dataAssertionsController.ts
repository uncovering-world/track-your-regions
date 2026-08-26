/**
 * What the catalogue itself says about its own rows, for the admin panel.
 *
 * Every other lane in this repository watches the code. `npm run check` reads
 * the source, Semgrep and Trivy read it again, the schema guards compare two
 * SQL files as text, and the e2e smoke drives a browser over a fixture. None of
 * them can see a defect that writes *wrong rows* into a database that is
 * otherwise healthy — which is how the catalogue held a withdrawn point for
 * Bilbao Fine Arts Museum whose replacement stood 1.2 cm away for nine days,
 * with every sync run reporting `success` (#543).
 *
 * It answers to the panel rather than to a terminal because of who has to act
 * on it. An admin starts runs in the panel and reads their outcome there; being
 * asked to open a shell to find out what the catalogue holds would hand a
 * product role a developer's tool. The assertions themselves live next door in
 * `dataAssertions/`; this file is the two things a screen needs — the report,
 * and the act of accepting a number.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { catalogueAssertions } from './dataAssertions/catalogueAssertions.js';
import {
  assess,
  readAcceptedNumbers,
  runCatalogueAssertions,
  toReport,
} from './dataAssertions/runCatalogueAssertions.js';

/**
 * What to say when the ledger is not there.
 *
 * One sentence naming the file to apply, because the alternative — the raw
 * `relation "data_assertion_acceptances" does not exist` — tells an admin
 * nothing they can act on, and this is a state every existing database passes
 * through exactly once.
 */
const MIGRATION_OWED =
  'The record of accepted numbers is missing: apply db/migrations/031-data-assertion-acceptances.sql. '
  + 'Until then every check reports everything it finds, and nothing can be accepted.';

/**
 * Undefined table, and nothing else.
 *
 * The sentence above is a *diagnosis*, so it may only be given where the
 * diagnosis holds. Every other failure of these statements reads identically
 * from here — a pool that cannot connect, a lock timeout, and most sharply a
 * foreign key violation on `accepted_by`, which a deleted admin's still-valid
 * token reaches, since `requireAuth` verifies a JWT and never looks the account
 * up. Telling that admin to apply a migration sends them to run a file that
 * no-ops and come back to the same sentence with nothing else to go on.
 */
const UNDEFINED_TABLE = '42P01';

function isMissingLedger(error: unknown): boolean {
  return error instanceof Error && 'code' in error
    && (error as { code?: string }).code === UNDEFINED_TABLE;
}

/**
 * What to tell the panel about a ledger it could not read.
 *
 * Two sentences rather than one, because they ask for different actions: apply
 * a file, or find out what is wrong with the database. Both log, since a
 * report that answers 200 is the one place a swallowed error would otherwise
 * leave no trace at all.
 */
function ledgerNotice(error: Error | undefined): string | null {
  if (!error) return null;
  console.error('[data-assertions] the acceptance ledger could not be read:', error);
  return isMissingLedger(error)
    ? MIGRATION_OWED
    : 'The record of accepted numbers could not be read, so every check below reports everything it '
      + 'finds. The server log names the failure.';
}

/**
 * The whole report: every assertion, what it found, and what was accepted.
 * GET /api/admin/data-assertions
 *
 * A statement per assertion over the catalogue, a couple of seconds on the dev
 * database — which is why it sits behind the expensive-admin limiter and is
 * fetched when a person opens the section rather than polled. The count of them
 * is not written here: a number above a list is what goes stale when a rule
 * joins it, which is the same reasoning the ASVS note carries.
 *
 * Nothing is filtered out for being clean. A panel that showed only the
 * assertions in trouble would leave an admin unable to tell "nothing is wrong"
 * from "nothing ran", and the second is the state this lane most needs to make
 * visible.
 */
export async function getDataAssertions(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const [outcomes, accepted] = await Promise.all([
    runCatalogueAssertions(),
    readAcceptedNumbers(),
  ]);
  const entries = toReport(assess(outcomes, accepted.numbers));
  res.json({
    assertions: entries,
    // Counted here rather than in the panel: the rule for what needs a person
    // is the server's, and two places deciding it is how the badge and the list
    // come to disagree.
    needsAttention: entries.filter(entry => entry.needsAttention).length,
    // Named rather than thrown. The ledger arrives with a migration applied by
    // hand, so on every existing database there is a window where the table is
    // not there yet — and that window is exactly when somebody opens this screen
    // for the first time. The checks themselves still answer; what is missing is
    // the memory of what was accepted, which is a sentence rather than a 500.
    // Anything that is not a missing table says so instead of borrowing the
    // diagnosis, and either way the error itself is logged rather than swallowed.
    acceptancesUnavailable: ledgerNotice(accepted.error),
  });
}

/**
 * Accept what one assertion currently finds as the debt this catalogue carries.
 * POST /api/admin/data-assertions/accept
 *
 * **The number is measured here, never sent.** The client names an assertion
 * and the server re-runs it and records what it returns. A count the browser
 * supplied would let a stale screen — or a hand-made request — record a number
 * the catalogue never held, and the whole lane rests on the accepted figure
 * being a measurement rather than a claim.
 *
 * **One assertion at a time, on purpose.** Accepting is how a rule the
 * catalogue cannot pass today stops blocking everything else, and equally how a
 * defect gets quietly buried. A single control that accepted everything would
 * make the run where somebody answers for a newly added rule also the run that
 * re-baselines a regression standing beside it — the one thing this exists to
 * catch. So a person accepts a number they are looking at.
 *
 * A `watch` cannot be accepted at all: its rows are legitimate -- by a decision
 * for one of them (ADR-0022, a point a source dropped keeps the tick a traveller
 * earned) and by geography for the other (a scattered territory's box centre is
 * open water, and the frame is right) -- and
 * its count is a number to watch rather than a debt, so there is nothing to
 * answer for. Refusing is the honest answer to a button that should not exist.
 */
export async function acceptDataAssertion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { assertionId } = req.body as { assertionId: string };
  const assertion = catalogueAssertions.find(candidate => candidate.id === assertionId);
  if (!assertion) {
    res.status(404).json({ error: 'No such assertion' });
    return;
  }
  if (assertion.kind === 'watch') {
    res.status(400).json({ error: 'A watch has nothing to accept: its count is not a debt' });
    return;
  }
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const [outcome] = await runCatalogueAssertions([assertion]);
  if (outcome.error) {
    // Nothing is recorded for an assertion that could not run: a zero written
    // here would turn a broken query into a clean bill of health, and the next
    // report would read its silence as debt somebody answered for.
    res.status(503).json({ error: `The assertion could not be run: ${outcome.error.message}` });
    return;
  }

  const found = outcome.rows.length;
  let acceptedAt: Date;
  try {
    const inserted = await pool.query(
      `INSERT INTO data_assertion_acceptances (assertion_id, accepted_count, accepted_by)
       VALUES ($1, $2, $3)
       RETURNING accepted_at`,
      [assertion.id, found, userId],
    );
    // Returned rather than assumed: the column defaults to NOW(), so the moment
    // this was accepted is the database's and not this process's clock.
    acceptedAt = (inserted.rows[0] as { accepted_at: Date }).accepted_at;
  } catch (error: unknown) {
    // The same window as the report's: the table arrives by hand. An admin who
    // pressed a button gets the sentence that says what to do, not a 500 — but
    // only where that is what happened. Anything else is a genuine failure and
    // goes to the error handler, which logs it and answers 500, rather than
    // being dressed up as a migration nobody owes.
    if (!isMissingLedger(error)) throw error;
    res.status(503).json({ error: MIGRATION_OWED });
    return;
  }
  console.log(`[data-assertions] ${assertion.id} accepted at ${found} by user ${userId}`);

  // Read back for one thing only: the display name of whoever accepted it. The
  // number and the moment are already known — the insert committed and returned
  // them — so a failure here must not be allowed to answer with *less* than the
  // row that is now in the ledger.
  //
  // Left to itself it would answer with the opposite. `readAcceptedNumbers`
  // never throws, so a pool error or a statement timeout comes back as no
  // accepted number at all, `assess` reads that as `unanswered`, and the reply
  // the panel writes into its cache says "nobody has answered for this" beside
  // a snackbar reading "Carrying 28 rows" — one interaction saying two opposite
  // things about a row that was written. So the fallback states what was
  // written, without the name, and the failure is logged rather than swallowed:
  // a 200 is the one place an error would otherwise leave no trace.
  const ledger = await readAcceptedNumbers();
  if (ledger.error) {
    // A constant format string with the values as arguments, not a template
    // literal: `console.error` applies `util.format` once there is a second
    // argument, so an interpolated first one is a format string built at run
    // time. Neither value here can carry a specifier — an id from this
    // repository's own list, and a row count — but the rule is about the shape,
    // and the shape is what the next line copied from here would keep.
    console.error(
      '[data-assertions] %s was accepted at %s, but reading the ledger back failed:',
      assertion.id, found, ledger.error,
    );
  }
  const number = ledger.numbers[assertion.id] ?? { count: found, acceptedAt, acceptedBy: null };
  res.json(toReport(assess([outcome], { [assertion.id]: number }))[0]);
}
