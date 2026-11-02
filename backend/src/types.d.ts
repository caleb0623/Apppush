import type { AppEnvironment, Application, UserRole } from '@prisma/client';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: UserRole;
}

export interface Actor {
  userId: number | null;
  label: string;
  ip: string | undefined;
}

export interface EnvironmentContext {
  environment: AppEnvironment;
  application: Application;
  actor: Actor;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      scope?: EnvironmentContext;
    }
  }
}
