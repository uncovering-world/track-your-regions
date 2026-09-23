/**
 * `respond()` holds a success body to its schema, and the ways a body can
 * miss are each pinned here: the ones the compiler sees, by an
 * `@ts-expect-error` that `typecheck:backend` fails on once the error is gone,
 * and the one only the parse sees, a key that arrives by a spread.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { respond, ResponseShapeError, writeEvent } from './respond.js';

const Answer = z.strictObject({
  id: z.number().int(),
  name: z.string().nullable(),
  decidedAt: z.iso.datetime({ offset: true }).nullable(),
  state: z.enum(['pending', 'verified']),
  failed: z.literal(true).optional(),
});

function makeRes(req?: { method: string; baseUrl: string; path: string; route?: { path: string } }) {
  return { json: vi.fn(), status: vi.fn().mockReturnThis(), req };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('respond', () => {
  it('sends a body that matches its schema as it is', () => {
    const res = makeRes();
    const body = { id: 7, name: null, decidedAt: '2026-09-22T10:00:00.000Z', state: 'verified' as const };
    respond(res as never, Answer, body);
    expect(res.json).toHaveBeenCalledWith(body);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('refuses a key the schema does not declare, at compile time and at run time', () => {
    const res = makeRes();
    expect(() => respond(res as never, Answer, {
      id: 7, name: null, decidedAt: null, state: 'pending',
      // @ts-expect-error -- `extra` is not in the schema, and the literal says so
      extra: 1,
    })).toThrow(ResponseShapeError);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('refuses a Date where the wire carries an ISO string, at compile time and at run time', () => {
    const res = makeRes();
    expect(() => respond(res as never, Answer, {
      id: 7, name: null, state: 'pending',
      // @ts-expect-error -- the handler converts a timestamp; `JSON.stringify` is not relied on
      decidedAt: new Date('2026-09-22T10:00:00Z'),
    })).toThrow(/decidedAt: invalid_type/);
  });

  it('refuses a key that arrives by a spread, which only the parse can see', () => {
    const res = makeRes();
    const failed = true as boolean;
    // No `@ts-expect-error` here: TypeScript checks a literal's own keys, and this
    // one compiles. It is the case the parse exists for.
    expect(() => respond(res as never, Answer, {
      id: 7, name: null, decidedAt: null, state: 'pending',
      ...(failed ? { failedWorldViews: [] } : {}),
    })).toThrow(/\(the body\): unrecognized_keys \(failedWorldViews\)/);
  });

  it('names the route by its pattern, never by the address that reached it', () => {
    const res = makeRes({
      method: 'POST', baseUrl: '/api/experiences', path: '/5/publish', route: { path: '/:id/publish' },
    });
    const error = captureShapeError(() => respond(res as never, Answer, {
      id: 5, name: null, decidedAt: null,
      // @ts-expect-error -- a value outside the vocabulary
      state: 'refused',
    }));
    expect(error.message).toContain('POST /api/experiences/:id/publish');
    expect(error.message).not.toContain('/5/');
    expect(error.message).toContain('The write may already have committed.');
    expect(error.statusCode).toBe(500);
    expect(error).not.toBeInstanceOf(z.ZodError);
  });

  it('does not say a read may have committed anything', () => {
    const res = makeRes({ method: 'GET', baseUrl: '/api/experiences', path: '/5/locations', route: { path: '/:id/locations' } });
    const error = captureShapeError(() => respond(res as never, Answer, {
      id: 5, name: null, decidedAt: null, state: 'pending',
      // @ts-expect-error -- an undeclared key again, on a read this time
      extra: true,
    }));
    expect(error.message).toContain('GET /api/experiences/:id/locations');
    expect(error.message).not.toContain('committed');
  });

  it('counts the issues past the first ten instead of listing them', () => {
    const Wide = z.strictObject(Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`f${i}`, z.number()]),
    ));
    const body = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}`, 'x']));
    const error = captureShapeError(() => respond(makeRes() as never, Wide, body as never));
    expect(error.message).toContain('and 2 more');
    expect(error.message).toContain('f9: invalid_type');
    expect(error.message).not.toContain('f10: invalid_type');
  });

  it('sends without parsing in production, whatever the body holds', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', '');
    const res = makeRes();
    const body = { id: 7, name: null, decidedAt: null, state: 'pending' as const, extra: 1 };
    respond(res as never, Answer, body as never);
    expect(res.json).toHaveBeenCalledWith(body);
  });

  it('treats an unset NODE_ENV as production, so a missing variable does not start answering 500', () => {
    vi.stubEnv('NODE_ENV', undefined);
    vi.stubEnv('VITEST', '');
    const res = makeRes();
    respond(res as never, Answer, { extra: 1 } as never);
    expect(res.json).toHaveBeenCalled();
  });

  it('parses under vitest even where the shell exports production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', 'true');
    expect(() => respond(makeRes() as never, Answer, { extra: 1 } as never)).toThrow(ResponseShapeError);
  });
});

function captureShapeError(send: () => void): ResponseShapeError {
  try {
    send();
  } catch (error) {
    if (error instanceof ResponseShapeError) return error;
    throw error;
  }
  throw new Error('respond() sent a body that does not match its schema');
}

describe('writeEvent', () => {
  const Event = z.strictObject({ type: z.literal('progress'), step: z.string() });

  it('writes an event that matches its schema as one server-sent data line', () => {
    const res = { write: vi.fn(), req: undefined };
    writeEvent(res as never, Event, { type: 'progress', step: 'Merging 26 cantons' });
    expect(res.write).toHaveBeenCalledWith('data: {"type":"progress","step":"Merging 26 cantons"}\n\n');
  });

  it('refuses a mismatched event before writing it, since the stream can no longer answer 500', () => {
    const res = { write: vi.fn(), req: undefined };
    const late = { type: 'progress' as const, step: 'Merging', elapsed: 3 };
    expect(() => writeEvent(res as never, Event, late)).toThrow(ResponseShapeError);
    expect(res.write).not.toHaveBeenCalled();
  });
});
