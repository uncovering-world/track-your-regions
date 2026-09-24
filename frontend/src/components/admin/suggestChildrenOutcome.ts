/**
 * What AI Review Children says when some of its actions failed: how many, and
 * the server's own sentences, once each. A remove refused because a traveller
 * visited the child (#764) says so, which a pointer to the console did not.
 */
export function failedActionsError(results: PromiseSettledResult<unknown>[]): Error | null {
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failures.length === 0) return null;

  const reasons = new Set<string>();
  for (const { reason } of failures) {
    console.error('[AI Review Children] action failed:', reason);
    if (reason instanceof Error && reason.message) reasons.add(reason.message);
  }
  return new Error(
    `AI Review Children: ${failures.length} of ${results.length} action(s) failed. ${[...reasons].join(' ')} `
    + 'The tree will refresh to show what did go through.',
  );
}
