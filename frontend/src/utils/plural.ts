/**
 * "1 point", "12 works" — the count is the judgement, so it leads.
 *
 * Its own module for any surface that says "N things" — curator cards, admin
 * panels, snackbars, tree labels; the remit is the sentence, not a list of
 * screens. One home because the comparison is the part that gets written wrong,
 * and it gets written wrong in more than one way:
 *
 * - `n > 1 ? 's' : ''` reads "0 thing" at zero, which no count is safe from
 *   unless something upstream guarantees at least one;
 * - `n === 1 ? '' : 's'` is right but silently breaks on an *uncast* count —
 *   `COUNT(*)` reaches the client as a string unless the query casts it, and
 *   `'1' === 1` is false, so a card reads "1 points". The queue's counts are cast
 *   for exactly this reason.
 *
 * Neither hazard needs to apply to a given call site for the call to belong: an
 * array's `.length` is a number and never zero-guarded by accident, and it still
 * goes through here, because the reason is the single home rather than the hazard.
 */
export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
