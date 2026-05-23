import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';
import { createLogger } from '../logger';
const log = createLogger('error-handler');
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Known application errors
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      log.error({ err, path: req.path, method: req.method }, err.message);
    } else {
      log.warn({ code: err.code, path: req.path, method: req.method }, err.message);
    }
    return res.status(err.statusCode).json({
      error: {
        message: err.message,
        code: err.code,
      },
    });
  }

  // Express built-in errors (PayloadTooLarge, BadRequest, etc.)
  const statusCode = (err as any).statusCode || (err as any).status;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
    log.warn({ code: statusCode, path: req.path, method: req.method }, err.message);
    return res.status(statusCode).json({
      error: {
        message: err.message,
        code: 'REQUEST_ERROR',
      },
    });
  }

  // Unexpected errors — hide details in production
  log.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  return res.status(500).json({
    error: {
      message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
      code: 'INTERNAL_ERROR',
    },
  });
}
