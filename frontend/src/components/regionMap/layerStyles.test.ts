import { describe, it, expect } from 'vitest';
import {
  regionFillPaint,
  hullFillPaint,
  regionOutlinePaint,
  hullOutlinePaint,
  contextFillPaint,
  contextOutlinePaint,
  islandFillPaint,
  islandOutlinePaint,
  rootRegionBorderPaint,
  type ExploringParams,
} from './layerStyles';

// ── Helpers ──────────────────────────────────────────────────────────
// MapLibre case expressions have the shape:
//   ['case', condition1, value1, condition2, value2, ..., fallback]
// These helpers extract the ordered values from the flat array form.

/** Extract numeric values from a MapLibre case expression (skipping conditions). */
function caseValues(expr: unknown): number[] {
  if (typeof expr === 'number') return [expr];
  if (!Array.isArray(expr) || expr[0] !== 'case') return [];
  // items after 'case': [cond1, val1, cond2, val2, ..., fallback]
  const items = expr.slice(1);
  const values: number[] = [];
  for (let i = 0; i < items.length; i++) {
    // conditions are arrays, values are numbers
    if (typeof items[i] === 'number') {
      values.push(items[i]);
    }
  }
  return values;
}

/** Extract string values from a MapLibre case expression. */
function caseStringValues(expr: unknown): string[] {
  if (typeof expr === 'string') return [expr];
  if (!Array.isArray(expr) || expr[0] !== 'case') return [];
  const items = expr.slice(1);
  const values: string[] = [];
  for (let i = 0; i < items.length; i++) {
    if (typeof items[i] === 'string') {
      values.push(items[i]);
    }
  }
  return values;
}

/** Find the condition-value pair that uses ['==', ['id'], selectedId] and return its paired value. */
function selectedValue(expr: unknown, selectedId: number): unknown {
  if (!Array.isArray(expr) || expr[0] !== 'case') return undefined;
  const items = expr.slice(1);
  for (let i = 0; i < items.length - 1; i += 2) {
    const cond = items[i];
    if (
      Array.isArray(cond) &&
      cond[0] === '==' &&
      JSON.stringify(cond[1]) === JSON.stringify(['id']) &&
      cond[2] === selectedId
    ) {
      return items[i + 1];
    }
  }
  return undefined;
}

/** Get the fallback (last element) of a case expression. */
function fallbackValue(expr: unknown): unknown {
  if (typeof expr === 'number' || typeof expr === 'string') return expr;
  if (!Array.isArray(expr) || expr[0] !== 'case') return undefined;
  return expr[expr.length - 1];
}

// ── regionFillPaint ──────────────────────────────────────────────────

describe('regionFillPaint', () => {
  const paint = regionFillPaint(42);

  it('uses ["id"] expression (not ["get","id"]) for selected matching', () => {
    const colorExpr = paint!['fill-color'] as unknown[];
    // Find the equality check — should be ['==', ['id'], 42]
    const hasIdExpr = JSON.stringify(colorExpr).includes(JSON.stringify(['==', ['id'], 42]));
    const hasGetIdExpr = JSON.stringify(colorExpr).includes(JSON.stringify(['==', ['get', 'id'], 42]));
    expect(hasIdExpr).toBe(true);
    expect(hasGetIdExpr).toBe(false);
  });

  it('selected fill is indigo (#6366f1)', () => {
    expect(selectedValue(paint!['fill-color'], 42)).toBe('#6366f1');
  });

  it('selected fill opacity (0.22) > hover (0.16) > default (0.08)', () => {
    const opacities = caseValues(paint!['fill-opacity']);
    // Order: selected, hovered, visited, default
    expect(opacities).toEqual([0.22, 0.16, 0.20, 0.08]);
  });

  it('enforces visual hierarchy: selected > hover > default', () => {
    const [selected, hovered, , def] = caseValues(paint!['fill-opacity']);
    expect(selected).toBeGreaterThan(hovered);
    expect(hovered).toBeGreaterThan(def);
  });

  it('uses -1 as fallback selectedId when undefined', () => {
    const paint2 = regionFillPaint(undefined);
    const expr = paint2!['fill-opacity'] as unknown[];
    expect(JSON.stringify(expr)).toContain('-1');
  });
});

// ── hullFillPaint ────────────────────────────────────────────────────

describe('hullFillPaint', () => {
  const paint = hullFillPaint(10);

  it('selected hull fill opacity (0.18) > hover (0.12) > default (0.04)', () => {
    const opacities = caseValues(paint!['fill-opacity']);
    expect(opacities).toEqual([0.18, 0.12, 0.10, 0.04]);
  });

  it('hull opacities are lower than region opacities', () => {
    const hullOpacities = caseValues(paint!['fill-opacity']);
    const regionOpacities = caseValues(regionFillPaint(10)!['fill-opacity']);
    // Each hull value should be ≤ corresponding region value
    for (let i = 0; i < hullOpacities.length; i++) {
      expect(hullOpacities[i]).toBeLessThanOrEqual(regionOpacities[i]);
    }
  });

  it('includes visited state (emerald)', () => {
    const colors = caseStringValues(paint!['fill-color']);
    expect(colors).toContain('#10b981');
  });
});

// ── regionOutlinePaint (normal mode) ─────────────────────────────────

