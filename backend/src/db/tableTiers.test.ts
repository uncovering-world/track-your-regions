import { describe, expect, it } from 'vitest';
import { RELATION_SCHEMAS } from './schema.generated.js';
import { TABLE_TIERS, type RelationName } from './tableTiers.js';

/**
 * A table's tier and the schema it sits in agree (ADR-0124): a deployment of
 * the serving tables leaves the workbench schema behind, so a workbench table
 * in `public` would travel with it and a serving one in `workbench` would be
 * left out. The schemas are the generated file's, read from the database
 * db/init builds, so this holds the registry to the schema itself.
 */

const relations = Object.keys(RELATION_SCHEMAS) as RelationName[];

describe('a table\'s tier and its schema', () => {
  it('puts every serving table in public', () => {
    const misplaced = relations.filter(t => TABLE_TIERS[t] === 'serving' && RELATION_SCHEMAS[t] !== 'public');
    expect(misplaced).toEqual([]);
  });

  it('puts every workbench table in workbench', () => {
    const misplaced = relations.filter(t => TABLE_TIERS[t] === 'workbench' && RELATION_SCHEMAS[t] !== 'workbench');
    expect(misplaced).toEqual([]);
  });
});
