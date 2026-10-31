/**
 * ADR-0167: a Monuments & memorials candidate under the editions line that a
 * Wikivoyage guide uses enters, for a curator (#1989). The ten tops of the
 * kind's canon under the line — the Voortrekker Monument, the Scott Monument,
 * the Kigali Genocide Memorial — are every one used by a guide, and the guide
 * brings few places that are not monuments, where a year of readers brings
 * tombs and historic sites filed as monuments (the #1997 report). So the door
 * asks the guide and nothing else: the pool's floor keeps the obscure out, the
 * rule keeps what is not a monument out, and the curator's gate reads the rest.
 *
 * A row the door admitted stays while a guide uses it, and falls with the guide
 * named in the reason once none does. The door is shut while the source's
 * curator gate is off (ADR-0056 decision 5: every arrival through it is for a
 * person to read) and while no usage build is in place: nothing enters by it,
 * and a held row under the stay line keeps its place until the guide can be
 * read again, as a place keeps its place while no year of readers can be read
 * (`places/guidedLine.ts`).
 */

import { belowLineReason, type LinePair, type LineStanding } from '../sourceLine.js';
import { curatorGateOn } from '../readershipDoor.js';
import { latestUsage, usedByAGuide } from '../../dumps/wikivoyage/usageTables.js';

/** The candidates a Wikivoyage edition uses; null while the door is shut — the gate off, or no usage build in place. */
export type GuideDoor = ReadonlySet<string> | null;

/** The door of `sourceId` over the candidates handed in, read from the usage build while the source's gate is on. */
export async function readGuideDoor(sourceId: number, qids: readonly string[], logPrefix: string): Promise<GuideDoor> {
  if (!(await curatorGateOn(sourceId))) {
    console.log(`${logPrefix} The guide door is shut: the source's curator gate is off (ADR-0056 decision 5), and the held keep their place`);
    return null;
  }
  if (!(await latestUsage())) {
    console.log(`${logPrefix} No Wikivoyage usage is built: the guide door is shut, and the held keep their place`);
    return null;
  }
  return usedByAGuide(qids);
}

/** The curator's question on a row the guide door alone admitted. */
export function guideDoorNote(sitelinks: number, line: LinePair): string {
  return `Admitted below the sitelinks line (${sitelinks} Wikipedia editions, ${line.enterSitelinks} to enter): `
    + 'a Wikivoyage guide uses it. Is it a monument a visitor goes to see?';
}

/** The note on a held row under the stay line, kept while the guide door is shut. */
export function shutDoorNote(sitelinks: number, line: LinePair): string {
  return `Kept below the sitelinks line (${sitelinks} Wikipedia editions, ${line.staySitelinks} to stay): `
    + "the guide door is shut (the source's curator gate is off, or no Wikivoyage usage is built)";
}

/** Why a held row under the stay line falls once no guide uses it. */
export function belowLineUnguidedReason(sitelinks: number, line: LinePair): string {
  return `${belowLineReason(sitelinks, line)}, and no Wikivoyage guide uses it`;
}

export type GuideEntry = { readershipNote: string } | { fell: string } | null;

/**
 * What the guide door says of a candidate the line did not keep: in with the
 * curator's question where a guide uses it, fallen with the guide named where
 * the source held it, kept while the door is shut — and nothing (null) for a
 * candidate never in that no guide uses, which the line's own answer decides.
 */
export function guideDoorEntry(
  guide: GuideDoor, qid: string, sitelinks: number, standing: LineStanding, line: LinePair,
): GuideEntry {
  if (guide === null) return standing === 'fell' ? { readershipNote: shutDoorNote(sitelinks, line) } : null;
  if (guide.has(qid)) return { readershipNote: guideDoorNote(sitelinks, line) };
  return standing === 'fell' ? { fell: belowLineUnguidedReason(sitelinks, line) } : null;
}
