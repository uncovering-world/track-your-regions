/**
 * Which door a run reads OpenStreetMap through first, by the name an operator
 * writes in `OSM_READER`.
 *
 * The mirror unless told otherwise, because it is the door the site rule was
 * measured on and the one whose answers the catalogue's extents came from.
 * The name is a preference, not the whole choice: a run that prefers the
 * mirror reads the whole map again through Overpass when the mirror fails,
 * from the first question, so every fact of the run still comes from one door
 * and names it (ADR-0059 decision 2, `oneDoorPerRun.ts`). `overpass` pins the
 * public instances with no way back to the mirror — an operator who chose the
 * door with the stricter manners chose it.
 *
 * An unknown name is refused rather than read as the default: an operator
 * who wrote `overpas` in the middle of an outage should learn it at boot and
 * again at the run, not from a run that failed on the mirror an hour later.
 */

import type { OsmReaderName } from './readOsmObjects.js';

/** What the run log calls each door, and what the variable accepts. */
export const OSM_READER_NAMES: readonly OsmReaderName[] = ['qlever', 'overpass'];

/** The variable an operator sets; named once here, read where the door is built. */
export const OSM_READER_VARIABLE = 'OSM_READER';

export const DEFAULT_OSM_READER: OsmReaderName = 'qlever';

export function isOsmReaderName(value: string): value is OsmReaderName {
  return (OSM_READER_NAMES as readonly string[]).includes(value);
}

/**
 * The reader a value names.
 *
 * Blank is the default — `docker-compose.yml` passes every optional variable
 * as `${VAR:-}`, so an unset one arrives as an empty string; anything else
 * must be one of the names, exactly.
 */
export function parseOsmReaderName(value: string | undefined): OsmReaderName {
  const name = (value ?? '').trim();
  if (name === '') return DEFAULT_OSM_READER;
  if (isOsmReaderName(name)) return name;
  throw new Error(
    `${OSM_READER_VARIABLE} names no reader this catalogue has: "${name}" `
    + `(one of ${OSM_READER_NAMES.join(', ')}, or unset for ${DEFAULT_OSM_READER})`,
  );
}
