export interface RawEnv {
  NODE_ENV?: string;
  JWT_SECRET?: string;
  DB_PASSWORD?: string;
  ADMIN_EMAIL?: string;
  FRONTEND_URL?: string;
}

/**
 * 'always'     — an insecure VALUE that should warn in dev and block prod boot.
 * 'production' — config REQUIRED in production but legitimately absent in dev
 *                (so it must NOT produce dev noise, e.g. ADMIN_EMAIL, https URL).
 */
export type IssueScope = 'always' | 'production';

export interface EnvIssue {
  key: string;
  message: string;
  scope: IssueScope;
}

/** Known placeholder secrets that must never be used as a real signing key. */
const KNOWN_DEFAULT_SECRETS = new Set(['dev-secret-change-in-production']);

/** Fail-closed: an unset NODE_ENV is treated as production for guard purposes. */
export function isProductionMode(nodeEnv: string | undefined): boolean {
  return nodeEnv !== 'development' && nodeEnv !== 'test';
}

export function collectEnvIssues(env: RawEnv): EnvIssue[] {
  const issues: EnvIssue[] = [];
  const secret = (env.JWT_SECRET ?? '').trim();
  if (KNOWN_DEFAULT_SECRETS.has(secret) || secret.length < 32) {
    issues.push({ key: 'JWT_SECRET', message: 'must be a non-default value of at least 32 characters', scope: 'always' });
  }
  if ((env.DB_PASSWORD ?? '') === 'postgres') {
    issues.push({ key: 'DB_PASSWORD', message: 'must not be the default "postgres"', scope: 'always' });
  }
  if (!env.ADMIN_EMAIL) {
    issues.push({ key: 'ADMIN_EMAIL', message: 'must be set in production so the first admin can be bootstrapped', scope: 'production' });
  }
  if (!(env.FRONTEND_URL ?? '').toLowerCase().startsWith('https://')) {
    issues.push({ key: 'FRONTEND_URL', message: 'must use https:// in production', scope: 'production' });
  }
  return issues;
}

/**
 * Throws in production when ANY issue exists. In development, warns only about
 * 'always'-scope issues (insecure values actually present); 'production'-scope
 * requirements are legitimately absent in dev and must not create noise.
 */
export function validateEnv(env: RawEnv, logger: { warn: (m: string) => void } = console): void {
  const issues = collectEnvIssues(env);
  if (issues.length === 0) return;
  const fmt = (list: EnvIssue[]) => list.map(i => `  - ${i.key}: ${i.message}`).join('\n');
  if (isProductionMode(env.NODE_ENV)) {
    throw new Error(`Refusing to start: insecure configuration detected:\n${fmt(issues)}`);
  }
  const devIssues = issues.filter(i => i.scope === 'always');
  if (devIssues.length === 0) return;
  logger.warn(`⚠️  Insecure configuration (allowed in dev, would FAIL in production):\n${fmt(devIssues)}`);
}
