/**
 * AI Settings Service
 *
 * Reads/writes AI model selections from the ai_settings table.
 * In-memory cache with 60s TTL to avoid DB round-trips on every AI call.
 */

import { pool } from '../../db/index.js';

const CACHE_TTL_MS = 60_000;
let cache: Map<string, string> | null = null;
let cacheTime = 0;

async function loadCache(): Promise<Map<string, string>> {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL_MS) return cache;

  const result = await pool.query('SELECT key, value FROM ai_settings');
  cache = new Map(result.rows.map(r => [r.key as string, r.value as string]));
  cacheTime = now;
  return cache;
}

function invalidateCache(): void {
  cache = null;
}

/** Get the model ID configured for a feature. Falls back to gpt-4.1-mini. */
export async function getModelForFeature(feature: string): Promise<string> {
  const settings = await loadCache();
  return settings.get(`model.${feature}`) ?? 'gpt-4.1-mini';
}

/** Get all AI settings (for admin page). */
export async function getAllSettings(): Promise<Record<string, string>> {
  const settings = await loadCache();
  return Object.fromEntries(settings);
}

/** Update a single AI setting. */
export async function updateSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO ai_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, value],
  );
  invalidateCache();
}
