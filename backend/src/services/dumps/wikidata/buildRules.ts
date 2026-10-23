/**
 * The versions of the rules a subset is built under, recorded with each build
 * (#1583), so the admin panel can say when the copy in place was made by older
 * code and what bringing it up to date takes: a change to what the subset
 * keeps or how a line is written needs a full build from the dump, and a
 * change to the derived tables only a re-derive (#1526), minutes rather than
 * hours.
 */

import { WRITE_VERSION } from './lineWork.js';
import { SCOPE_RULES, SUBJECT_PROPERTIES } from './scope.js';
import { SCOPE_VERSION } from './scopeFile.js';

/**
 * Raised by hand with any change to what the derived tables hold: the claims,
 * labels and sitelinks `deriveFromEntities` makes, the class closure
 * `deriveClassClosure` walks, and the indexes they carry.
 */
export const DERIVE_VERSION = 1;

export interface BuildRules {
  /** What the first pass keeps: its version and its rules written whole. */
  scope: string;
  /** How the second pass writes a line (`WRITE_VERSION`). */
  write: number;
  /** How the derived tables are made (`DERIVE_VERSION`). */
  derive: number;
}

export const currentRules = (): BuildRules => ({ scope: `${SCOPE_VERSION}:${SCOPE_RULES}`, write: WRITE_VERSION, derive: DERIVE_VERSION });

/** What the copy in place needs to match the code: nothing, a re-derive, or a build from the dump. */
export type CopyNeeds = 'nothing' | 'recompute' | 'rebuild';

/**
 * Compare the rules a copy was built under with the code's. A copy built
 * before the rules were recorded is taken as current: nothing says otherwise,
 * and a false alarm would send an admin into a ten-hour build for nothing.
 */
export function whatTheCopyNeeds(stored: BuildRules | null, current: BuildRules = currentRules()): CopyNeeds {
  if (!stored) return 'nothing';
  if (stored.scope !== current.scope || stored.write !== current.write) return 'rebuild';
  return stored.derive === current.derive ? 'nothing' : 'recompute';
}

/**
 * Whether a copy was built under a scope that keeps a seed's depicted and
 * commemorated items (`SUBJECT_PROPERTIES`, #1832): a copy built before keeps
 * only those that are seeds themselves — Ukraine, never Sardar Vallabhbhai
 * Patel — and a run asks the live service about the rest until one is built.
 * A copy that recorded no rules was built before them.
 */
export function keepsSubjects(stored: BuildRules | null): boolean {
  if (!stored) return false;
  const rules = stored.scope.slice(stored.scope.indexOf(':') + 1);
  try {
    const subject = (JSON.parse(rules) as { subject?: unknown }).subject;
    return Array.isArray(subject) && SUBJECT_PROPERTIES.every((property) => subject.includes(property));
  } catch {
    return false;
  }
}
