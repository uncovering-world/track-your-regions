/**
 * Which door a run reads OpenStreetMap through first, by the name an operator
 * writes in `OSM_READER`.
 *
 * Unset, the layer cut from the planet while a fresh one is in place
 * (`chooseOsmReader`, ADR-0134), and the mirror otherwise, because it is the
 * door the site rule was measured on.
 * The name is a preference, not the whole choice: a run that prefers the
 * mirror reads the whole map again through Overpass when the mirror fails,
 * from the first question, so every fact of the run still comes from one door
 * and names it (ADR-0059 decision 2, `oneDoorPerRun.ts`). `overpass` pins the
 * public instances with no way back to the mirror — an operator who chose the
 * door with the stricter manners chose it. `local` reads the layer the dump
 * worker cuts from the planet, with Overpass for the misses it cannot vouch
 * for (`localOsm.ts`, ADR-0134).
 *
 * An unknown name is refused rather than read as the default: an operator
 * who wrote `overpas` in the middle of an outage should learn it at boot and
 * again at the run, not from a run that failed on the mirror an hour later.
 */

import type { OsmReaderName } from './readOsmObjects.js';

/** What the run log calls each door, and what the variable accepts. */
export const OSM_READER_NAMES: readonly OsmReaderName[] = ['qlever', 'overpass', 'local'];

/** The variable an operator sets; named once here, read where the door is built. */
export const OSM_READER_VARIABLE = 'OSM_READER';

/** The door an unset variable opens when no fresh layer is in place. */
export const FALLBACK_OSM_READER: OsmReaderName = 'qlever';

/** What an unset variable means, in the words an operator reads at boot and at the run. */
export const UNSET_OSM_READER = 'unset for the layer while a fresh one is in place, the QLever mirror otherwise';

export function isOsmReaderName(value: string): value is OsmReaderName {
  return (OSM_READER_NAMES as readonly string[]).includes(value);
}

/**
 * The reader a run opens: the one `OSM_READER` names, or, where it is blank,
 * the layer while a fresh one is in place (ADR-0134; `freshLayer` asks) and
 * the mirror otherwise. An operator who names a door keeps it.
 */
export async function chooseOsmReader(value: string | undefined, freshLayer: () => Promise<boolean>): Promise<OsmReaderName> {
  const named = parseOsmReaderName(value);
  if ((value ?? '').trim() !== '') return named;
  return (await freshLayer()) ? 'local' : named;
}

/**
 * The reader a value names.
 *
 * Blank is the fallback, which `chooseOsmReader` puts the layer ahead of —
 * `docker-compose.yml` passes every optional variable as `${VAR:-}`, so an
 * unset one arrives as an empty string; anything else must be one of the
 * names, exactly.
 */
export function parseOsmReaderName(value: string | undefined): OsmReaderName {
  const name = (value ?? '').trim();
  if (name === '') return FALLBACK_OSM_READER;
  if (isOsmReaderName(name)) return name;
  throw new Error(
    `${OSM_READER_VARIABLE} names no reader this catalogue has: "${name}" `
    + `(one of ${OSM_READER_NAMES.join(', ')}, or ${UNSET_OSM_READER})`,
  );
}
