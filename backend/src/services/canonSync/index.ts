/**
 * Country canon sync — orchestration. Module-level current-run state,
 * following the wv-extract pattern (start / status / cancel; the `finally`
 * uses the captured progress reference to avoid timer races).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../../db/index.js';
import { fetchWikidataCountries } from './wikidataSource.js';
import { fetchNeCountries, fetchNeDisputed, NE_SOURCE_VERSION } from './naturalEarthSource.js';
import { deriveCanon } from './rules.js';
import { matchRootUnits, landDisputeUnits } from './unitMatching.js';
import { loadCanon, createCanonSyncLog, finishCanonSyncLog } from './loader.js';
import type { CanonException, CanonSyncProgress, UnitMatchOverride } from './types.js';

const LOG_PREFIX = '[Canon Sync]';
const configDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config');

let current: CanonSyncProgress | null = null;

function readConfig<T>(file: string, key: string): T {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path built from module dir + literal file names below
  const raw = fs.readFileSync(path.join(configDir, file), 'utf-8');
  return (JSON.parse(raw) as Record<string, T>)[key];
}

function isRunning(p: CanonSyncProgress | null): boolean {
  return !!p && p.status !== 'complete' && p.status !== 'failed' && p.status !== 'cancelled';
}

function checkCancel(progress: CanonSyncProgress): void {
  if (progress.cancel) throw new Error('Canon sync cancelled');
}

async function runSync(progress: CanonSyncProgress, triggeredBy: number | null): Promise<void> {
  try {
    progress.logId = await createCanonSyncLog(triggeredBy);

    progress.status = 'fetching';
    progress.statusMessage = 'Fetching Wikidata + Natural Earth...';
    const [wikidata, neCountries, neDisputed] = await Promise.all([
      fetchWikidataCountries(LOG_PREFIX), fetchNeCountries(), fetchNeDisputed(),
    ]);
    checkCancel(progress);

    progress.status = 'deriving';
    progress.statusMessage = `Deriving canon from ${wikidata.length} Wikidata rows, ${neDisputed.length} NE disputed features...`;
    const exceptions = readConfig<CanonException[]>('exceptions.json', 'exceptions');
    // neCountries is NOT passed to deriveCanon (rules are geometry-free);
    // it feeds matchRootUnits below.
    const draft = deriveCanon({ wikidata, neDisputed, exceptions });
    checkCancel(progress);

    progress.status = 'matching';
    progress.statusMessage = `Matching ${draft.countries.length} countries to country-level units...`;
    const overrides = readConfig<UnitMatchOverride[]>('unit-match-overrides.json', 'overrides');
    const { crosswalk, unmatched } = await matchRootUnits(
      neCountries, draft.countries.map((c) => ({ slug: c.slug, iso3: c.iso3 })), overrides);
    const disputeUnits = new Map<string, { divisionIds: number[]; approximate: boolean }>();
    for (const d of draft.disputes) {
      checkCancel(progress);
      progress.statusMessage = `Landing dispute: ${d.name}`;
      disputeUnits.set(d.slug, await landDisputeUnits(d.neFeature));
    }

    progress.status = 'loading';
    progress.statusMessage = 'Loading canon into DB...';
    const report = await loadCanon(draft, crosswalk, disputeUnits, {
      wikidata: `query.wikidata.org @ ${progress.startedAt} (rules v1)`,
      naturalEarth: NE_SOURCE_VERSION,
    }, unmatched);

    progress.report = report;
    progress.status = 'complete';
    progress.statusMessage =
      `Complete: ${report.countriesTotal} countries (+${report.added.length}/-${report.removed.length}/~${report.changed.length}), `
      + `${report.disputes.length} disputes, ${report.unmatchedRootUnits.length} unmatched root units`;
    await finishCanonSyncLog(progress.logId, 'success', report);
    console.log(`${LOG_PREFIX} ${progress.statusMessage}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    progress.status = progress.cancel ? 'cancelled' : 'failed';
    progress.statusMessage = msg;
    if (progress.logId !== null) {
      await finishCanonSyncLog(progress.logId, progress.status === 'cancelled' ? 'cancelled' : 'failed', progress.report)
        .catch((e) => console.error(`${LOG_PREFIX} failed to finalize log:`, e));
    }
    console.error(`${LOG_PREFIX} ${progress.status}:`, msg);
  }
}

/** Start a canon sync. Returns false if one is already running. */
export function syncCanon(triggeredBy: number | null): boolean {
  if (isRunning(current)) return false;
  const progress: CanonSyncProgress = {
    cancel: false, status: 'fetching', statusMessage: 'Starting...',
    startedAt: new Date().toISOString(), logId: null, report: null,
  };
  current = progress;
  void runSync(progress, triggeredBy);
  return true;
}

export function getCanonSyncStatus(): CanonSyncProgress | null {
  return current;
}

export function cancelCanonSync(): boolean {
  if (!isRunning(current)) return false;
  if (current) { current.cancel = true; current.statusMessage = 'Cancelling...'; }
  return true;
}

export async function getLastCanonLog(): Promise<Record<string, unknown> | null> {
  const res = await pool.query(`
    SELECT id, status, report, source_versions AS "sourceVersions",
           started_at AS "startedAt", completed_at AS "completedAt"
    FROM canon_sync_logs ORDER BY id DESC LIMIT 1`);
  return (res.rows[0] as Record<string, unknown>) ?? null;
}

/** Test hook: clear module state between tests. */
export function _resetForTests(): void {
  current = null;
}
