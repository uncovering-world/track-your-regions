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

import { createReadStream, createWriteStream, type WriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { createGunzip, createGzip } from 'node:zlib';
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

/** A gzip file of `Terms`, one JSON line each, written as the pass goes and read back once. */
export class TermsSpool {
  private readonly gzip = createGzip({ level: 1 });
  private readonly file: WriteStream;
  private closed: Promise<void> | null = null;

  constructor(readonly path: string) {
    this.file = createWriteStream(path);
    this.gzip.pipe(this.file);
  }

  async write(terms: Terms): Promise<void> {
    await this.writeText(`${JSON.stringify(terms)}\n`);
  }

  /** Lines already written as the spool keeps them, a batch's worth at once (`writeFactsOf`). */
  async writeText(text: string): Promise<void> {
    if (!this.gzip.write(text)) await once(this.gzip, 'drain');
  }

  close(): Promise<void> {
    this.closed ??= new Promise<void>((resolve, reject) => {
      this.file.once('close', () => resolve());
      this.file.once('error', reject);
      this.gzip.end();
    });
    return this.closed;
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
