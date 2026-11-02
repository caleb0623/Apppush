export type Platform = 'ANDROID' | 'IOS' | 'HARMONYOS';
export type Status = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type DeliveryMode = 'REAL' | 'SIMULATED';

export interface User {
  id: number;
  email: string;
  name: string;
  role: 'ADMIN' | 'VIEWER';
}

export interface EnvironmentRef {
  id: number;
  type: 'PRODUCTION' | 'TESTING';
  appKey: string;
}

export interface AppSummary {
  id: number;
  name: string;
  description: string | null;
  iconUrl: string | null;
  isVip: boolean;
  serviceValidUntil: string | null;
  timezone: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  environments: EnvironmentRef[];
}

export interface SimulatorSettings {
  mode: 'success' | 'fail' | 'accept_only';
  failureReason?: string;
  failureRate?: number;
}

export interface Environment extends EnvironmentRef {
  applicationId: number;
  callbackUrl: string | null;
  callbackEnabled: boolean;
  ipAllowlist: string[];
  enabledChannels: string[];
  simulatorConfig: Record<string, SimulatorSettings>;
  limits: {
    maxDevices: number;
    maxTags: number;
    maxDevicesPerTag: number;
    maxTagsPerDevice: number;
    maxRequestsPerSecond: number;
  } | null;
  credential: { hint: string; createdAt: string } | null;
  shared: {
    name: string;
    iconUrl: string | null;
    isVip: boolean;
    serviceValidUntil: string | null;
    timezone: string;
    status: string;
  };
  usage?: { devices: number; tags: number; aliases: number; messages: number };
}

export interface AppDetail extends Omit<AppSummary, 'environments'> {
  environments: Environment[];
}

export interface Credentials {
  environmentId?: number;
  appKey: string;
  masterSecret: string;
  notice: string;
}

export interface Device {
  id: number;
  registrationId: string;
  platform: Platform;
  vendor: string | null;
  model: string | null;
  osVersion: string | null;
  appVersion: string;
  status: 'ACTIVE' | 'INACTIVE';
  online: boolean;
  lastActiveAt: string | null;
  createdAt: string;
  alias: string | null;
  tags: string[];
  /** REAL devices registered through the Android app; the rest are simulated records. */
  deliveryMode: DeliveryMode;
  pushTokenStatus: 'ACTIVE' | 'INVALID' | null;
  pushTokenUpdatedAt: string | null;
}

export interface Tag {
  id: number;
  name: string;
  deviceCount: number;
}

export interface Alias {
  id: number;
  name: string;
  devices: { registrationId: string; platform: Platform }[];
}

export interface Summary {
  planned: number;
  valid: number;
  sent: number;
  delivered: number;
  displayed: number;
  clicked: number;
  deliveryRate: number | null;
  displayRate: number | null;
  clickThroughRate: number | null;
  loss: {
    invalid: number;
    notSent: number;
    notDelivered: number;
    notDisplayed: number;
    notClicked: number;
  };
}

export interface Group extends Summary {
  key: string;
}

export interface FailureReason {
  reason: string;
  stage: string;
  count: number;
}

export interface TrendPoint extends Summary {
  bucket: string;
}

export interface Analytics {
  range: { from: string; to: string; timezone: string; granularity: 'day' | 'month' };
  totals: Summary & { messagesDispatched: number; messagesSent: number };
  byDeliveryMode: Group[];
  byPlatform: Group[];
  byChannel: Group[];
  channelAttempts: { channel: string; accepted: number; failed: number; skipped: number }[];
  byMessageType: Group[];
  byAppVersion: Group[];
  failureReasons: FailureReason[];
  trend: TrendPoint[];
  simulated: boolean;
}

export interface Overview {
  today: TrendPoint[];
  yesterday: TrendPoint[];
  yesterdayFunnel: Summary;
  notificationPermission: { enabled: number; known: number; rate: number | null };
}

export interface UserGroup {
  key: string;
  total: number;
  online: number;
  newUsers: number;
  activeUsers: number;
}

export interface UserAnalytics {
  range: { from: string; to: string; timezone: string; granularity: 'day' | 'month' };
  totals: UserGroup;
  trend: { bucket: string; newUsers: number; activeUsers: number }[];
  byPlatform: UserGroup[];
  byVendor: UserGroup[];
  byAppVersion: UserGroup[];
}

export interface MessageAnalytics {
  msgid: string;
  totals: Summary;
  byDeliveryMode: Group[];
  byPlatform: Group[];
  byChannel: Group[];
  byAppVersion: Group[];
  failureReasons: FailureReason[];
}

export interface Job {
  id: number;
  runAt: string;
  status: Status;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  lockedBy: string | null;
  completedAt: string | null;
}

export interface Message {
  id: number;
  msgid: string;
  type: 'NOTIFICATION' | 'CUSTOM' | 'IN_APP';
  title: string | null;
  body: string | null;
  style: string;
  styleConfig: unknown;
  customPayload: unknown;
  platforms: Platform[];
  audienceType: string;
  audience: string[];
  strategy: string;
  channelOverride: string | null;
  scheduleType: 'IMMEDIATE' | 'SCHEDULED';
  scheduledAt: string | null;
  status: Status;
  failureReason: string | null;
  isSimulated: boolean;
  dispatchedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  funnel?: Summary;
  delivery?: { real: number; simulated: number };
  job?: Job | null;
  simulationNotice?: string | null;
  idempotentReplay?: boolean;
}

export interface Attempt {
  id: number;
  attemptNo: number;
  registrationId?: string;
  channel: string;
  provider: string;
  isFallback: boolean;
  isSimulated: boolean;
  outcome: 'DELIVERED' | 'ACCEPTED' | 'FAILED' | 'SKIPPED';
  failureReason: string | null;
  providerMessageId: string | null;
  providerResponse: unknown;
  attemptedAt: string;
}

export interface TargetEvent {
  type: string;
  source: string;
  inferred: boolean;
  occurredAt: string;
}

export interface Target {
  id: number;
  registrationId: string;
  platform: Platform | null;
  appVersion: string | null;
  deliveryMode: DeliveryMode;
  isValid: boolean;
  invalidReason: string | null;
  status: string;
  finalChannel: string | null;
  failureReason: string | null;
  attempts: Attempt[];
  events: TargetEvent[];
}

export interface ScheduledJob extends Job {
  message: {
    msgid: string;
    title: string | null;
    body: string | null;
    type: string;
    strategy: string;
    status: Status;
  };
}

export interface AuditEntry {
  id: number;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string;
  ipAddress: string | null;
  createdAt: string;
}

export interface Health {
  status: string;
  database: string;
  worker: string;
  workerLastSeenAt: string | null;
  deliveryMode: 'real' | 'simulated';
  fcm: {
    configured: boolean;
    projectId: string | null;
    payloadMode: string;
    problem: string | null;
  };
}
