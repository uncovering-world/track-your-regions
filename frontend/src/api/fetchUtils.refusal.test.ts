import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, setAccessToken } from './fetchUtils';
import { updateWorldView } from './worldViews';

function answer(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false,
    status,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => body,
  }));
}

async function refusalOf(call: Promise<unknown>): Promise<ApiError> {
  const error = await call.then(() => null, (err: unknown) => err);
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

/**
 * What a refused save is shown with. The backend answers a Zod failure with
 * `{ error: 'Validation error', details: [...] }` (`errorHandler.ts`), and the
 * field and its limit live only in `details` — "Validation error" alone names
 * nothing a person can change (#448).
 */
describe('a refused request', () => {
  beforeEach(() => {
    setAccessToken(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names the field a validation refusal names, and keeps every one', async () => {
    answer(400, {
      error: 'Validation error',
      details: [
        { code: 'too_big', path: ['name'], message: 'Too big: expected string to have <=255 characters' },
        { code: 'too_big', path: ['description'], message: 'Too big: expected string to have <=1000 characters' },
      ],
    });

    const error = await refusalOf(updateWorldView(5, { name: 'x'.repeat(300) }));

    expect(error.message).toBe('Validation error — name: Too big: expected string to have <=255 characters (and 1 more)');
    expect(error.sentence).toBe('Validation error');
    expect(error.fieldIssues).toEqual([
      { path: 'name', message: 'Too big: expected string to have <=255 characters' },
      { path: 'description', message: 'Too big: expected string to have <=1000 characters' },
    ]);
  });

  it('dots a nested path', async () => {
    answer(400, { error: 'Validation error', details: [{ path: ['members', 0, 'id'], message: 'Expected number' }] });

    const error = await refusalOf(updateWorldView(5, { name: 'x' }));

    expect(error.message).toBe('Validation error — members.0.id: Expected number');
  });

  it('is the server sentence alone where the refusal names no field', async () => {
    answer(403, { error: 'Admin access required' });

    const error = await refusalOf(updateWorldView(5, { name: 'x' }));

    expect(error.message).toBe('Admin access required');
    expect(error.fieldIssues).toEqual([]);
  });

  it('ignores details that are not an issue list', async () => {
    answer(409, { error: 'Conflict', details: { held: 3 } });

    const error = await refusalOf(updateWorldView(5, { name: 'x' }));

    expect(error.message).toBe('Conflict');
    expect(error.fieldIssues).toEqual([]);
  });
});
