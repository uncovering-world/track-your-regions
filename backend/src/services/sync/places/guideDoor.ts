/**
 * The guide door a place kind opens under its line: the candidates a
 * Wikivoyage edition uses, read from the usage build while the source's
 * curator gate is on. Monuments & memorials opens it by the guide alone
 * (ADR-0167, `publicArt/guideDoor.ts`); Towers by the guide and a year's
 * readers (ADR-0168, `towers/kind.ts`). What each kind asks of a guided
 * candidate is the kind's; whether the door is open is decided here, once.
 *
 * The door is shut while the source's curator gate is off (ADR-0056 decision
 * 5: every arrival through a door under the line is for a person to read) and
 * while no usage build is in place. Shut, it lets nothing in, and each kind
 * keeps the rows it holds under the line in their place until the guide can be
 * read again, as a place keeps its place while no year of readers can be read
 * (`guidedLine.ts`).
 */

import { curatorGateOn } from '../readershipDoor.js';
import { latestUsage, usedByAGuide } from '../../dumps/wikivoyage/usageTables.js';

/** The candidates a Wikivoyage edition uses; null while the door is shut — the gate off, or no usage build in place. */
export type GuideDoor = ReadonlySet<string> | null;

/** Whether `sourceId`'s guide door opens this run, saying why not in the run's log. */
export async function guideDoorOpen(sourceId: number, logPrefix: string): Promise<boolean> {
  if (!(await curatorGateOn(sourceId))) {
    console.log(`${logPrefix} The guide door is shut: the source's curator gate is off (ADR-0056 decision 5), and the held keep their place`);
    return false;
  }
  if (!(await latestUsage())) {
    console.log(`${logPrefix} No Wikivoyage usage is built: the guide door is shut, and the held keep their place`);
    return false;
  }
  return true;
}

/** The door of `sourceId` over the candidates handed in, read from the usage build while it is open. */
export async function readGuideDoor(sourceId: number, qids: readonly string[], logPrefix: string): Promise<GuideDoor> {
  return (await guideDoorOpen(sourceId, logPrefix)) ? usedByAGuide(qids) : null;
}
