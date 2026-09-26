import { Request, Response, NextFunction } from 'express';
import { z } from 'zod/v4';
import { isVisitedRegionDelete, VISITED_REGION_REFUSAL } from '../db/regionVisits.js';
import { ReaderFacingError } from '../api/readerFacingError.js';

export interface ApiError extends Error {
  statusCode: number;
  details?: unknown;
  /** A cause the reader can act on, named for the client to branch on (`quota_exceeded`). */
  code?: string;
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

/**
 * A failure the product names, whatever its status: the sentence reaches the
 * reader in production too, where a 5xx's own text is otherwise masked. For a
 * sentence this codebase wrote ("AI features are not available"), never for
 * text an upstream or a driver put in an error (#1021).
 */
export function failure(message: string, statusCode: number, code?: string): ApiError {
  const error = new ReaderFacingError(message) as ReaderFacingError & ApiError;
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

/**
 * A refusal whose answer carries more than its sentence — the row as it now
 * stands, for the client to redraw from — sent as written. `error` is a
 * sentence the product wrote; every other key is the handler's own, never an
 * error's text.
 */
export class Refusal extends Error {
  override name = 'Refusal';

  constructor(
    readonly statusCode: number,
    readonly body: { readonly error: string; readonly [detail: string]: unknown },
  ) {
    super(body.error);
  }
}

// Error handling middleware
export function errorHandler(
  err: Error | ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // An answer the handler wrote, not a failure: nothing to log.
  if (err instanceof Refusal) {
    res.status(err.statusCode).json(err.body);
    return;
  }

  console.error('Error:', err);

  if (err instanceof z.ZodError) {
    res.status(400).json({
      error: 'Validation error',
      details: err.issues,
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
  // request schema let through too wide comes back as a 500 — masked to
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

  // A delete that would take a traveller's visit with it (#764). The foreign
  // key refuses it for every region writer; a writer that ran in one
  // transaction has rolled back, so the answer can say the edit was not made.
  if (isVisitedRegionDelete(err)) {
    res.status(409).json({ error: VISITED_REGION_REFUSAL });
    return;
  }

  const statusCode = 'statusCode' in err ? err.statusCode : 500;
  res.status(statusCode).json(ordinaryAnswer(err, statusCode));
}

/** The body of any other failure: its sentence, masked where it may be a library's. */
function ordinaryAnswer(err: Error | ApiError, statusCode: number): Record<string, unknown> {
  // In production, mask internal error messages on 500s to avoid leaking implementation details
  const message = statusCode >= 500 && process.env.NODE_ENV === 'production' && !(err instanceof ReaderFacingError)
    ? 'Internal server error'
    : err.message || 'Internal server error';

  return {
    error: message,
    ...('details' in err && err.details ? { details: err.details } : {}),
    ...(err instanceof ReaderFacingError && 'code' in err && typeof err.code === 'string' ? { code: err.code } : {}),
  };
}

// Validation middleware factory
export function validate(schema: z.ZodType, source: 'body' | 'query' | 'params' = 'body') {
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
