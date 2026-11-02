# Architecture

## Overview

The system is a modular monolith with one database, plus a native Android client.

```
 Admin browser                      Android phone
 Vue 3 console                      Kotlin app
      |                               ^        |
      | JWT                           |        | AppKey, then device secret
      v                          data message  | (register, token, events)
 +---------------------+              |        |
 |  Express API        |<-------------+--------+
 |  admin + open API   |              |
 |  client API         |     +------------------+
 +---------------------+     | Firebase Cloud   |
      |          |           | Messaging        |
      |          +---------->| (HTTP v1)        |
      v           send       +------------------+
 +---------+                          ^
 | MySQL 8 |<---- polls ---- +--------+--------+
 +---------+                 | Worker process  |
                             | scheduled sends |
                             +-----------------+
```

| Process | Responsibility |
|---|---|
| API (`server.ts`) | Console and open APIs, the client API, and sending immediate messages |
| Worker (`worker.ts`) | Scheduled messages, retries and crash recovery |
| Vue console | Administration. It holds no credentials except the admin's JWT |
| Android SDK | Registration, receiving, display, event reporting. Any Android app can add it |
| Demo app | A small app built on the SDK |

## Backend modules

| Module | Responsibility |
|---|---|
| `modules/apps`, `environments` | Applications, environments, credentials, and all environment-scoped routes |
| `modules/client` | The API the Android app calls |
| `modules/devices`, `limits.ts` | Device, tag and alias rules, and the testing limits |
| `modules/messages` | Message validation, creation, and event recording |
| `modules/delivery` | Audience resolution, channel plans, adapters and the dispatcher |
| `modules/scheduler` | Durable jobs: claiming, retrying, recovery, cancellation |
| `modules/analytics` | Funnels and breakdowns, computed from events |

## Send sequence

```
Admin        API              FCM           Phone
  |  POST /messages  |          |              |
  |----------------->|          |              |
  |                  | save message + job      |
  |                  | resolve targets         |
  |                  | plan channels           |
  |                  |  send    |              |
  |                  |--------->|              |
  |                  |<---------|              |
  |                  | message ID              |
  |                  | SENT (source PROVIDER)  |
  |<-----------------|          |  data msg    |
  |  msgid           |          |------------->|
  |                  |    DELIVERED            | onMessageReceived
  |                  |<------------------------|
  |                  |    DISPLAYED            | notification shown
  |                  |<------------------------|
  |                  |    CLICKED              | user taps
  |                  |<------------------------|
```

A fast phone can report `DELIVERED` before the API has saved Google's answer. The dispatcher only moves a target out of `PENDING`, so it cannot overwrite that later state.

## What each funnel stage proves

| Stage | Produced by, for a real device | Proves |
|---|---|---|
| Planned | Audience resolution | The message was aimed at this target |
| Valid | Audience resolution | The target can be sent to |
| Sent | FCM's response | **Google accepted it. Nothing more** |
| Delivered | The phone | The app received it |
| Displayed | The phone | Android accepted the notification |
| Clicked | The phone | The user tapped it |

FCM offers no delivery receipt to the sender, so `delivered` can only come from the app. A real channel therefore never returns `DELIVERED`, only `ACCEPTED`.

Each event records its `source`: `PROVIDER`, `DEVICE_CLIENT`, `DELIVERY_SIMULATOR` or `MANUAL_SIMULATION`. Reports can be lost or arrive out of order, so a later stage implies the earlier ones. Those rows are stored with `inferred = true`.

## Delivery strategies

Each strategy expands into at most two steps for one device.

| Strategy | First | Then | Moves on when |
|---|---|---|---|
| `mtpush` | `mtpush` | None | Never. An offline device waits |
| `fcm_mtpush` | FCM | `mtpush` | The first channel fails |
| `pns_mtpush` | Manufacturer channel | `mtpush` | The first channel fails |
| `mtpush_fcm` | `mtpush` | FCM | The device is not online to `mtpush`, or `mtpush` fails |
| `mtpush_pns` | `mtpush` | Manufacturer channel | The device is not online to `mtpush`, or `mtpush` fails |

