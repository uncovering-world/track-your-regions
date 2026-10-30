/**
 * The line a public clock with a show is held to below Public art's (#2140):
 * crowds gather on the hour under Munich's Rathaus-Glockenspiel, read in 7
 * Wikipedia editions, and under the Olomouc Astronomical Clock, read in 7,
 * while the kind's line asks 22. Editions alone mislead here as they do for
 * towers, so the line reads a year's readers too.
 *
 * Chosen on the dev subset on 2026-10-30 over every item Wikidata files as an
 * astronomical clock or a Glockenspiel, with the year to 2026-09: Munich
 * (65,572 readers a year), Messina (22,206) and Olomouc (16,331) enter; the
 * Gdańsk astronomical clock (7,997) and Besançon's (5,949) do not. A clock
 * kept in a church or a museum some kind offers is that venue's whatever it
 * reads (`publicArtTest.ts`). The record is `docs/tech/experiences.md` §
 * Public art and Monuments & memorials.
 */

import { PUBLIC_CLOCK_CLASSES } from './classes.js';
import type { GuidedLine } from '../places/guidedLine.js';

/** A public clock enters with 5 editions and 15,000 readers a year, and stays with 4 and 10,000. No guide door. */
export const CLOCK_LINE: GuidedLine = {
  enter: { editions: 5, readers: 15_000, guidedReaders: 15_000 },
  stay: { editions: 4, readers: 10_000, guidedReaders: 10_000 },
};

/** Whether a candidate's classes name a public clock with a show. */
export const isPublicClock = (classes: readonly string[]): boolean => classes.some((c) => PUBLIC_CLOCK_CLASSES[c]);
