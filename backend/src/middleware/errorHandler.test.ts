import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { createError, notFound, badRequest, errorHandler } from './errorHandler.js';

describe('createError', () => {
  it('creates an error with message and status code', () => {
    const err = createError('Something went wrong', 500);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Something went wrong');
    expect(err.statusCode).toBe(500);
  });

  it('attaches optional details', () => {
    const details = { field: 'email', issue: 'invalid format' };
    const err = createError('Validation failed', 422, details);
    expect(err.details).toEqual(details);
  });

  it('sets details to undefined when not provided', () => {
    const err = createError('Oops', 500);
    expect(err.details).toBeUndefined();
  });

  it('works with various status codes', () => {
    expect(createError('a', 400).statusCode).toBe(400);
    expect(createError('b', 401).statusCode).toBe(401);
    expect(createError('c', 403).statusCode).toBe(403);
    expect(createError('d', 409).statusCode).toBe(409);
    expect(createError('e', 503).statusCode).toBe(503);
  });
});

describe('notFound', () => {
  it('creates a 404 error with default message', () => {
    const err = notFound();
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Resource not found');
  });

  it('accepts a custom message', () => {
    const err = notFound('Region not found');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Region not found');
  });
});

describe('badRequest', () => {
  it('creates a 400 error with default message', () => {
    const err = badRequest();
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Bad request');
  });

  it('accepts custom message and details', () => {
    const details = [{ field: 'name', error: 'required' }];
    const err = badRequest('Invalid input', details);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Invalid input');
    expect(err.details).toEqual(details);
  });
});

/** Collects what the handler answered, standing in for an Express response. */
function captureResponse() {
  const sent: { status?: number; body?: { error?: string } } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body as { error?: string };
      return this;
    },
  } as unknown as Response;

  return { res, sent };
}

/**
 * A pg DatabaseError as the driver actually raises it for 22001: code,
 * severity and a message naming the type — no column, no table, no detail
 * (probed against Postgres 16 through the running backend container).
 */
function valueTooLong(width: number): Error {
  return Object.assign(new Error(`value too long for type character varying(${width})`), {
    code: '22001',
    severity: 'ERROR',
    file: 'varchar.c',
    routine: 'varchar',
  });
}

describe('errorHandler', () => {
  beforeEach(() => {
    // The handler logs every error it answers; keep the run readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function handle(err: Error) {
    const { res, sent } = captureResponse();
    errorHandler(err, {} as Request, res, (() => {}) as NextFunction);
    return sent;
  }

  it('answers an over-long value with 400 and the limit it broke', () => {
    const sent = handle(valueTooLong(1000));

    expect(sent.status).toBe(400);
    expect(sent.body?.error).toContain('1000');
  });

  it('still answers 400 when the message names no width', () => {
    // Same class from a type whose message the width regex does not cover.
    const err = Object.assign(new Error('value too long for type character(4)'), { code: '22001' });

    const sent = handle(err);

    expect(sent.status).toBe(400);
    expect(sent.body?.error).toBe('A submitted value is longer than this field allows.');
  });

  it('leaves an ordinary error on 500', () => {
    // The branch above must answer for 22001 only — a genuine fault that
    // happens to reach the handler is still a server error.
    const sent = handle(new Error('boom'));

    expect(sent.status).toBe(500);
  });
});
