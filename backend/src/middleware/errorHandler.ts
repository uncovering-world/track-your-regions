import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodSchema } from 'zod';

export interface ApiError extends Error {
  statusCode: number;
  details?: unknown;
}

export function createError(message: string, statusCode: number, details?: unknown): ApiError {
  const error = new Error(message) as ApiError;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

export function notFound(message = 'Resource not found'): ApiError {
  return createError(message, 404);
}

export function badRequest(message = 'Bad request', details?: unknown): ApiError {
  return createError(message, 400, details);
}

// Error handling middleware
export function errorHandler(
  err: Error | ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('Error:', err);

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation error',
      details: err.errors,
    });
    return;
  }

  // Handle database connection errors
  if ('code' in err && (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.message?.includes('Connection terminated'))) {
    res.status(503).json({
      error: 'Database connection error',
      message: 'Unable to connect to the database. Please ensure PostgreSQL is running.',
    });
    return;
  }

  // A value that did not fit its column (22001, string_data_right_truncation).
  // Without this branch the driver error carries no statusCode, so an input a
  // request schema let through too wide came back as a 500 — masked to
  // "Internal server error" in production, naming nothing.
  //
  // Postgres reports the type and its width here but never the column or the
  // table (checked against a live server with VERBOSITY verbose), so the answer
  // states the limit and leaves the field to the bound in types/index.ts that
  // should have caught it at the boundary. Reaching this branch at all means
  // one of those bounds has drifted from its column again.
  if ('code' in err && err.code === '22001') {
    const width = /character varying\((\d+)\)/.exec(err.message)?.[1];
    res.status(400).json({
      error: width
        ? `A submitted value is longer than the ${width} characters this field allows.`
        : 'A submitted value is longer than this field allows.',
    });
    return;
  }

  const statusCode = 'statusCode' in err ? err.statusCode : 500;

  // In production, mask internal error messages on 500s to avoid leaking implementation details
  const message = statusCode >= 500 && process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message || 'Internal server error';

  res.status(statusCode).json({
    error: message,
    ...('details' in err && err.details ? { details: err.details } : {}),
  });
}

// Validation middleware factory
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic ZodSchema<any> wrapper; per-route schemas are concrete and type-safe
export function validate(schema: ZodSchema<any>, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const data = req[source];
    const result = schema.safeParse(data);

    if (!result.success) {
      throw result.error;
    }

    // Replace with parsed data (includes defaults and transformations)
    req[source] = result.data;
    next();
  };
}
