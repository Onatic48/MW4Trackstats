import type { ErrorRequestHandler } from 'express';
import type { JobErrorCode } from '@mw4trackstats/shared';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: JobErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }

  console.error('[api] Unhandled error:', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected server error occurred',
    },
  });
};
