import { randomUUID } from 'node:crypto';
import express, { Application, NextFunction, Request, Response } from 'express';
import { logger } from '../logger';
import { eventsRouter } from './routes/events';
import { healthRouter } from './routes/health';

const MAX_URL_LENGTH = 4096;
const MAX_REQUEST_ID_LENGTH = 128;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

const urlLengthGuard = (req: Request, res: Response, next: NextFunction): void => {
  if (req.url.length > MAX_URL_LENGTH) {
    res.status(414).end();
    return;
  }
  next();
};

const noStoreMiddleware = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

const resolveRequestId = (incoming: string | undefined): string => {
  const id = incoming?.trim();
  if (id && id.length <= MAX_REQUEST_ID_LENGTH && REQUEST_ID_PATTERN.test(id)) {
    return id;
  }
  return randomUUID();
};

// Honor a caller-supplied request id, otherwise mint one. Echo it back so
// clients can correlate. Stash it on res.locals for handlers that want it.
const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const id = resolveRequestId(req.header('x-request-id'));
  res.setHeader('X-Request-Id', id);
  res.locals.requestId = id;
  next();
};

const requestLogMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    logger.info(
      {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms,
        requestId: res.locals.requestId,
      },
      'request',
    );
  });
  next();
};

const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void => {
  logger.error({ err, requestId: res.locals.requestId }, 'unhandled error in request');
  if (res.headersSent) return;
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'internal server error',
    },
  });
};

export const createApp = (): Application => {
  const app = express();
  app.disable('x-powered-by');
  // Order matters: requestId, no-store, and request logging must run before
  // any handler that can short-circuit, so 414 responses still carry the
  // documented headers and show up in the access log.
  app.use(requestIdMiddleware);
  app.use(noStoreMiddleware);
  app.use(requestLogMiddleware);
  app.use(urlLengthGuard);
  app.use(eventsRouter);
  app.use(healthRouter);
  app.use(errorHandler);
  return app;
};
