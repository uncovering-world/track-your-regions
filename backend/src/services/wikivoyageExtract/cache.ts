/**
 * File-based JSON cache for Wikivoyage API responses.
 *
 * Key = JSON.stringify(params, sortedKeys).
 * Atomic file writes via write-to-tmp + rename.
 * Auto-saves every 200 writes.
 */

import fs from 'fs';
import path from 'path';
import type { CacheStore } from './types.js';

export class FileCache {
  private store: CacheStore = {};
  private filePath: string;
  private writeCount = 0;
  private dirty = false;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  /** Load cache from disk */
  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf-8');
        this.store = JSON.parse(data) as CacheStore;
        console.log(`[WV Cache] Loaded ${Object.keys(this.store).length} cached responses from ${this.filePath}`);
      }
    } catch (err) {
      console.warn(`[WV Cache] Failed to load cache from ${this.filePath}:`, err);
    }
  }

  /** Get a cached value by key */
  get(key: string): unknown | undefined {
    return this.store[key];
  }

  /** Check if key exists in cache */
  has(key: string): boolean {
    return key in this.store;
  }

  /** Set a value in cache. Auto-saves every 200 writes. */
  set(key: string, value: unknown): void {
    this.store[key] = value;
    this.dirty = true;
    this.writeCount++;
    if (this.writeCount % 200 === 0) {
      this.save();
      console.log(`[WV Cache] Auto-saved (${this.writeCount} writes, ${Object.keys(this.store).length} entries)`);
    }
  }

  /** Build a deterministic cache key from API params */
  static buildKey(params: Record<string, string | number>): string {
    return JSON.stringify(params, Object.keys(params).sort());
  }

  /** Save cache to disk with atomic write (tmp + rename) */
  save(): void {
    if (!this.dirty) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = path.join(dir, `.wv-cache-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
      fs.writeFileSync(tmpPath, JSON.stringify(this.store, null, 0));
      fs.renameSync(tmpPath, this.filePath);
      this.dirty = false;
    } catch (err) {
      console.error(`[WV Cache] Failed to save cache to ${this.filePath}:`, err);
    }
  }

  get size(): number {
    return Object.keys(this.store).length;
  }
}
