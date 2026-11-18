/**
 * The runs' side of why a run admitted a place, as figures (#2184): the
 * record is typed once in `@tyr/shared/admissionEvidence`, and every path
 * that writes the curator's note (`admissionNote`) builds one, as do the world
 * tier's editions and readers bars, which write none. The run's upsert writes
 * it on the kind's membership, `source_records.admission_evidence`
 * (ADR-0225), every run. That column holds the evidence beside the
 * membership's current code, admission or refusal; until a refusal's own
 * evidence lands with the reason codes, the admission step clears it on a
 * refusal (`markRefused`, `markNotAdmitted`), so no admission's evidence
 * stands beside a refusal. A row written before the record has none, until
 * its kind's next run.
 */

import type { AdmissionRecord } from '@tyr/shared/admissionEvidence';

/** A record with what a path names beside it: absent keys stay absent. */
export function recordNaming(record: AdmissionRecord, named: Pick<AdmissionRecord, 'categories' | 'osm' | 'namedRuin'>): AdmissionRecord {
  return {
    ...record,
    ...(named.categories?.length ? { categories: named.categories } : {}),
    ...(named.osm ? { osm: named.osm } : {}),
    ...(named.namedRuin ? { namedRuin: named.namedRuin } : {}),
  };
}
