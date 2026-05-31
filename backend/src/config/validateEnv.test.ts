import { describe, expect, it, vi } from 'vitest';
import { collectEnvIssues, isProductionMode, validateEnv } from './validateEnv.js';

const STRONG = 'x'.repeat(40);
const ok = { NODE_ENV: 'production', JWT_SECRET: STRONG, DB_PASSWORD: 's3cret', ADMIN_EMAIL: 'a@b.com', FRONTEND_URL: 'https://app.example' };

describe('isProductionMode (fail-closed)', () => {
  it('treats unset NODE_ENV as production', () => {
    expect(isProductionMode(undefined)).toBe(true);
  });
  it('treats development and test as non-production', () => {
    expect(isProductionMode('development')).toBe(false);
    expect(isProductionMode('test')).toBe(false);
  });
});

describe('collectEnvIssues', () => {
  it('returns no issues for a strong config', () => {
    expect(collectEnvIssues(ok)).toEqual([]);
  });
  it('flags the literal default secret even though it is long', () => {
    const issues = collectEnvIssues({ ...ok, JWT_SECRET: 'dev-secret-change-in-production' });
    expect(issues.map(i => i.key)).toContain('JWT_SECRET');
  });
  it('flags a too-short secret', () => {
    expect(collectEnvIssues({ ...ok, JWT_SECRET: 'short' }).map(i => i.key)).toContain('JWT_SECRET');
  });
  it('flags the default DB password, missing ADMIN_EMAIL, and non-https FRONTEND_URL', () => {
    const keys = collectEnvIssues({ ...ok, DB_PASSWORD: 'postgres', ADMIN_EMAIL: '', FRONTEND_URL: 'http://app' }).map(i => i.key);
    expect(keys).toEqual(expect.arrayContaining(['DB_PASSWORD', 'ADMIN_EMAIL', 'FRONTEND_URL']));
  });
});

describe('validateEnv', () => {
  it('throws in production when issues exist', () => {
    expect(() => validateEnv({ ...ok, JWT_SECRET: 'short' })).toThrow(/Refusing to start/);
  });
  it('only warns in development', () => {
    const logger = { warn: vi.fn() };
    expect(() => validateEnv({ ...ok, NODE_ENV: 'development', JWT_SECRET: 'short' }, logger)).not.toThrow();
    expect(logger.warn).toHaveBeenCalledOnce();
  });
  it('does not warn for a clean config in development', () => {
    const logger = { warn: vi.fn() };
    expect(() => validateEnv({ ...ok, NODE_ENV: 'development' }, logger)).not.toThrow();
    expect(logger.warn).not.toHaveBeenCalled();
  });
  it('does not warn in dev about production-only requirements (ADMIN_EMAIL, https)', () => {
    const logger = { warn: vi.fn() };
    const devProdOnly = { NODE_ENV: 'development', JWT_SECRET: 'x'.repeat(40), DB_PASSWORD: 's3cret', ADMIN_EMAIL: '', FRONTEND_URL: 'http://localhost:5173' };
    expect(() => validateEnv(devProdOnly, logger)).not.toThrow();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
