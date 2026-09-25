import { describe, expect, it } from 'vitest';
import { loginSchema, refreshSchema, registerSchema } from './auth.js';

describe('registerSchema', () => {
  it('accepts valid register payload', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'StrongPass123',
      displayName: 'Test User',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email and short password', () => {
    const result = registerSchema.safeParse({
      email: 'not-an-email',
      password: '123',
      displayName: '',
    });
    expect(result.success).toBe(false);
  });

  it('refuses a display name of spaces, which would show as a blank curator (#998)', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'StrongPass123',
      displayName: '   ',
    });
    expect(result.success).toBe(false);
  });

  it('stores the display name trimmed', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'StrongPass123',
      displayName: '  Ada Lovelace ',
    });
    expect(result.success && result.data.displayName).toBe('Ada Lovelace');
  });
});

describe('loginSchema', () => {
  it('accepts valid login payload', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: 'any-non-empty',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty password', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('refreshSchema', () => {
  it('accepts non-empty refresh token', () => {
    const result = refreshSchema.safeParse({ refreshToken: 'token' });
    expect(result.success).toBe(true);
  });

  it('rejects empty refresh token', () => {
    const result = refreshSchema.safeParse({ refreshToken: '' });
    expect(result.success).toBe(false);
  });
});
