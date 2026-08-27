/**
 * What the "In Danger" badge says, and since when.
 *
 * Three surfaces draw the badge — the expanded list row, Discover's card and
 * Discover's detail panel — and each states the same fact about the same site.
 * A site's inscription on the List of World Heritage in Danger is dated, and
 * the date is most of what it means on the ground: the Ancient City of Aleppo
 * has been on that list since 2013, which is a thirteen-year emergency and not
 * a label. So the sentence is written once, here, and the surfaces choose only
 * whether it goes in a chip or a tooltip.
 *
 * `dangerSince` is optional as well as nullable, and the two are different
 * claims: nullable says the server may send `null` — a listing with no year in
 * it — while optional says the key may be absent, which is what an older cached
 * payload or a read that does not carry the field looks like. Both mean the same
 * thing here and both must read as the undated badge rather than as
 * "In Danger since undefined".
 */
export function inDangerLabel(dangerSince?: number | null): string {
  return dangerSince == null ? 'In Danger' : `In Danger since ${dangerSince}`;
}
