/**
 * The second pass of a subset build (ADR-0105): every kept entity parsed and
 * written in its compact form, every other entity's terms spooled for the
 * labels ring, and the items the kept ones name gathered as the ring.
 */

import type { DumpConsumer } from '../read.js';
import { compactEntity, type DumpEntity, storableJson } from './compactEntity.js';
import { entityJson, entityOf, forEachMainItemValue } from './entityLine.js';
import { IdSet } from './idSets.js';
import { type TermsSpool, termsOf } from './labelsRing.js';
import type { Scope } from './scope.js';
import { type EntityRow, insertEntities } from './subsetTables.js';

/** Rows per insert: a few megabytes of JSON. */
const BATCH = 2000;
/** Inserts in flight at once while the pass reads on. */
const IN_FLIGHT = 3;

export interface WriterCounts {
  written: number;
  spooled: number;
}

export class SubsetWriter implements DumpConsumer {
  readonly ring = new IdSet();
  readonly counts: WriterCounts = { written: 0, spooled: 0 };
  private batch: EntityRow[] = [];
  private readonly inFlight = new Set<Promise<void>>();
  private failure: unknown = null;

  constructor(private readonly scope: Scope, private readonly spool: TermsSpool) {}

  async line(line: string): Promise<void> {
    if (this.failure) throw this.failure;
    const entity = entityOf(line);
    if (!entity) return;
    const kept = entity.kind === 'property' ? this.scope.properties.has(entity.id) : this.scope.kept.has(entity.id);
    if (!kept) {
      const terms = termsOf(`Q${entity.id}`, line);
      if (terms) {
        await this.spool.write(terms);
        this.counts.spooled += 1;
      }
      return;
    }
    if (entity.kind === 'item') forEachMainItemValue(line, (_property, item) => this.ring.add(item));
    const parsed = JSON.parse(entityJson(line)) as DumpEntity;
    this.batch.push({
      id: parsed.id,
      sitelinkCount: Object.keys(parsed.sitelinks ?? {}).length,
      entity: storableJson(JSON.stringify(compactEntity(parsed))),
    });
    if (this.batch.length >= BATCH) await this.flush();
  }

  async commit(): Promise<void> {
    await this.flush();
    await Promise.all(this.inFlight);
    if (this.failure) throw this.failure;
  }

  async abort(): Promise<void> {
    await Promise.allSettled(this.inFlight);
  }

  private async flush(): Promise<void> {
    const rows = this.batch;
    this.batch = [];
    if (rows.length === 0) return;
    while (this.inFlight.size >= IN_FLIGHT) await Promise.race(this.inFlight);
    const insert = insertEntities(rows)
      .then(() => { this.counts.written += rows.length; })
      .catch((error: unknown) => { this.failure ??= error; })
      .finally(() => { this.inFlight.delete(insert); });
    this.inFlight.add(insert);
  }
}