describe('regionOutlinePaint — normal mode', () => {
  const paint = regionOutlinePaint(5);

  it('selected outline color is darker indigo (#4f46e5)', () => {
    expect(selectedValue(paint!['line-color'], 5)).toBe('#4f46e5');
  });

  it('selected width (2) > hovered (1.5) > default (0.75)', () => {
    const widths = caseValues(paint!['line-width']);
    expect(widths).toEqual([2, 1.5, 0.75]);
  });

  it('selected opacity (0.7) > hovered (0.6) > default (0.35)', () => {
    const opacities = caseValues(paint!['line-opacity']);
    expect(opacities).toEqual([0.7, 0.6, 0.35]);
  });

  it('hullOutlinePaint returns identical output', () => {
    const hullPaint = hullOutlinePaint(5);
    expect(hullPaint).toEqual(paint);
  });
});

// ── regionOutlinePaint (exploration mode) ────────────────────────────

describe('regionOutlinePaint — exploration mode', () => {
  it('non-leaf: shows all children outlines in slate (#475569)', () => {
    const exploring: ExploringParams = { active: true, hasSubregions: true };
    const paint = regionOutlinePaint(7, exploring);
    expect(paint!['line-color']).toBe('#475569');
    expect(paint!['line-width']).toBe(1.5);
    expect(paint!['line-opacity']).toBe(0.6);
  });

  it('leaf: selected region outline is visible, siblings hidden', () => {
    const exploring: ExploringParams = { active: true, hasSubregions: false };
    const paint = regionOutlinePaint(7, exploring);

    expect(paint!['line-color']).toBe('#475569');

    // Width: selected → 2.5, others → 0
    const widths = caseValues(paint!['line-width']);
    expect(widths).toEqual([2.5, 0]);

    // Opacity: selected → 0.85, others → 0
    const opacities = caseValues(paint!['line-opacity']);
    expect(opacities).toEqual([0.85, 0]);
  });

  it('without exploring param, returns normal outline', () => {
    const paint = regionOutlinePaint(7);
    // Normal mode has case expressions, not flat values
    expect(Array.isArray(paint!['line-color'])).toBe(true);
  });
});

// ── contextFillPaint ─────────────────────────────────────────────────

describe('contextFillPaint', () => {
  const paint = contextFillPaint(20);

  it('selected context fill is indigo', () => {
    expect(selectedValue(paint!['fill-color'], 20)).toBe('#6366f1');
  });

  it('default sibling fill is slate (#94a3b8)', () => {
    expect(fallbackValue(paint!['fill-color'])).toBe('#94a3b8');
  });

  it('selected (0.10) > hovered (0.08) > default (0.03)', () => {
    const opacities = caseValues(paint!['fill-opacity']);
    expect(opacities).toEqual([0.10, 0.08, 0.03]);
  });

  it('context opacities are much lower than main region opacities', () => {
    const contextOpacities = caseValues(paint!['fill-opacity']);
    const regionOpacities = caseValues(regionFillPaint(20)!['fill-opacity']);
    // Context selected should be much less than region selected
    expect(contextOpacities[0]).toBeLessThan(regionOpacities[0]);
    // Context default should be much less than region default
    expect(contextOpacities[contextOpacities.length - 1]).toBeLessThan(
      regionOpacities[regionOpacities.length - 1],
    );
  });
});

// ── contextOutlinePaint ──────────────────────────────────────────────

describe('contextOutlinePaint', () => {
  const paint = contextOutlinePaint(20);

  it('selected outline is indigo (#6366f1)', () => {
    expect(selectedValue(paint!['line-color'], 20)).toBe('#6366f1');
  });

  it('default sibling outline is slate (#94a3b8)', () => {
    expect(fallbackValue(paint!['line-color'])).toBe('#94a3b8');
  });

  it('selected width (1.5) = hovered (1.5) > default (0.5)', () => {
    const widths = caseValues(paint!['line-width']);
    expect(widths).toEqual([1.5, 1.5, 0.5]);
  });

  it('selected opacity (0.5) = hovered (0.5) > default (0.2)', () => {
    const opacities = caseValues(paint!['line-opacity']);
    expect(opacities).toEqual([0.5, 0.5, 0.2]);
  });

  it('context outline widths are thinner than main outline widths', () => {
    const contextWidths = caseValues(paint!['line-width']);
    const regionWidths = caseValues(regionOutlinePaint(20)!['line-width']);
    // Context selected width < region selected width
    expect(contextWidths[0]).toBeLessThanOrEqual(regionWidths[0]);
  });
});

// ── Static paints ────────────────────────────────────────────────────

describe('islandFillPaint', () => {
  it('has a very low static fill opacity (0.06)', () => {
    expect(islandFillPaint!['fill-opacity']).toBe(0.06);
  });
});

describe('islandOutlinePaint', () => {
  it('has thin lines (0.5px)', () => {
    expect(islandOutlinePaint!['line-width']).toBe(0.5);
  });
});

describe('rootRegionBorderPaint', () => {
  it('is invisible when not hovered (width 0)', () => {
    expect(fallbackValue(rootRegionBorderPaint!['line-width'])).toBe(0);
  });

  it('shows sky blue on hover', () => {
    const colors = caseStringValues(rootRegionBorderPaint!['line-color']);
    expect(colors).toContain('#0ea5e9');
  });
});
