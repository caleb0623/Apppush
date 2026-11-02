# Database design

MySQL 8, managed by Prisma. The schema is [backend/prisma/schema.prisma](../backend/prisma/schema.prisma), and all changes go through [migrations](../backend/prisma/migrations).

## Relationships

```
Application 1---* AppEnvironment 1---* AppCredential
                       |
                       +---* Device *---* Tag  (through DeviceTag)
                       |       |
                       |       *---1 Alias
                       |
                       +---* PushMessage 1---1 ScheduledJob
                               |
                               1
                               |
                               * MessageTarget 1---* DeliveryAttempt
                                       |
                                       1---* MessageEvent

AdminUser 1---* AuditLog        WorkerHeartbeat (standalone)
```

## Tables

| Table | Purpose | Key points |
|---|---|---|
| `AdminUser` | Console users | Unique email, bcrypt password hash, `ADMIN` or `VIEWER` |
| `Application` | Metadata shared by environments | Name, VIP flag, service validity, timezone |
| `AppEnvironment` | Production or testing | Unique AppKey, one of each type per application |
| `AppCredential` | Master Secret generations | Keyed hash only, active or revoked |
| `Device` | Registered devices | Unique registration ID. See below |
| `Tag`, `DeviceTag` | Tags and assignments | Tag names are unique per environment |
| `Alias` | Device aliases | Unique per environment; a device has at most one |
| `PushMessage` | A send request | Unique msgid, idempotency key, strategy, optional channel |
| `MessageTarget` | One message and one recipient | The unit analytics counts |
| `DeliveryAttempt` | Each channel call or skip | Provider, outcome, message ID, raw response |
| `MessageEvent` | Funnel facts | One per stage, with source and `inferred` |
| `ScheduledJob` | Durable work item | One per message |
| `WorkerHeartbeat` | Worker liveness | Used by the health check |
| `AuditLog` | Administrative actions | Actor, action, entity, IP address |

### Device

| Column | Notes |
|---|---|
| `registrationId` | Public device ID, globally unique |
| `installationId` | Set only by the app. **Its presence marks a real device** |
| `pushToken` | FCM token. Sensitive, and never returned by the API |
| `pushTokenStatus` | `ACTIVE`, or `INVALID` once FCM rejects the token |
| `pushTokenUpdatedAt` | When the token last changed |
| `notificationsEnabled` | Whether notifications are allowed, as last reported by the app. Empty for simulated records |
| `deviceSecretHash` | Keyed hash of the device's secret |

### MessageTarget

Attributes such as platform, vendor and app version are copied here when the message is sent. History therefore survives device deletion, and old analytics do not change when a device upgrades.

`deliveryMode` records whether a target is `REAL` or `SIMULATED`, and analytics can filter on it.

### DeliveryAttempt

`providerResponse` holds Google's answer as JSON: the message name on success, or the error code and message on failure. Tokens are stripped from it before saving.

Analytics never count funnel stages from this table, because one target can have several attempts.

## Integrity rules

| Rule | Enforced by |
|---|---|
| One event per stage per target | Unique (`targetId`, `type`) |
| One target per device per message | Unique (`messageId`, `registrationId`) |
| An idempotency key sends once | Unique (`environmentId`, `idempotencyKey`) |
| One device row per installation | Unique (`environmentId`, `installationId`) |
| One device row per FCM token | Unique (`environmentId`, `pushToken`) |
| One job per message | Unique `messageId` |
| Testing limits hold under concurrency | A row lock on `AppEnvironment` during the check |
| Attempt, target and events commit together | A transaction in `recordAcceptance` |

## Deletion

| Deleted | Effect |
|---|---|
| Device | Targets stay, with `deviceId` set to null, so history survives |
| Environment | Its devices, tags, messages and history are removed |
| Application | Refused while environments exist |
| Admin user | Audit records stay, with the actor set to null |

## Main indexes

| Index | Serves |
|---|---|
| `PushMessage (environmentId, createdAt)` | Message history |
| `PushMessage (environmentId, dispatchedAt)` | Analytics date ranges |
| `MessageTarget (messageId, status)` | Finding pending targets |
| `ScheduledJob (status, runAt)` | The worker's poll |
| `ScheduledJob (status, lockedAt)` | Finding stale jobs |
| `MessageEvent (type, occurredAt)` | Event queries |

## Migrations and seed

| Command | Effect |
|---|---|
| `npm run db:migrate` | Applies migrations |
| `npm run db:seed` | Creates the admin user and demo data |

| Migration | Contents |
|---|---|
| `20261030000000_init` | Base schema |
| `20261031000000_real_push_delivery` | Push tokens, delivery mode, provider responses, channel override, inferred events |
| `20261031010000_notification_permission` | Notification permission on the device |

The seed replaces only applications named `[Demo] ...`. Do not register your real phone under a demo application, because re-seeding removes it.

Seed data runs through the real dispatcher against simulated records, so its analytics come from genuine rows. All of it is labelled simulated.
