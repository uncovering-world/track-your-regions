import { describe, it, expect } from 'vitest';
import { createError, notFound, badRequest } from './errorHandler.js';

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
