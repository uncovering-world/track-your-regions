import { describe, expect, it } from 'vitest';
import { shouldPromoteToAdmin } from './adminBootstrap.js';

const base = { adminExists: false, adminEmail: null as string | null, accountEmail: 'me@x.com', verified: true, isProduction: false };

describe('shouldPromoteToAdmin', () => {
  it('never promotes when an admin already exists', () => {
    expect(shouldPromoteToAdmin({ ...base, adminExists: true })).toBe(false);
  });
  it('never promotes an unverified account', () => {
    expect(shouldPromoteToAdmin({ ...base, verified: false })).toBe(false);
  });
  it('promotes the first verified user in dev when ADMIN_EMAIL is unset', () => {
    expect(shouldPromoteToAdmin({ ...base })).toBe(true);
  });
  it('does NOT use first-user fallback in production', () => {
    expect(shouldPromoteToAdmin({ ...base, isProduction: true })).toBe(false);
  });
  it('promotes only the matching email when ADMIN_EMAIL is set (prod or dev)', () => {
    expect(shouldPromoteToAdmin({ ...base, adminEmail: 'me@x.com', isProduction: true })).toBe(true);
    expect(shouldPromoteToAdmin({ ...base, adminEmail: 'other@x.com', isProduction: true })).toBe(false);
  });
});
