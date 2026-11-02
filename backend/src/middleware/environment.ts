import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AppEnvironment, Application } from '@prisma/client';
import { verifyMasterSecret } from '../lib/credentials.js';
import { ApiError, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import type { Deps } from '../deps.js';
import type { Actor, EnvironmentContext } from '../types.js';
import { assertWriteRole, authenticateBearer, isWrite } from './auth.js';

const normaliseIp = (ip: string | undefined) => ip?.replace(/^::ffff:/, '');

function parseBasic(header: string): { appKey: string; secret: string } {
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 1) throw unauthorized('Invalid AppKey or Master Secret', 'INVALID_CREDENTIALS');
  return { appKey: decoded.slice(0, separator), secret: decoded.slice(separator + 1) };
}

async function fromBasic(header: string, ip: string | undefined): Promise<EnvironmentContext> {
  const { appKey, secret } = parseBasic(header);
  const environment = await prisma.appEnvironment.findUnique({
    where: { appKey },
    include: { application: true, credentials: { where: { status: 'ACTIVE' } } },
  });
  // The same error for an unknown key and a wrong secret avoids revealing which AppKeys exist.
  const valid = environment?.credentials.some((c) => verifyMasterSecret(secret, c.secretHash));
  if (!environment || !valid) {
    throw unauthorized('Invalid AppKey or Master Secret', 'INVALID_CREDENTIALS');
  }
  const allowlist = environment.ipAllowlist as string[];
  if (allowlist.length > 0 && !allowlist.includes(normaliseIp(ip) ?? '')) {
    throw forbidden('IP_NOT_ALLOWED', 'This IP address is not on the allowlist');
  }
  const { application, credentials: _credentials, ...rest } = environment;
  const actor: Actor = { userId: null, label: `appKey:${appKey}`, ip };
  return { environment: rest, application, actor };
}

async function fromBearer(req: Request, envId: number): Promise<EnvironmentContext> {
  const user = await authenticateBearer(req.headers.authorization);
  req.user = user;
  assertWriteRole(req);
  const environment = await prisma.appEnvironment.findUnique({
    where: { id: envId },
    include: { application: true },
  });
  if (!environment) throw notFound('Environment');
  const { application, ...rest } = environment;
  return { environment: rest, application, actor: { userId: user.id, label: user.email, ip: req.ip } };
}

export function assertApplicationUsable(application: Application, now: Date): void {
  if (application.status !== 'ACTIVE') {
    throw forbidden('APP_INACTIVE', 'This application has been deactivated');
  }
  if (application.serviceValidUntil && application.serviceValidUntil < now) {
    throw forbidden('APP_SERVICE_EXPIRED', 'The service validity of this application has expired');
  }
}

export function enforceTestingLimit(deps: Deps, environment: AppEnvironment, res: Response): void {
  if (environment.type !== 'TESTING') return;
  const decision = deps.testingLimiter.consume(`env:${environment.id}`);
  res.setHeader('X-RateLimit-Limit', decision.limit);
  res.setHeader('X-RateLimit-Remaining', decision.remaining);
  if (!decision.allowed) {
    res.setHeader('Retry-After', Math.ceil(decision.retryAfterMs / 1000));
    throw new ApiError(
      429,
      'RATE_LIMITED',
      `Testing environments allow ${decision.limit} requests per second`,
      { retryAfterMs: decision.retryAfterMs },
    );
  }
}

/** Authenticates a request and scopes it to one environment, by Basic credentials or JWT. */
export function resolveEnvironment(deps: Deps): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const envId = req.params.envId === undefined ? null : Number(req.params.envId);
    if (envId !== null && !Number.isInteger(envId)) throw notFound('Environment');

    let scope: EnvironmentContext;
    if (header?.startsWith('Basic ')) {
      scope = await fromBasic(header, req.ip);
      if (envId !== null && scope.environment.id !== envId) {
        throw forbidden('ENVIRONMENT_MISMATCH', 'These credentials belong to another environment');
      }
    } else if (envId === null) {
      throw unauthorized('The open API requires HTTP Basic AppKey:MasterSecret authentication');
    } else {
      scope = await fromBearer(req, envId);
    }

    enforceTestingLimit(deps, scope.environment, res);

    // The console may still read a deactivated app's history; everything else is rejected.
    if (isWrite(req) || header?.startsWith('Basic ')) {
      assertApplicationUsable(scope.application, deps.clock());
    }

    req.scope = scope;
    next();
  };
}

export function scopeOf(req: Request): EnvironmentContext {
  if (!req.scope) throw new Error('resolveEnvironment middleware has not run');
  return req.scope;
}
