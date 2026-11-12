import { timingSafeEqual } from 'node:crypto';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import type { Queue } from 'bullmq';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Under the API prefix: `/api/ops/queues`. */
export const DASHBOARD_ROUTE = 'ops/queues';

export interface DashboardCredentials {
  user: string;
  pass: string;
}

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Answers 401 with a Basic challenge to anything but the configured user and password. */
export function basicAuth(credentials: DashboardCredentials): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
    const decoded = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '';
    const colon = decoded.indexOf(':');
    if (colon > 0 && same(decoded.slice(0, colon), credentials.user) && same(decoded.slice(colon + 1), credentials.pass)) {
      next();
      return;
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="queues", charset="UTF-8"');
    res.status(401).send('Unauthorized');
  };
}

/** The bull-board router over the given queues, serving its pages and assets under `basePath`. */
export function dashboardRouter(basePath: string, queues: readonly Queue[]): RequestHandler {
  const adapter = new ExpressAdapter();
  adapter.setBasePath(basePath);
  createBullBoard({ queues: queues.map((queue) => new BullMQAdapter(queue)), serverAdapter: adapter });
  return adapter.getRouter() as RequestHandler;
}
