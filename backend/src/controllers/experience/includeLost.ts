/**
 * Should this request see objects that no longer exist?
 *
 * Only when it asks — `?includeLost=true` — and the ask is meaningful in
 * exactly two places: a visit history, and a list a user has deliberately
 * unfiltered. Everywhere else the parameter is simply absent, which is the
 * safe default rather than a policy each caller has to remember.
 */
export function includeLost(query: Record<string, unknown>): boolean {
  return query.includeLost === 'true' || query.includeLost === true;
}
