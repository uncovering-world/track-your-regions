import { describe, it, expect } from 'vitest';
import {
  IMPORT_SOURCE_TYPES,
  IMPORT_SOURCE_TYPES_ALL,
  WIKIVOYAGE_ELIGIBLE_SOURCE_TYPES_ALL,
  finalizedSourceType,
} from './sourceTypes.js';

describe('import source types', () => {
  it('includes the base layer source', () => {
    expect(IMPORT_SOURCE_TYPES).toContain('base_layer');
  });

  it('pairs every source type with its finalized form', () => {
    expect(IMPORT_SOURCE_TYPES_ALL).toEqual([
      'wikivoyage', 'wikivoyage_done',
      'imported', 'imported_done',
      'base_layer', 'base_layer_done',
    ]);
  });

  it('keeps the Wikivoyage-eligible set free of base-layer world views', () => {
    // A base-layer mirror must never be offered as a target for Wikivoyage
    // extraction. This set reproduces exactly what that endpoint listed before.
    expect(WIKIVOYAGE_ELIGIBLE_SOURCE_TYPES_ALL).toEqual([
      'wikivoyage', 'wikivoyage_done', 'imported', 'imported_done',
    ]);
  });

  it('derives the finalized name by suffix', () => {
    expect(finalizedSourceType('base_layer')).toBe('base_layer_done');
  });
});
