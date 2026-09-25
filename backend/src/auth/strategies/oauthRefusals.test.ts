import { describe, expect, it } from 'vitest';
import { OAUTH_REFUSALS, oauthRefusal } from './oauthRefusals.js';

describe('oauthRefusal', () => {
  it.each(Object.entries(OAUTH_REFUSALS))('passes the strategies\' own %s refusal', (_name, sentence) => {
    expect(oauthRefusal({ message: sentence })).toBe(sentence);
  });

  it.each([
    ['a provider\'s error_description, which the caller controls', 'Your account is locked. Call +1 555 0100 to restore it'],
    ['a thrown error\'s text', 'connect ECONNREFUSED 127.0.0.1:5432'],
    ['an empty message', ''],
  ])('refuses %s, and says authentication failed', (_name, message) => {
    expect(oauthRefusal({ message })).toBe('Authentication failed');
  });

  it('says authentication failed when there is no info at all', () => {
    expect(oauthRefusal(undefined)).toBe('Authentication failed');
  });
});
