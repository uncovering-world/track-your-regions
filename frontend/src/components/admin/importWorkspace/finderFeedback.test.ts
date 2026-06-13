/**
 * Tests for finderFeedback helpers.
 * Covers: found>0, found=0 with next-method hint, found=0 at chain end,
 * autoAssigned, and nextFinderMethod chain order.
 */
import { describe, it, expect } from 'vitest';
import { formatFinderFeedback, nextFinderMethod } from './finderFeedback';
import type { FinderMethod } from './finderFeedback';

// ─── nextFinderMethod ─────────────────────────────────────────────────────────

describe('nextFinderMethod', () => {
  it('returns Points after Geoshape', () => {
    expect(nextFinderMethod('Geoshape')).toBe('Points');
  });

  it('returns Geocode after Points', () => {
    expect(nextFinderMethod('Points')).toBe('Geocode');
  });

  it('returns DB search after Geocode', () => {
    expect(nextFinderMethod('Geocode')).toBe('DB search');
  });

  it('returns AI match after DB search', () => {
    expect(nextFinderMethod('DB search')).toBe('AI match');
  });

  it('returns null at chain end (AI match)', () => {
    expect(nextFinderMethod('AI match')).toBeNull();
  });

  it('returns null for Auto-resolve (subtree op, not in chain)', () => {
    expect(nextFinderMethod('Auto-resolve')).toBeNull();
  });
});

// ─── formatFinderFeedback ─────────────────────────────────────────────────────

describe('formatFinderFeedback', () => {
  describe('found > 0 cases', () => {
    it('reports 1 candidate without autoAssigned note', () => {
      const fb = formatFinderFeedback('Geoshape', 1, 0);
      expect(fb.hasResults).toBe(true);
      expect(fb.message).toBe('Geoshape — 1 candidate');
    });

    it('reports plural candidates', () => {
      const fb = formatFinderFeedback('DB search', 3, 0);
      expect(fb.hasResults).toBe(true);
      expect(fb.message).toBe('DB search — 3 candidates');
    });

    it('appends auto-assigned count when > 0', () => {
      const fb = formatFinderFeedback('Geoshape', 3, 1);
      expect(fb.hasResults).toBe(true);
      expect(fb.message).toBe('Geoshape — 3 candidates (1 auto-assigned)');
    });

    it('pluralises auto-assigned correctly', () => {
      const fb = formatFinderFeedback('Points', 5, 3);
      expect(fb.hasResults).toBe(true);
      expect(fb.message).toBe('Points — 5 candidates (3 auto-assigned)');
    });

    it('does not append Try hint even when nextMethod exists', () => {
      const fb = formatFinderFeedback('Geoshape', 2, 0);
      expect(fb.message).not.toContain('Try');
    });
  });

  describe('found = 0 cases', () => {
    it('includes "Try <next>" when next method exists', () => {
      const fb = formatFinderFeedback('Geoshape', 0, 0);
      expect(fb.hasResults).toBe(false);
      expect(fb.message).toBe('Geoshape — no candidates. Try Points');
    });

    it('includes the correct next method for Geocode', () => {
      const fb = formatFinderFeedback('Geocode', 0, 0);
      expect(fb.hasResults).toBe(false);
      expect(fb.message).toBe('Geocode — no candidates. Try DB search');
    });

    it('omits Try hint when at chain end (AI match)', () => {
      const fb = formatFinderFeedback('AI match', 0, 0);
      expect(fb.hasResults).toBe(false);
      expect(fb.message).toBe('AI match — no candidates');
    });

    it('omits Try hint when nextMethod explicitly passed as null', () => {
      const fb = formatFinderFeedback('Geoshape', 0, 0, null);
      expect(fb.message).toBe('Geoshape — no candidates');
    });

    it('uses the explicit nextMethod override when passed', () => {
      const fb = formatFinderFeedback('Geoshape', 0, 0, 'AI match' as FinderMethod);
      expect(fb.message).toBe('Geoshape — no candidates. Try AI match');
    });

    it('handles Auto-resolve 0 found without hint', () => {
      const fb = formatFinderFeedback('Auto-resolve', 0, 0);
      expect(fb.hasResults).toBe(false);
      expect(fb.message).toBe('Auto-resolve — no candidates');
    });
  });

  describe('edge cases', () => {
    it('autoAssigned=0 produces no auto note even when found>0', () => {
      const fb = formatFinderFeedback('DB search', 1, 0);
      expect(fb.message).not.toContain('auto');
    });

    it('found>0 always sets hasResults=true regardless of autoAssigned', () => {
      expect(formatFinderFeedback('Geocode', 1, 0).hasResults).toBe(true);
      expect(formatFinderFeedback('Geocode', 10, 5).hasResults).toBe(true);
    });

    it('found=0 always sets hasResults=false', () => {
      expect(formatFinderFeedback('Geoshape', 0, 0).hasResults).toBe(false);
    });
  });
});
