/**
 * Reading one table of a Wikipedia SQL dump, row by row, for a build that
 * keeps something of it: English Wikipedia's structure (#1440) and the
 * redirects readership folds (#1650). A file is read through `readDump`, so
 * it is verified by the checksum and size its dump's status file gives before
 * the build goes on, and its rows are handed over one at a time, a build's
 * writes awaited before the next line.
 */

import type { DumpFile } from '../catalog.js';
import { readDump, type ReadOptions } from '../read.js';
import { InsertReader, type SqlValue } from './sqlInsert.js';

const BATCH = 20_000;

/** What a keeping build of a Wikipedia dump is handed. */
export type TableBuildOptions = ReadOptions & {
  buildId: number; onPhase: (message: string) => void; trial?: boolean;
  onMeasure?: (read: number, total: number) => void;
};

/** Rows gathered and written a batch at a time. */
export class Batches<Row> {
  private rows: Row[] = [];
  written = 0;
  /** `size` rows to a write: fewer where a row is large, as an article's text is. */
  constructor(private readonly write: (rows: Row[]) => Promise<void>, private readonly size = BATCH) {}

  async add(row: Row): Promise<void> {
    this.rows.push(row);
    if (this.rows.length >= this.size) await this.flush();
  }

  async flush(): Promise<void> {
    const rows = this.rows;
    this.rows = [];
    this.written += rows.length;
    await this.write(rows);
  }
}

/**
 * Read one file's inserts into `table`, handing each row to `onRow` (whose
 * writes it waits on before the next line), and finish once the file is
 * verified. A statement the file leaves open is a damaged file. The build's
 * own file (`ownRead`) reports as the build's read; any other reports as a
 * step measured against its own size.
 */
export async function readTable(
  file: DumpFile, table: string, columns: Readonly<Record<number, string>>, options: TableBuildOptions, ownRead: boolean,
  onRow: (row: SqlValue[]) => Promise<void> | void, finish: () => Promise<void>,
): Promise<{ bytes: number; lines: number; checksumActual: string | null }> {
  const pending: Array<Promise<void> | void> = [];
  const reader = new InsertReader(table, row => { pending.push(onRow(row)); }, columns);
  const read: ReadOptions = ownRead ? options : {
    ...options,
    onProgress: ({ downloaded, read: done }) => options.onMeasure?.(done > 0 ? done : downloaded, file.expectedBytes ?? 0),
  };
  return readDump(file, {
    line: async text => {
      reader.line(text);
      for (const write of pending.splice(0)) await write;
    },
    commit: async () => {
      if (reader.open) throw new Error(`${file.fileName} ends inside an insert into ${table}`);
      await finish();
    },
    abort: async () => undefined,
  }, read);
}

