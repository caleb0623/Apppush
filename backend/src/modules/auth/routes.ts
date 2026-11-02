import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../../deps.js';
import { ApiError, unauthorized } from '../../lib/errors.js';
import { pageMeta, pageQuery, skipTake } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { requireUser, signToken } from '../../middleware/auth.js';
import { writeAudit } from '../audit/service.js';

const loginBody = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(10).max(200),
});

export const BCRYPT_ROUNDS = 10;

export function authRouter(deps: Deps) {
  const router = Router();

  router.post('/login', async (req, res) => {
    const decision = deps.loginLimiter.consume(`login:${req.ip}`);
    if (!decision.allowed) {
      res.setHeader('Retry-After', Math.ceil(decision.retryAfterMs / 1000));
      throw new ApiError(429, 'RATE_LIMITED', 'Too many login attempts; try again later');
    }
    const { email, password } = loginBody.parse(req.body);
    const user = await prisma.adminUser.findUnique({ where: { email } });
    const matches = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !matches || !user.isActive) {
      throw unauthorized('Incorrect email or password', 'INVALID_LOGIN');
    }
    await prisma.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: deps.clock() } });
    await writeAudit(
      { userId: user.id, label: user.email, ip: req.ip },
      { action: 'auth.login', entityType: 'AdminUser', entityId: user.id },
    );
    res.json({
      data: {
        token: signToken(user.id),
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      },
    });
  });

  router.get('/me', requireUser, (req, res) => {
    res.json({ data: req.user });
  });

  router.post('/change-password', requireUser, async (req, res) => {
    const { currentPassword, newPassword } = changePasswordBody.parse(req.body);
    const authUser = req.user!;
    const user = await prisma.adminUser.findUniqueOrThrow({ where: { id: authUser.id } });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw unauthorized('Current password is incorrect', 'INVALID_LOGIN');
    }
    await prisma.adminUser.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) },
    });
    await writeAudit(
      { userId: user.id, label: user.email, ip: req.ip },
      { action: 'auth.password_changed', entityType: 'AdminUser', entityId: user.id },
    );
    res.status(204).end();
  });

  return router;
}

export const auditRouter = () => {
  const router = Router();
  router.use(requireUser);
  router.get('/', async (req, res) => {
    const page = pageQuery.parse(req.query);
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({ orderBy: { id: 'desc' }, ...skipTake(page) }),
      prisma.auditLog.count(),
    ]);
    res.json({ data: rows, meta: pageMeta(page, total) });
  });
  return router;
};
