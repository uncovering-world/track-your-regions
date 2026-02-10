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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
