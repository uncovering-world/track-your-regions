/**
 * Where the point dialog's labelled pins and their labels stand on screen
 * (#2273): pins that stand on one point at the zoom drawn are one pin, and no
 * label covers another label or a pin.
 *
 * Pure: the dialog hands in screen positions (`map.project`) and label sizes,
 * and draws what comes back, so the rules are tested without a map.
 *
 * The Cathedral of Santiago de Compostela and its Wikipedia article's point
 * come from the same Wikidata statement and stand on one metre: drawn as two
 * pins, the article's covered the cathedral's, and its label the cathedral's
 * label. Joined, they are one pin whose label names both.
 */

/** A point on screen, in pixels from the map's top left. */
export interface ScreenPoint { x: number; y: number }

/** How close two pins stand, in pixels, before they are one pin: a pin's own width. */
export const SAME_POINT_PX = 24;

/**
 * The pins that stand on one point, as groups of their indexes in order: each
 * pin joins the first group whose first pin stands within `radius` of it.
 */
export function pinGroups(points: readonly ScreenPoint[], radius = SAME_POINT_PX): number[][] {
  const groups: number[][] = [];
  points.forEach((point, index) => {
    const group = groups.find(g => Math.hypot(points[g[0]].x - point.x, points[g[0]].y - point.y) <= radius);
    if (group) group.push(index);
    else groups.push([index]);
  });
  return groups;
}

/** How one more name joins a pin's label: an article's point is the article's, not a place. */
function joined(label: string): string {
  if (label === 'Wikipedia') return "Wikipedia's point";
  const article = /^Wikipedia: (.+)$/.exec(label);
  return article ? `Wikipedia's point for ${article[1]}` : label;
}

/**
 * The one label of pins that stand on one point: "A (this card), and
 * Wikipedia's point". An empty first name gives what follows it alone, ", and
 * Wikipedia's point", which the map draws after a name it may cut short.
 */
export function groupLabel(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  const [first, ...rest] = labels;
  return first === '' ? rest.map(label => `, and ${joined(label)}`).join('')
    : [first, ...rest.map(joined)].join(', and ');
}

/** The side of its pin a label hangs on. */
export type LabelSide = 'bottom' | 'top' | 'right' | 'left';

/** The sides a label is tried on, in order: under its point first, where it always hung. */
export const LABEL_SIDES: readonly LabelSide[] = ['bottom', 'top', 'right', 'left'];

/**
 * A marker pin's box on screen, as MapLibre draws its default pin: 27 × 41,
 * its centre 14 px above the point (the default marker's own offset), so it
 * reaches from 34.5 px above the point to 6.5 px below it. Measured on the
 * dialog's map on 2026-11-03.
 */
export const PIN_BOX = { width: 28, height: 41, centreAbove: 14 };
/** The gap between a pin and its label. */
export const LABEL_GAP = 4;

/** How far a label on each side stands from the point: where its edge or its middle is, in px. */
export const LABEL_REACH = {
  /** A label under the pin: its top edge below the point. */
  below: PIN_BOX.height / 2 - PIN_BOX.centreAbove + LABEL_GAP,
  /** A label above the pin: its bottom edge above the point. */
  above: PIN_BOX.height / 2 + PIN_BOX.centreAbove + LABEL_GAP,
  /** A label beside the pin: its near edge from the point, and its middle above the point. */
  beside: PIN_BOX.width / 2 + LABEL_GAP,
  middle: PIN_BOX.centreAbove,
};

interface Box { left: number; top: number; right: number; bottom: number }

/** The box a pin covers: centred `centreAbove` px above its point. */
function pinBox(at: ScreenPoint): Box {
  const centre = at.y - PIN_BOX.centreAbove;
  return {
    left: at.x - PIN_BOX.width / 2, right: at.x + PIN_BOX.width / 2,
    top: centre - PIN_BOX.height / 2, bottom: centre + PIN_BOX.height / 2,
  };
}

/** The box a label of `size` covers on `side` of the pin at `at`. */
export function labelBox(at: ScreenPoint, size: { width: number; height: number }, side: LabelSide): Box {
  const { width, height } = size;
  const middle = at.y - LABEL_REACH.middle;
  switch (side) {
    case 'bottom': {
      const top = at.y + LABEL_REACH.below;
      return { left: at.x - width / 2, right: at.x + width / 2, top, bottom: top + height };
    }
    case 'top': {
      const bottom = at.y - LABEL_REACH.above;
      return { left: at.x - width / 2, right: at.x + width / 2, top: bottom - height, bottom };
    }
    case 'right': {
      const left = at.x + LABEL_REACH.beside;
      return { left, right: left + width, top: middle - height / 2, bottom: middle + height / 2 };
    }
    case 'left': {
      const right = at.x - LABEL_REACH.beside;
      return { left: right - width, right, top: middle - height / 2, bottom: middle + height / 2 };
    }
  }
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Whether a box leaves the map's canvas, which cuts what is past its edge. */
function leaves(box: Box, bounds: { width: number; height: number }): boolean {
  return box.left < 0 || box.top < 0 || box.right > bounds.width || box.bottom > bounds.height;
}

/**
 * The side each label hangs on: the first of `LABEL_SIDES` where it covers no
 * pin and no label placed before it, and stays on the canvas where `bounds`
 * gives it. Where every side is taken, the side that covers least, so a crowded
 * map still draws each label once. A label of no width is placed nowhere.
 */
export function labelSides(
  pins: readonly ScreenPoint[], sizes: readonly { width: number; height: number }[],
  bounds?: { width: number; height: number },
): LabelSide[] {
  const pinBoxes = pins.map(pinBox);
  const placed: Box[] = [];
  return pins.map((at, index) => {
    const others = [...pinBoxes.filter((_, i) => i !== index), ...placed];
    const covered = (side: LabelSide) => {
      const box = labelBox(at, sizes[index], side);
      return others.filter(other => overlaps(box, other)).length + (bounds && leaves(box, bounds) ? 1 : 0);
    };
    if (sizes[index].width === 0) return 'bottom';
    const side = LABEL_SIDES.find(s => covered(s) === 0)
      ?? [...LABEL_SIDES].sort((a, b) => covered(a) - covered(b))[0];
    placed.push(labelBox(at, sizes[index], side));
    return side;
  });
}
