/**
 * The words of the line that brings back places that no longer exist, in both
 * lists that offer it — Map mode's region list and Discover's kind list (#609) —
 * drawn by `NoticeLink`.
 */

/**
 * "3 in this region no longer exist — show them", with the singular English wants.
 *
 * "In this region", not "here": the list beside it can answer about less than the
 * region — Map mode's about the map's view (#553), Discover's about one kind — and
 * "here" would promise rows that list then filters out. A reader zoomed into
 * Prague clicking it for three lost objects in Rome saw nothing appear. Map mode
 * counts the region's from the read that fetched the rows; Discover counts the open
 * kind's, so the line never offers what its list would not gain.
 */
export function lostHiddenLabel(count: number): string {
  const verb = count === 1 ? 'exists' : 'exist';
  const them = count === 1 ? 'it' : 'them';
  return `${count} in this region no longer ${verb} — show ${them}`;
}

/** The same line once they are shown: the way to hide them again. */
export const HIDE_LOST_LABEL = 'Hide places that no longer exist';
