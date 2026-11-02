import { env } from './config/env.js';
import { SlidingWindowRateLimiter } from './lib/rate-limiter.js';
import { createSimulatedRegistry, type ChannelRegistry } from './modules/delivery/channels.js';
import type { FcmOptions, FcmSender } from './modules/delivery/fcm.js';
import { loadFcmSetup } from './modules/delivery/firebase.js';

/** Everything that varies between production code and tests. */
export interface Deps {
  /** Simulated channels. Devices registered by the app use `fcm` instead. */
  channels: ChannelRegistry;
  fcm: FcmSender | null;
  fcmProblem: string | null;
  fcmOptions: FcmOptions;
  clock: () => Date;
  testingLimiter: SlidingWindowRateLimiter;
  loginLimiter: SlidingWindowRateLimiter;
  clientLimiter: SlidingWindowRateLimiter;
}

export const createDeps = (overrides: Partial<Deps> = {}): Deps => {
  const clock = overrides.clock ?? (() => new Date());
  const setup = 'fcm' in overrides ? { sender: null, problem: null } : loadFcmSetup();
  return {
    clock,
    channels: createSimulatedRegistry(clock),
    fcm: setup.sender,
    fcmProblem: setup.problem,
    fcmOptions: {
      mode: env.FCM_PAYLOAD_MODE,
      ttlSeconds: env.FCM_TTL_SECONDS,
      timeoutMs: env.FCM_TIMEOUT_MS,
    },
    testingLimiter: new SlidingWindowRateLimiter(env.TESTING_ENV_QPS, 1000),
    loginLimiter: new SlidingWindowRateLimiter(20, 60_000),
    clientLimiter: new SlidingWindowRateLimiter(600, 60_000),
    ...overrides,
  };
};
