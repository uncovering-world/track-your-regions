/**
 * What the catalogue's own rows say about themselves.
 *
 * Its own module rather than more of `admin/index.ts`, which is about running
 * and watching syncs: these are claims about the resting state of the data —
 * what the database holds right now, whoever put it there and whenever.
 */

import type { DataAssertion, DataAssertionReport } from '@tyr/shared/api';
import { authFetchJson } from '../fetchUtils';

// What the calls here answer is declared once, as a backend schema (ADR-0066),
// and generated into `@tyr/shared/api`. Passed on from here, so a component
// imports a call's answer from the module of the call.
export type {
  AssertionArea, AssertionKind, AssertionStatus, DataAssertion, DataAssertionReport,
} from '@tyr/shared/api';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/** A statement per assertion over the whole catalogue — about eleven seconds. */
export async function getDataAssertions(): Promise<DataAssertionReport> {
  return authFetchJson<DataAssertionReport>(`${API_URL}/api/admin/data-assertions`);
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
  return authFetchJson<DataAssertion>(`${API_URL}/api/admin/data-assertions/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assertionId }),
  });
}
