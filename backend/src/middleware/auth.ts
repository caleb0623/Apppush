import type { NextFunction, Request, Response } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import type { AuthUser } from '../types.js';

interface TokenPayload {
  sub: string;
}

export const signToken = (userId: number): string =>
  jwt.sign({ sub: String(userId) }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    algorithm: 'HS256',
  });

export async function authenticateBearer(header: string | undefined): Promise<AuthUser> {
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  let payload: TokenPayload;
  try {
    payload = jwt.verify(header.slice(7), env.JWT_SECRET, {
      algorithms: ['HS256'],
    }) as unknown as TokenPayload;
  } catch {
    throw unauthorized('Token is invalid or expired', 'INVALID_TOKEN');
  }
  const user = await prisma.adminUser.findUnique({ where: { id: Number(payload.sub) } });
  if (!user?.isActive) throw unauthorized('Token is invalid or expired', 'INVALID_TOKEN');
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export async function requireUser(req: Request, _res: Response, next: NextFunction) {
  req.user = await authenticateBearer(req.headers.authorization);
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const isWrite = (req: Request): boolean => !SAFE_METHODS.has(req.method);

/** VIEWER accounts are read-only across the whole API. */
export function assertWriteRole(req: Request): void {
  if (isWrite(req) && req.user?.role !== 'ADMIN') {
    throw forbidden('INSUFFICIENT_ROLE', 'This action requires the ADMIN role');
  }
}

export function requireWriteRole(req: Request, _res: Response, next: NextFunction) {
  assertWriteRole(req);
  next();
}
