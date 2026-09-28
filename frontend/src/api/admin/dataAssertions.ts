/**
 * What the catalogue's own rows say about themselves.
 *
 * Its own module rather than more of `admin/index.ts`, which is about running
 * and watching syncs: these are claims about the resting state of the data —
 * what the database holds right now, whoever put it there and whenever.
 */

import type { DataAssertion, DataAssertionReport } from '../client.generated';
import { getAdminDataAssertions, postAdminDataAssertionsAccept } from '../client.generated';

// What the calls here answer is declared once, as a backend schema (ADR-0066),
// and generated into `client.generated.ts`. Passed on from here, so a component
// imports a call's answer from the module of the call.
export type {
  AssertionArea, AssertionKind, AssertionStatus, DataAssertion, DataAssertionReport,
} from '../client.generated';

/** A statement per assertion over the whole catalogue — about eleven seconds. */
export async function getDataAssertions(): Promise<DataAssertionReport> {
  return getAdminDataAssertions();
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
  return postAdminDataAssertionsAccept({ assertionId });
}
