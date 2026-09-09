/**
 * The clauses two batch notices share: what refused and why, what could not be
 * re-placed, what was left alone.
 *
 * `curationGateNotice.ts` (the admin's *Publish all waiting*) and the review
 * feed's batch answer (#852) report the same three things about a run of
 * per-object acts, and each clause is a claim that had to be corrected once for
 * saying something the response did not support — so they are written once.
 * Pure string assembly, no React, tested directly.
 */

import { plural } from './plural';
import { worldViewList } from './worldViewList';

/** The first five names, then a count — safe where the list is in the same sentence. */
export function namedWithRest(names: string[], cap = 5): string {
  const rest = names.length > cap ? ` and ${names.length - cap} more` : '';
  return `${names.slice(0, cap).join(', ')}${rest}`;
}

/**
 * One clause per distinct reason, naming the objects it applies to.
 *
 * The reasons are not interchangeable: the endpoint sends the server's 409 text for a
 * row holding a newer proposal and a generic "failed — open it" for a thrown database
 * error. Naming one of five can therefore explain a deadlock while the other four are
 * stale proposals, and the curator opens the wrong object first. Five names per
 * reason, then a count — safe here because its list is in the same sentence.
 */
export function refusalClauses(refused: Array<{ name: string; error: string }>): string[] {
  const byReason = new Map<string, string[]>();
  for (const r of refused) byReason.set(r.error, [...(byReason.get(r.error) ?? []), r.name]);
  return [...byReason].map(([reason, names]) => {
    const shown = namedWithRest(names);
    // Quoted and attributed rather than spliced in after a count, because every
    // message `publishUnderLock` produces is phrased for one row ("This row is
    // holding a proposal from a different run — reload to see it"). Reading that
    // after "2 objects refused —" makes it a claim about a row that is not named,
    // and the colon it used to sit behind followed a sentence that already ended in
    // an instruction.
    // Terminated here, because the notice joins clauses with a single space and the
    // server's reason carries no full stop of its own — without these the next clause
    // ran on from "reload to see it 3 objects outside your scope".
    if (names.length === 1) return `${shown} refused — ${reason}.`;
    return `${plural(names.length, 'object')} refused — ${shown}. Each: “${reason}”.`;
  });
}

/**
 * Objects whose answer landed with their regions left stale, named rather than
 * counted.
 *
 * Rebuilding a world view is an admin's job, so the one useful thing a curator can do
 * is say which object and which world views — a bare count reduces them to
 * "something about regions failed". `in` rather than brackets: `worldViewList`
 * returns `Name (world view N)` and joins several with commas, so wrapping it would
 * nest a comma-separated list inside parentheses inside a semicolon-separated list.
 * Capped like the refusal clause, and this is the list that needs it more: a placement
 * failure is systemic — one broken world view fails every object the batch releases.
 */
export function stalePlacementClause(
  stale: Array<{ name: string; worldViews: Array<{ id: number | null; name: string | null }> | undefined }>,
  verb = 'published',
): string[] {
  if (stale.length === 0) return [];
  const named = stale.map(o => `${o.name} in ${worldViewList(o.worldViews)}`);
  const rest = named.length > 5 ? ` and ${named.length - 5} more` : '';
  return [
    `${plural(stale.length, 'object')} ${verb} but could not be re-placed into `
    + `${stale.length === 1 ? 'its' : 'their'} regions — ${named.slice(0, 5).join('; ')}${rest}. `
    + 'Tell an admin.',
  ];
}

/**
 * What a region-scoped curator's batch left alone. Through `plural` like every
 * sibling clause: this is the one sentence whose only reader is such a curator, so
 * it is the one that most needs to say *what* was left rather than a bare number.
 */
export function outOfScopeClause(outOfScope: number): string[] {
  if (outOfScope === 0) return [];
  return [`${plural(outOfScope, 'object')} outside your scope, left alone.`];
}