When a device is not online, the `mtpush` step is recorded as `SKIPPED` with the reason `MTPUSH_OFFLINE`.

On iOS and HarmonyOS, the `fcm` and `pns` slots map to APNs and HarmonyOS push. A channel chosen on the push form replaces the chain.

### Real devices and simulated records

`MessageTarget.deliveryMode` is fixed when targets are resolved. A device is `REAL` if it registered through the app.

| Step | Simulated record | Real device |
|---|---|---|
| FCM | Simulator | `FcmChannel`, which calls Google |
| Any other channel | Simulator | `SKIPPED`, reason `SIMULATOR_CANNOT_REACH_REAL_DEVICE` |

This gives each strategy this result on a real phone:

| Strategy | Result on a real phone |
|---|---|
| `fcm_mtpush` | Delivered through FCM |
| `mtpush_fcm` | `mtpush` skipped as `MTPUSH_OFFLINE`, then delivered through FCM |
| `mtpush`, `pns_mtpush`, `mtpush_pns` | Reported as failed, because nothing in the plan can reach it |

## FCM adapter

- `FcmChannel` (`modules/delivery/fcm.ts`) implements the same `PushChannel` interface as the simulators.
- `FcmSender` is the only code that touches Firebase. Tests inject a mock there.
- `loadFcmSetup` refuses to create a real sender when `NODE_ENV=test`.
- Messages are data-only by default. See [technical-decisions.md](technical-decisions.md).

| FCM result | Reason recorded | Token marked invalid | Fallback runs |
|---|---|---|---|
| Accepted | None | No | No |
| Unregistered token | `TOKEN_UNREGISTERED` | Yes | Yes |
| Malformed token | `TOKEN_INVALID` | Yes | Yes |
| Token from another project | `SENDER_ID_MISMATCH` | No | Yes |
| Rate limited | `PROVIDER_THROTTLED` | No | Yes |
| Service down | `PROVIDER_UNAVAILABLE` | No | Yes |
| Network failure | `NETWORK_ERROR` | No | Yes |
| No answer in time | `FCM_TIMEOUT` | No | Yes |
| Bad credentials | `FCM_AUTH_ERROR` | No | Yes |
| Not configured | `FCM_NOT_CONFIGURED` | No | Yes |

## Duplicate prevention

| Layer | Mechanism | Prevents |
|---|---|---|
| API | `Idempotency-Key` with a unique index | A retried request creating a second message |
| Audience | Unique (`messageId`, `registrationId`) | One device reached twice through two tags |
| Worker | Compare-and-swap on job status | Two workers running one job |
| Dispatcher | Only `PENDING` targets are selected | Re-sending after a retry |
| FCM | `collapseKey` set to the msgid | A retried send stacking up |
| Phone | Recent msgids are remembered | FCM delivering a message twice |
| Phone | Notification tagged with the msgid | Two copies on screen |
| Events | Unique (`targetId`, `type`) | A stage being counted twice |

One gap remains on the server: if the process dies after Google accepts a message and before the result is saved, a retry sends it again. Sending is at-least-once, and the phone's deduplication makes that safe.

## Device authentication

An AppKey ships inside the app, so it is public. It only allows registration, within the environment's limits.

Registration returns a `deviceSecret`, stored as a keyed hash. Every later call proves the device's identity with it, so one device cannot report events or change the token of another. Re-registering an existing installation also needs the secret, which stops a takeover through a guessed installation ID.

## Scheduling

Every message, immediate or scheduled, has a `ScheduledJob` row committed with it, so a saved message cannot be lost. The API runs immediate jobs inline, and the worker takes anything left over.

Jobs move through `PENDING`, `PROCESSING`, then `COMPLETED` or `FAILED`, or are `CANCELLED`. A job stuck in `PROCESSING` after a crash returns to the queue, up to `WORKER_MAX_ATTEMPTS`.

Push tokens are read at send time, so a token refreshed after scheduling is still used.

## Scaling limits

This is a single-node deployment, and these would change at real scale:

- Rate limits are held in process memory, and would move to Redis.
- Analytics aggregate in the application, and would move to rollup tables.
- Targets are sent in batches of 25, and would move to a queue.
- The worker polls MySQL, and would use a broker.
