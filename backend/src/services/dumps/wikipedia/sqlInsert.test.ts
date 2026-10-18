import { describe, expect, it } from 'vitest';
import { InsertReader, type SqlValue } from './sqlInsert.js';

/** The rows the lines of a dump insert into `table`, and whether a statement was left open. */
function read(lines: string[], table: string): { rows: SqlValue[][]; open: boolean } {
  const rows: SqlValue[][] = [];
  const reader = new InsertReader(table, row => rows.push(row));
  for (const line of lines) reader.line(line);
  return { rows, open: reader.open };
}

describe('InsertReader (#1440)', () => {
  it("reads a statement written a row a line, as Wikimedia's dumps write it: numbers, strings and NULL", () => {
    const { rows, open } = read([
      '/*!40000 ALTER TABLE `page` DISABLE KEYS */;',
      'INSERT INTO `page` VALUES',
      "(10,0,'AccessibleComputing',1,0,0.856935107283,'20260920210900','20260920233244',1367012995,111,'wikitext',NULL),",
      "(12,0,'Anarchism',0,0,0.870480291199,'20261006030401','20261006070159',1378247183,114294,'wikitext',NULL);",
      '/*!40000 ALTER TABLE `page` ENABLE KEYS */;',
    ], 'page');
    expect(rows).toEqual([
      [10, 0, 'AccessibleComputing', 1, 0, 0.856935107283, '20260920210900', '20260920233244', 1367012995, 111, 'wikitext', null],
      [12, 0, 'Anarchism', 0, 0, 0.870480291199, '20261006030401', '20261006070159', 1378247183, 114294, 'wikitext', null],
    ]);
    expect(open).toBe(false);
  });

  it('reads a statement that holds every row on one line', () => {
    expect(read(["INSERT INTO `linktarget` VALUES (1,14,'A'),(2,14,'B');"], 'linktarget').rows).toEqual([[1, 14, 'A'], [2, 14, 'B']]);
  });

  it("undoes mysqldump's escapes inside a string", () => {
    const { rows } = read([
      'INSERT INTO `linktarget` VALUES',
      "(1,14,'Kings\\' College'),",
      "(2,14,'A\\\\B'),",
      "(3,0,'Line\\nbreak\\0end'),",
      "(4,14,'Comma, (paren)');",
    ], 'linktarget');
    expect(rows.map(row => row[2])).toEqual(["Kings' College", 'A\\B', 'Line\nbreak\0end', 'Comma, (paren)']);
  });

  it('reads a long line of many strings whose escapes come late, each string undone on its own', () => {
    const many = Array.from({ length: 200 }, (_, i) => `(${i},14,'Plain_${i}')`).join(',');
    const { rows } = read([`INSERT INTO \`linktarget\` VALUES ${many},(200,14,'Late\\'s'),(201,14,'After');`], 'linktarget');
    expect(rows).toHaveLength(202);
    expect(rows.slice(199).map(row => row[2])).toEqual(['Plain_199', "Late's", 'After']);
  });

  it("holds the table's definition to the columns it reads, before the first row", () => {
    const definition = ['CREATE TABLE `linktarget` (', '  `lt_id` bigint(20) unsigned NOT NULL,', '  `lt_namespace` int(11) NOT NULL,',
      '  `lt_title` varbinary(255) NOT NULL,', '  PRIMARY KEY (`lt_id`)', ') ENGINE=InnoDB;'];
    const insert = ['INSERT INTO `linktarget` VALUES', "(1,14,'A');"];
    const reading = (lines: string[], columns: Record<number, string>) => {
      const reader = new InsertReader('linktarget', () => undefined, columns);
      for (const line of lines) reader.line(line);
    };
    expect(() => reading([...definition, ...insert], { 0: 'lt_id', 2: 'lt_title' })).not.toThrow();
    expect(() => reading([...definition, ...insert], { 1: 'lt_title' })).toThrow(/has `lt_namespace` at position 2, where lt_title is read/);
    expect(() => reading(insert, { 0: 'lt_id' })).toThrow(/without declaring its columns/);
  });

  it('holds no row outside a statement into its table', () => {
    expect(read(["INSERT INTO `page_props` VALUES (1,'wikibase_item','Q1',NULL);", 'CREATE TABLE `page` (', '-- MySQL dump 10.19'], 'page').rows)
      .toEqual([]);
  });

  it('refuses a row the file cut off, and says when a statement never ended', () => {
    expect(() => read(['INSERT INTO `page` VALUES', "(10,0,'Accessib"], 'page')).toThrow(/inside a string/);
    expect(() => read(['INSERT INTO `page` VALUES', '(10,0'], 'page')).toThrow();
    expect(() => read(['INSERT INTO `page` VALUES', '(10,abc),'], 'page')).toThrow(/no number/);
    expect(() => read(['INSERT INTO `page` VALUES', '(10,0)'], 'page')).toThrow(/no separator/);
    expect(read(['INSERT INTO `page` VALUES', '(10,0),'], 'page').open).toBe(true);
  });
});
