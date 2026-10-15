/**
 * The labels ring of the local Wikidata subset (ADR-0101 decision 2): the
 * labels, in the subset's languages, of every entity a kept item names, with
 * nothing else of that entity. Leonardo has no coordinate and is no class, so
 * he is not kept; the Mona Lisa names him (P170), so his name is.
 *
 * Which entities the ring holds is known only once every kept item has been
 * read, and an entity's line may come before the line that names it. So the
 * second pass writes the terms of every entity it does not keep to a
 * compressed file beside the dump (`TermsSpool`), and the build reads back the
 * ones the ring holds. A line's terms are read without parsing the line: the
 * dump writes `labels` and `descriptions` before `aliases`, and a string value
 * cannot hold that key unescaped.
 */

import { createReadStream } from 'node:fs';
import { type FileHandle, open, rm, truncate } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip, gzipSync } from 'node:zlib';
import { storableText, SUBSET_LANGUAGES } from './compactEntity.js';

export interface Terms {
  id: string;
  /** language → [label, description]; either may be null. */
  terms: Record<string, [string | null, string | null]>;
}

const TERMS_START = '"labels":';
const TERMS_END = ',"aliases":';

const storableOrNull = (text: string | undefined) => (text === undefined ? null : storableText(text));

/** The line's labels and descriptions in `languages`, or null when it has none of them, as Postgres can store them. */
export function termsOf(id: string, line: string, languages: readonly string[] = SUBSET_LANGUAGES): Terms | null {
  const start = line.indexOf(TERMS_START);
  const end = line.indexOf(TERMS_END, start);
  if (start < 0 || end < 0) return null;
  const parsed = JSON.parse(`{${line.slice(start, end)}}`) as {
    labels?: Record<string, { value: string }>;
    descriptions?: Record<string, { value: string }>;
  };
  const terms: Terms['terms'] = {};
  for (const language of languages) {
    const label = storableOrNull(parsed.labels?.[language]?.value);
    const description = storableOrNull(parsed.descriptions?.[language]?.value);
    if (label !== null || description !== null) terms[language] = [label, description];
  }
  return Object.keys(terms).length > 0 ? { id, terms } : null;
}

/**
 * A gzip file of `Terms`, one JSON line each, written as the pass goes and
 * read back once. It is a run of gzip members, one per piece of the pass,
 * each made where the piece was read (a worker thread, #1479) and appended
 * whole, so the file up to the end of any member is a valid spool: a build
 * that picks up after a cut (#1493) truncates it to the end of the last
 * member a written piece recorded, and reads every member as one stream.
 */
export class TermsSpool {
  private bytes = 0;
  private file: FileHandle | null = null;
  /** The appends, one after another, so each member lands whole and in order. */
  private writing: Promise<unknown> = Promise.resolve();

  constructor(readonly path: string) {}

  /** Start the spool empty, or keep the first `keep` bytes of the one already there. */
  async open(keep = 0): Promise<void> {
    if (keep > 0) await truncate(this.path, keep);
    this.file = await open(this.path, keep > 0 ? 'a' : 'w');
    this.bytes = keep;
  }

  /** Append one gzip member; answers the spool's size once it is written. */
  append(member: Uint8Array): Promise<number> {
    const appended = this.writing.then(async () => {
      if (!this.file) throw new Error('The terms spool is not open');
      if (member.length > 0) await this.file.write(member);
      this.bytes += member.length;
      return this.bytes;
    });
    this.writing = appended.catch(() => undefined);
    return appended;
  }

  async write(terms: Terms): Promise<void> {
    await this.append(gzipSync(`${JSON.stringify(terms)}\n`, { level: 1 }));
  }

  async close(): Promise<void> {
    await this.writing;
    await this.file?.close();
    this.file = null;
  }

  async *read(): AsyncGenerator<Terms> {
    await this.close();
    const lines = createInterface({ input: createReadStream(this.path).pipe(createGunzip()), crlfDelay: Infinity });
    for await (const line of lines) if (line) yield JSON.parse(line) as Terms;
  }

  async remove(): Promise<void> {
    await this.close().catch(() => undefined);
    await rm(this.path, { force: true });
  }
}
