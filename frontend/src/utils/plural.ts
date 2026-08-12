/**
 * "1 point", "12 works" — the count is the judgement, so it leads.
 *
 * Its own module because two surfaces now say the same kind of sentence about
 * the same numbers: the curator's cards ("12 works held") and the admin sync
 * panel ("18 unread museums"). A second copy would be two places to get the
 * `n === 1` comparison wrong, and getting it wrong is not hypothetical here —
 * every count these read comes from `COUNT(*)`, which `pg` hands over as a
 * *string* unless the query casts it, and `'1' === 1` is false. The queue's
 * counts are cast for exactly that reason; this comparison is what would
 * otherwise read "1 points" the day a new count arrives uncast.
 */
export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
