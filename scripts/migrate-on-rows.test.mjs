import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  addedMigrations, composeDbImage, describeDiff, FILENAME_PATTERN, snapshotDiff, sqlCode, touchedTables,
} from './migrate-on-rows.mjs';
import { repoFile } from './repo-root.mjs';

describe('the migration-on-rows gate', () => {
  it('applies the files the head adds over the base, in filename order', () => {
    expect(addedMigrations(
      ['230-a.sql', '231-b.sql', 'README.md'],
      ['README.md', '233-d.sql', '230-a.sql', '231-b.sql', '232-c.sql'],
    )).toEqual(['232-c.sql', '233-d.sql']);
    expect(addedMigrations(['230-a.sql'], ['230-a.sql', 'README.md'])).toEqual([]);
  });

  it("names 232's shape: a write of source_records and an ALTER TABLE on it", () => {
    const text = `
      -- ALTER TABLE experiences in a comment is no statement.
      BEGIN;
      UPDATE source_records m SET kind_id = NULL WHERE m.kind_id = 10;
      ALTER TABLE source_records ADD CONSTRAINT source_records_kind_or_whole CHECK (true);
      COMMENT ON TABLE source_records IS 'rows of experiences are updated set by set';
      COMMIT;`;
    expect(touchedTables(text)).toEqual([{ name: 'source_records', verbs: ['writes', 'alters'] }]);
  });

  it('reads every statement that writes or alters a table, schema-qualified ones included', () => {
    const text = `
      INSERT INTO workbench.osm_layer_builds (id) VALUES (1);
      DELETE FROM ONLY experience_parts WHERE true;
      TRUNCATE TABLE "Quoted";
      CREATE UNIQUE INDEX IF NOT EXISTS idx_x ON regions (id);
      CREATE INDEX ON experiences (id);
      ALTER TABLE IF EXISTS ONLY world_views DROP COLUMN x;
      DROP TABLE IF EXISTS old_things;
      MERGE INTO users u USING v ON true WHEN MATCHED THEN DO NOTHING;`;
    expect(touchedTables(text).map(({ name, verbs }) => `${verbs.join('+')} ${name}`)).toEqual([
      'writes workbench.osm_layer_builds',
      'writes experience_parts',
      'writes quoted',
      'alters regions',
      'alters experiences',
      'alters world_views',
      'alters old_things',
      'writes users',
    ]);
  });

  it('reads no table out of a trigger declaration or a locking clause', () => {
    const text = `
      CREATE CONSTRAINT TRIGGER t AFTER UPDATE OF admission ON source_records FOR EACH ROW EXECUTE FUNCTION f();
      SELECT 1 FROM regions FOR UPDATE SKIP LOCKED;
      ALTER TABLE x ADD FOREIGN KEY (y) REFERENCES z ON UPDATE CASCADE ON DELETE SET NULL;`;
    expect(touchedTables(text)).toEqual([{ name: 'x', verbs: ['alters'] }]);
  });

  it('takes comments and string literals out of the text it reads, a doubled quote included', () => {
    expect(sqlCode("a -- b\nc /* d */ e 'f''g' h")).toBe("a \nc   e '' h");
  });

  it('holds a migration to the name the runner takes', () => {
    expect(FILENAME_PATTERN.test('232-a-part-record-is-a-record-in-a-whole.sql')).toBe(true);
    expect(FILENAME_PATTERN.test("232-x'; DROP TABLE y.sql")).toBe(false);
  });

  it('runs on the image docker-compose.yml pins for its db service', () => {
    const compose = readFileSync(repoFile('docker-compose.yml'), 'utf8');
    expect(composeDbImage(compose)).toMatch(/^postgis\/postgis:/);
    expect(() => composeDbImage('services:\n  backend:\n    image: node\n')).toThrow(/no image for its db service/);
  });

  it('compares two schemas as sets of lines and says which side holds each', () => {
    const diff = snapshotDiff(
      ['column public.a.x integer not null', 'index public.a CREATE INDEX i ON public.a USING btree (x)'],
      ['column public.a.x integer null', 'index public.a CREATE INDEX i ON public.a USING btree (x)'],
    );
    expect(describeDiff(diff)).toEqual([
      '  - column public.a.x integer not null',
      '  + column public.a.x integer null',
    ]);
    expect(describeDiff({ onlyMigrated: ['a', 'b', 'c'], onlyFresh: [] }, 2)).toEqual(['  - a', '  - b', '  - … and 1 more']);
  });
});
