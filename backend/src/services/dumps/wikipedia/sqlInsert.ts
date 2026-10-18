/**
 * The rows of a MySQL dump's `INSERT` statements, as Wikimedia's SQL dumps of
 * each wiki's tables write them (#1440):
 *
 *     INSERT INTO `page` VALUES
 *     (10,0,'AccessibleComputing',1,…),
 *     (12,0,'Anarchism',0,…);
 *
 * A value is a number, `NULL`, or a quoted string with mysqldump's backslash
 * escapes (`\'`, `\\`, `\n`, `\0`, …).
 */

export type SqlValue = string | number | null;

/** What a backslash and the character after it stand for, where that is not the character itself. */
const ESCAPES: Readonly<Record<string, string>> = { '0': '\0', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a' };

const QUOTE = 39; // '
const OPEN = 40; // (
const CLOSE = 41; // )
const COMMA = 44; // ,
const SEMICOLON = 59;

/**
 * Reads the rows a dump inserts into `table`, a line at a time, as the dump's
 * reader hands the lines over. A statement starts on the line that names the
 * table, and either holds every row on that line (`(…),(…);`) or, as
 * Wikimedia's dumps write it since 2026, one row a line after it, each ended
 * by a comma and the last by the semicolon. Lines outside a statement — the
 * table's definition, comments, `LOCK TABLES` — hold no row. A row cut off
 * inside the line is an error: the file is damaged.
 *
 * A reader given `columns` — the names it reads at which positions — holds
 * the table's `CREATE TABLE` to them before the first row: a dump whose table
 * names another column there, or declares none, is refused rather than read
 * by position into the wrong values.
 */
export class InsertReader {
  private inStatement = false;
  private inCreate = false;
  private readonly declared: string[] = [];
  private checked = false;
  /** Where the line's next backslash is, at or past where the last string began; -1 for none. */
  private backslash = -1;
  private readonly head: string;
  private readonly create: string;

  constructor(
    private readonly table: string,
    private readonly onRow: (values: SqlValue[]) => void,
    private readonly columns?: Readonly<Record<number, string>>,
  ) {
    this.head = `INSERT INTO \`${table}\` VALUES`;
    this.create = `CREATE TABLE \`${table}\` (`;
  }

  /** Reads one line, and says how many rows it held. */
  line(line: string): number {
    let at = 0;
    if (!this.inStatement) {
      if (this.declares(line) || !line.startsWith(this.head)) return 0;
      this.checkColumns();
      this.inStatement = true;
      at = this.head.length;
      if (line.charCodeAt(at) === 32) at += 1;
      if (at >= line.length) return 0;
    }
    this.backslash = line.indexOf('\\', at);
    let rows = 0;
    while (at < line.length) {
      at = this.row(line, at);
      rows += 1;
      const after = line.charCodeAt(at);
      at += 1;
      if (after === COMMA) continue;
      if (after === SEMICOLON) { this.inStatement = false; return rows; }
      throw new Error(`An insert into ${this.table} has no separator after a row`);
    }
    return rows;
  }

  /** Whether the reader is inside a statement: at the end of a file, one that never ended. */
  get open(): boolean {
    return this.inStatement;
  }

  /** Whether the line is part of the table's definition, whose column names it keeps. */
  private declares(line: string): boolean {
    if (line.startsWith(this.create)) {
      this.inCreate = true;
      this.declared.length = 0;
      return true;
    }
    if (!this.inCreate) return false;
    if (line.startsWith(')')) this.inCreate = false;
    else {
      const column = /^\s+`(\w+)`/.exec(line);
      if (column) this.declared.push(column[1]);
    }
    return true;
  }

  private checkColumns(): void {
    if (this.checked || !this.columns) return;
    if (this.declared.length === 0) throw new Error(`The dump inserts into ${this.table} without declaring its columns first`);
    for (const [position, name] of Object.entries(this.columns)) {
      const found = this.declared[Number(position)];
      if (found !== name) {
        const there = found ? '`' + found + '`' : 'no column';
        throw new Error(`The dump's ${this.table} table has ${there} at position ${Number(position) + 1}, where ${name} is read`);
      }
    }
    this.checked = true;
  }

  private row(line: string, from: number): number {
    const { table } = this;
    if (line.charCodeAt(from) !== OPEN) throw new Error(`An insert into ${table} has no row at character ${from}`);
    let at = from + 1;
    const values: SqlValue[] = [];
    for (;;) {
      const read = line.charCodeAt(at) === QUOTE ? this.quoted(line, at + 1) : bare(line, at, table);
      values.push(read.value);
      at = read.at;
      const next = line.charCodeAt(at);
      at += 1;
      if (next === CLOSE) break;
      if (next !== COMMA) throw new Error(`An insert into ${table} breaks off inside a row at character ${at - 1}`);
    }
    this.onRow(values);
    return at;
  }

  /**
   * A quoted string starting at `from` (past its quote): its text with the
   * escapes undone, and where the line goes on. The line's next backslash is
   * looked for again only once a string has passed it, so a line of many
   * strings and no backslash is scanned once, not once a string.
   */
  private quoted(line: string, from: number): { value: string; at: number } {
    let text = '';
    let start = from;
    for (;;) {
      const quote = line.indexOf("'", start);
      if (quote === -1) throw new Error(`An insert into ${this.table} ends inside a string`);
      if (this.backslash !== -1 && this.backslash < start) this.backslash = line.indexOf('\\', start);
      if (this.backslash === -1 || this.backslash > quote) return { value: text + line.slice(start, quote), at: quote + 1 };
      const escaped = line[this.backslash + 1];
      text += line.slice(start, this.backslash) + (ESCAPES[escaped] ?? escaped);
      start = this.backslash + 2;
    }
  }
}

/** A number or `NULL` starting at `from`, and where the line goes on. */
function bare(line: string, from: number, table: string): { value: number | null; at: number } {
  let end = from;
  while (end < line.length && line.charCodeAt(end) !== COMMA && line.charCodeAt(end) !== CLOSE) end += 1;
  const token = line.slice(from, end);
  if (token === 'NULL') return { value: null, at: end };
  const value = Number(token);
  if (token === '' || Number.isNaN(value)) throw new Error(`An insert into ${table} holds a value that is no number: ${token.slice(0, 40)}`);
  return { value, at: end };
}

/** A value as text, or null where it is none. */
export const textOf = (value: SqlValue | undefined): string | null => (typeof value === 'string' ? value : null);

/** A value as a number, or null where it is none. */
export const numberOf = (value: SqlValue | undefined): number | null => (typeof value === 'number' ? value : null);
