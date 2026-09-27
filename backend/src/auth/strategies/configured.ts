/**
 * Which OAuth providers this server can sign a caller in with.
 *
 * A provider's strategy is registered only when its credentials are set
 * (`google.ts`, `apple.ts`), and each records itself here when it is. The sign-in
 * routes ask here rather than read the environment again, so the rule for "is
 * Apple on" is stated once: by the strategy that needs the credentials.
 */

export type OAuthProvider = 'google' | 'apple';

const configured = new Set<OAuthProvider>();

export function markConfigured(provider: OAuthProvider): void {
  configured.add(provider);
}

export function isConfigured(provider: OAuthProvider): boolean {
  return configured.has(provider);
}
