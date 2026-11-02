import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { pinoHttp } from 'pino-http';
import { ZodError } from 'zod';
import { ApiError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const id = randomUUID();
    res.setHeader('X-Request-Id', id);
    req.id = id;
    return id;
  },
  autoLogging: { ignore: (req) => req.url === '/api/health' },
});

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new ApiError(404, 'ROUTE_NOT_FOUND', `No route matches ${req.method} ${req.path}`));
}

const fromZod = (error: ZodError) =>
  new ApiError(
    400,
    'VALIDATION_ERROR',
    'Request validation failed',
    error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
  );

const isBodyParserError = (error: unknown): error is { status: number; type: string } =>
  typeof error === 'object' && error !== null && 'type' in error && 'status' in error;

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  let apiError: ApiError;
  if (error instanceof ApiError) {
    apiError = error;
  } else if (error instanceof ZodError) {
    apiError = fromZod(error);
  } else if (isBodyParserError(error)) {
    apiError = new ApiError(error.status, 'INVALID_REQUEST_BODY', 'Request body could not be parsed');
  } else {
    req.log?.error({ err: error }, 'Unhandled error');
    apiError = new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }

  res.status(apiError.status).json({
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details === undefined ? {} : { details: apiError.details }),
      requestId: req.id,
    },
  });
}
