/**
 * What to call one of an object's points, and its full name (#1268).
 *
 * Every screen that names a point asks here: the card's places and its
 * out-of-region section, the map's markers and hover card, Discover's panel and
 * the curator's dialogs.
 *
 * **A point is called by its own name, else by its component reference, else by
 * where it is.** Prehistoric Pile Dwellings around the Alps names its parts
 * "See" and "Riesi"; the Via Appia's source leaves its parts unnamed, and each
 * still carries UNESCO's own reference, `1708-003`, which is unique within the
 * object and findable on UNESCO's pages. A point with neither is named by its
 * coordinate, which two points of one object never share. A number off the
 * point's place in the source's list is never the answer: two sources' lists on
 * one merged place both start at 1, and a point waiting on its replacement has
 * no place in the list at all, so "Location 1" named two places (#528).
 *
 * **A component reference is UNESCO's shape**, a site number and a part
 * number, sometimes with a sub-part (`1708-003`, `1584bis-017`, `540-003b 12`).
 * A Wikidata item's id (`Q185382`) is the place's identity in another catalogue
 * rather than a label anybody reads, and a bare site number (`1708`) names the
 * whole site, not a part.
 *
 * **The full name names the object too**, since a component's own name means
 * nothing once it leaves the card: "See" pasted into a search box finds
 * nothing, "Prehistoric Pile Dwellings around the Alps — See (1363-061)" does.
 */

/** What a point needs to be named. `ordinal` is read nowhere; see the note above. */
export interface NameablePoint {
  name?: string | null;
  external_ref?: string | null;
  latitude?: number;
  longitude?: number;
}

/**
 * A point as a card's row carries it — the reference under its camel-case name
 * — in the shape this module reads, so no caller spells the mapping.
 */
export function pointOfRow(row: {
  name: string | null; externalRef?: string | null; latitude: number; longitude: number;
}): NameablePoint {
  return { name: row.name, external_ref: row.externalRef ?? null, latitude: row.latitude, longitude: row.longitude };
}

/** UNESCO's reference of one part of a site: `1708-003`, `1584bis-017`, `540-003b 12`. */
const COMPONENT_REF = /^\d+[a-z]*-\d+[a-z]*(?: \d+)?$/i;

/** The point's component reference, where it has one a reader can use. */
export function componentRef(point: NameablePoint): string | null {
  const ref = point.external_ref?.trim();
  return ref && COMPONENT_REF.test(ref) ? ref : null;
}

/**
 * The point's coordinate as a label: five decimals, about a metre, the precision
 * the world layer's pins are drawn at. Two points of one object closer than that
 * are one place to anybody standing there.
 */
function coordinateLabel(point: NameablePoint): string | null {
  if (point.latitude === undefined || point.longitude === undefined) return null;
  return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
}

/** What to call the point beside its object's other points. */
export function locationLabel(point: NameablePoint): string {
  const name = point.name?.trim();
  if (name) return name;
  return componentRef(point) ?? coordinateLabel(point) ?? 'Point';
}

/**
 * The point's label with its reference, where the label is its own name:
 * "Villa Mairea, Pori (1752-013)", and "1708-003" for a part named by it.
 */
export function locationLabelWithRef(point: NameablePoint): string {
  const label = locationLabel(point);
  const ref = componentRef(point);
  return point.name?.trim() && ref ? `${label} (${ref})` : label;
}

/**
 * What a point's pin and dot on the map are called: its label with its
 * reference, except the one point of an object with no other, which is the
 * object itself and is called nothing of its own — the card reads the
 * museum's name, not a coordinate. Counted over the object's points, not the
 * ones a region draws: one part of a serial site in view is still a part.
 */
export function pinLabel(point: NameablePoint, objectPoints: number): string | null {
  return point.name?.trim() || objectPoints > 1 ? locationLabelWithRef(point) : null;
}

/**
 * The point's full name, its object's included: "Aalto Works — Villa Mairea,
 * Pori (1752-013)", or "Via Appia. Regina Viarum — 1708-003" for a part its
 * source left unnamed.
 */
export function pointFullName(objectName: string, point: NameablePoint): string {
  return `${objectName} — ${locationLabelWithRef(point)}`;
}
