import type { AppCredential, AppEnvironment, Application, EnvironmentType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { generateAppKey, issueCredential } from '../../lib/credentials.js';
import type { Tx } from '../../lib/prisma.js';
import { CHANNELS } from '../delivery/channels.js';
import { TESTING_LIMITS } from '../limits.js';

export const SECRET_NOTICE =
  'Store this Master Secret now. It is shown only once and cannot be retrieved later.';

/** A testing environment starts as a copy of production, then is configured independently. */
export async function createEnvironment(
  tx: Tx,
  applicationId: number,
  type: EnvironmentType,
  copyFrom?: AppEnvironment,
) {
  const { masterSecret, record } = issueCredential();
  const environment = await tx.appEnvironment.create({
    data: {
      applicationId,
      type,
      appKey: generateAppKey(),
      callbackUrl: copyFrom?.callbackUrl ?? null,
      callbackEnabled: copyFrom?.callbackEnabled ?? false,
      ipAllowlist: (copyFrom?.ipAllowlist ?? []) as Prisma.InputJsonValue,
      enabledChannels: (copyFrom?.enabledChannels ?? [...CHANNELS]) as Prisma.InputJsonValue,
      simulatorConfig: (copyFrom?.simulatorConfig ?? {}) as Prisma.InputJsonValue,
      credentials: { create: record },
    },
  });
  return { environment, masterSecret };
}

export function serializeEnvironment(
  environment: AppEnvironment & { credentials?: AppCredential[] },
  application: Application,
) {
  const active = environment.credentials?.find((c) => c.status === 'ACTIVE');
  return {
    id: environment.id,
    applicationId: environment.applicationId,
    type: environment.type,
    appKey: environment.appKey,
    callbackUrl: environment.callbackUrl,
    callbackEnabled: environment.callbackEnabled,
    ipAllowlist: environment.ipAllowlist,
    enabledChannels: environment.enabledChannels,
    simulatorConfig: environment.simulatorConfig,
    limits:
      environment.type === 'TESTING'
        ? { ...TESTING_LIMITS, maxRequestsPerSecond: env.TESTING_ENV_QPS }
        : null,
    credential: active ? { hint: active.secretHint, createdAt: active.createdAt } : null,
    // Read from the shared Application record; the testing environment inherits these.
    shared: {
      name: application.name,
      iconUrl: application.iconUrl,
      isVip: application.isVip,
      serviceValidUntil: application.serviceValidUntil,
      timezone: application.timezone,
      status: application.status,
    },
  };
}
