/**
 * AI Settings Service
 *
 * Reads/writes AI model selections from the ai_settings table.
 * In-memory cache with 60s TTL to avoid DB round-trips on every AI call.
 */

import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { aiSettings } from '../../db/schema.js';

const CACHE_TTL_MS = 60_000;
let cache: Map<string, string> | null = null;
let cacheTime = 0;

async function loadCache(): Promise<Map<string, string>> {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL_MS) return cache;

  const rows = await db.select({ key: aiSettings.key, value: aiSettings.value }).from(aiSettings);
  cache = new Map(rows.map(r => [r.key, r.value]));
  cacheTime = now;
  return cache;
}

function invalidateCache(): void {
  cache = null;
}

/** Per-feature default models (override the global default). */
const FEATURE_DEFAULTS: Record<string, string> = {
  cv_cluster_match: 'o4-mini',
};

/** Get the model ID configured for a feature. Uses per-feature default, then global default (gpt-4.1-mini). */
export async function getModelForFeature(feature: string): Promise<string> {
  const settings = await loadCache();
  // eslint-disable-next-line security/detect-object-injection -- feature is a known internal identifier (e.g., 'groupSuggestion'); FEATURE_DEFAULTS is a module-level const map. Missing keys return undefined (safe).
  return settings.get(`model.${feature}`) ?? FEATURE_DEFAULTS[feature] ?? 'gpt-4.1-mini';
}

/** Get a raw setting value by key. */
export async function getSetting(key: string): Promise<string | undefined> {
  const settings = await loadCache();
  return settings.get(key);
}

/** Get all AI settings (for admin page). */
export async function getAllSettings(): Promise<Record<string, string>> {
  const settings = await loadCache();
  return Object.fromEntries(settings);
}

/** Update a single AI setting. */
export async function updateSetting(key: string, value: string): Promise<void> {
  await db.insert(aiSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: aiSettings.key,
      set: { value, updatedAt: sql`NOW()` },
    });
  invalidateCache();
}
