/**
 * Signing in with a provider this server has no credentials for is a refusal,
 * not a crash: its strategy was never registered, and passport would throw
 * "Unknown authentication strategy" as a 500.
 */

import { describe, expect, it } from 'vitest';
import { isConfigured, markConfigured } from '../../auth/strategies/configured.js';
import { startApple } from './oauthController.js';

describe('an OAuth provider this server does not offer', () => {
  it('answers 404 with a sentence the reader can act on', async () => {
    expect(isConfigured('apple')).toBe(false);
    await expect(startApple(undefined, {} as never))
      .rejects.toMatchObject({ statusCode: 404, message: 'Sign in with Apple is not enabled on this server' });
  });

  it('is offered once its strategy has recorded itself', () => {
    markConfigured('google');
    expect(isConfigured('google')).toBe(true);
    expect(isConfigured('apple')).toBe(false);
  });
});
