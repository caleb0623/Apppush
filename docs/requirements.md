# EngageLab AppPush (Local Assessment Edition) — Requirements

| | |
|---|---|
| **Document status** | Baseline for implementation |
| **Source** | The EngageLab AppPush product specification, translated in section 0, and the assessment brief, sections 2 to 11 (referred to here as `SRC-x.y`) |
| **Related** | [architecture.md](architecture.md), [testing.md](testing.md), [technical-decisions.md](technical-decisions.md) |

Entries marked **[DECISION]** are not stated in the source brief. They are gap-filling choices made during analysis, and section 7 lists them with the reasoning.

---

## 0. Product specification and alignment

### Scope of this project

EngageLab AppPush handles over ten billion messages a day. This project is a small assessment, so it reproduces the product's **behaviour and rules**, not its scale. It should act the way the real product does for one small application: a real notification reaches a real device, and the operator can see what happened. Throughput, multi-region operation and vendor contracts are out of scope.

### Translation of the specification

**Overview.** Engagelab AppPush is a professional app push service handling over ten billion messages a day. It supports Android, iOS, HarmonyOS and other platforms, with an easily integrated SDK, fast and stable push channels, powerful and flexible open APIs, and web operations for creating notifications, analysing results and troubleshooting.

**Channels.** FCM, Huawei, Honor, Xiaomi, Meizu, OPPO, Vivo, APNs and HarmonyOS.

**Message types.** Notification messages and custom messages.

**Notification styles.** Default, thumbnail, big picture, text, inbox and custom.

**Delivery strategies.** The API lets developers set a strategy per vendor channel, using the notification field `distribution_new`:

| Value | Meaning |
|---|---|
| `mtpush` | Force delivery through the Engagelab channel |
| `fcm_mtpush` | Force FCM first, and use Engagelab if that is ineffective |
| `pns_mtpush` | Force Xiaomi, Huawei, Meizu, OPPO or Vivo first, and use Engagelab if that is ineffective |
| `mtpush_fcm` | For users with FCM and a Chinese vendor channel: prefer Engagelab, and use FCM as an auxiliary channel when Engagelab is not online |
| `mtpush_pns` | For the same users: prefer Engagelab, and use the vendor channel as an auxiliary channel when Engagelab is not online |

**App-level statistics.**

- *Overview:* real-time hourly message data, comparing today with yesterday. Yesterday's conversion funnel, delivery rate and click rate. The latest device notification permission rate. Historical conversion trends by platform and channel. Historical loss by platform, channel and stage.
- *Push statistics:* history by platform, channel, message type and app version. Delivery rate, click rate, valid targets, sent, delivered, displayed and clicked counts, by day or month, over a custom range.
- *Push user statistics:* history by platform, channel and app version. New, online and active users, by day or month, over a custom range.

**MessageID-level statistics.**

- *Push statistics:* conversion reports for notification, custom and in-app reminder messages. Delivery, display and click rates per msgid. Valid targets, sent, displayed and clicked counts per msgid, by platform and channel.
- *Loss statistics:* loss per msgid by platform and channel, with two levels of loss reason. Four loss stages across {planned}-{valid}-{sent}-{delivered}-{clicked}.

**REST APIs.**

| API | Purpose |
|---|---|
| Push API | All push functions, so developers can build campaigns in their own back office. More powerful and flexible than the portal |
| Report API | Query message statistics and user data |
| Schedule API | Scheduled delivery for all messages |
| Tag Alias API (Device API) | Query, set, update and delete a device's tags and alias from the server |

**Push testing mode.** An independent environment, separate from production, for validating push configuration and results before launch.

- *Environments and AppKeys:* production and testing use different AppKeys and Master Secrets. Switching to testing mode automatically generates a testing AppKey and copies the production AppKey's configuration. The backend binds the two, to determine VIP status and synchronise information. The portal opens on production, and developers switch manually. A testing AppKey can reset its Master Secret independently.
- *Synchronised:* the testing app copies the production app's name and icon when created. Name, icon, VIP status and service period then stay in real-time sync.
- *Independent:* callback, security and integration settings.
- *Limits:* QPS 10. At most 1,000 SDK registered users, after which new registrations are refused, so developers should record registration IDs and clean up regularly, using the delete-user API. At most 50 tags, 10 devices per tag and 10 tags per device.
- *Dependency:* a testing AppKey is usable only while its production AppKey is valid.
- *Service:* a testing AppKey cannot buy VIP services. Its entitlements follow the production AppKey.

### Alignment

**Done** matches the specification. **Simplified** keeps the behaviour in a smaller form. **Simulated** is labelled as simulated everywhere.

| Specification | Status | Implementation |
|---|---|---|
| FCM channel | Done | Real delivery, verified on a physical device |
| Eight other channels | Simulated | Separate adapters. They need vendor accounts |
| Engagelab channel | Simulated | A real phone counts as offline to it |
| Notification, custom and in-app messages | Done | Android handles all three |
| Six notification styles | Simplified | Five are drawn. `CUSTOM` shows plain text, because a layout ID cannot be delivered to a demo app |
| Five `distribution_new` strategies | Done | Field accepted as `distribution_new` or `strategy`. `mtpush_fcm` and `mtpush_pns` move on when Engagelab is not online |
| Today against yesterday, by hour | Done | Dashboard and `/analytics/overview` |
| Yesterday's funnel and rates | Done | Dashboard and `/analytics/overview` |
| Notification permission rate | Done | Reported by the app, and shown on the dashboard |
| Trends and loss by platform and channel | Done | Filters and breakdown tables on Message analytics |
| Push statistics by day and month | Done | Message analytics and `/analytics` |
| Push user statistics | Simplified | See A-17 |
| Per-msgid rates and counts | Done | Message details and `/analytics/messages/{msgid}` |
| Four loss stages, two-level reasons | Done | Displayed is kept as extra detail, not a fifth stage |
| Push, Report, Schedule and Device APIs | Done | Same capabilities. Paths are this project's own, not the vendor's |
| Separate testing AppKey and secret | Done | Reset independently |
| Testing copies production configuration | Done | Copied once, then independent |
| Real-time name, icon, VIP and service sync | Done | One shared record, so they cannot differ |
| Portal opens on production | Done | The environment choice is not remembered between visits |
| Testing limits | Done | Enforced on the server |
| Testing depends on production | Done | One shared status and service period |
| No VIP purchase for testing | Done | VIP is a stored flag on the shared record, and there is no purchase flow |
| Easily integrated SDK | Simplified | An Android SDK and a demo app built on it, for this project's own backend. It is not EngageLab's official SDK. See [android-sdk.md](android-sdk.md) |
| Ten billion messages a day | Out of scope | See "Scope of this project" |

---

## 1. Product overview

EngageLab AppPush is a push notification management platform for Android, iOS and HarmonyOS apps. It sends through several delivery channels: Google FCM, Apple APNs, HarmonyOS push, phone-manufacturer channels (Huawei, Honor, Xiaomi, Meizu, OPPO, Vivo) and EngageLab's own `mtpush` channel.

This project is a local implementation of the platform: application and credential management, device registry, message creation, delivery strategies with fallback, scheduling, analytics and an isolated testing environment.

The interviewer's key requirement is that the recipient must actually receive the notification (推送消息通知能收到). FCM is therefore a **real** provider, and an Android app receives notifications on a physical phone and reports what happened to them. Every other channel is a **deterministic simulator**, clearly labelled.

## 2. Business objectives

| ID | Objective |
|---|---|
| BO-1 | Demonstrate end-to-end understanding of a push platform's domain model and delivery lifecycle. |
| BO-2 | Show deterministic, explainable fallback delivery across multiple channels. |
| BO-3 | Produce analytics derived from recorded activity, with defined denominators and no double counting. |
| BO-4 | Provide an isolated testing environment with backend-enforced limits. |
| BO-5 | Be runnable locally on Windows with no paid services, Docker, Redis or message broker. |
| BO-6 | Deliver a real notification from the console to a physical Android phone, and show what actually happened to it. |

## 3. Scope

### In scope

Admin console (Vue 3), REST API with Swagger (Express), MySQL 8 persistence through Prisma, real FCM delivery (HTTP v1), a Kotlin Android client, channel simulators, background worker, event-based analytics, automated tests and documentation.

### Out of scope

| Item | Reason |
|---|---|
| Real delivery through APNs, manufacturer services or `mtpush` | Requires vendor accounts, certificates or SDKs. Each is a separate simulated adapter behind the same interface (FR-031). |
| An iOS or HarmonyOS client | The assessment requires an Android client. |
| Web Push | Optional in the brief. See TD-18 in [technical-decisions.md](technical-decisions.md). |
| Purchasing VIP services | Explicitly excluded by SRC-2.10. VIP is a stored flag. |
| Multi-tenant organisations | **[DECISION]** All admin users operate on all applications (A-07). |
| Horizontal scaling (shared rate limits, distributed workers) | Local assessment; see [technical-decisions.md](technical-decisions.md). |

## 4. Functional requirements

### Applications and credentials

| ID | Requirement | Source |
|---|---|---|
| FR-001 | Admins can create, list, view, update and deactivate applications. Deactivated applications can be reactivated. | SRC-2.5 |
| FR-002 | Each environment has a unique generated AppKey. | SRC-2.5 |
| FR-003 | Each environment has a cryptographically random Master Secret, stored only as a one-way hash. | SRC-2.5 |
| FR-004 | A Master Secret is returned in plaintext exactly once: in the response that created or rotated it. | SRC-2.5 |
| FR-005 | An authenticated caller can rotate a Master Secret; the previous secret stops working immediately. | SRC-2.5 |
| FR-006 | An application has a production environment and optionally one testing environment linked to it. | SRC-2.5, 2.10 |
| FR-007 | Name, icon, VIP status, service validity and timezone are shared between environments. | SRC-2.5, 2.10 |
| FR-008 | Callback, security and integration settings are configured per environment. | SRC-2.5 |
| FR-009 | Mutations and API-key access are rejected for inactive applications and those past their service validity date. | SRC-2.5 |
| FR-010 | Admin users authenticate by email and password and receive a JWT. `ADMIN` can write; `VIEWER` is read-only. | SRC-2.5 |
| FR-011 | API clients authenticate with HTTP Basic `AppKey:MasterSecret`, scoped to one environment. | SRC-2.5 |

### Devices, tags and aliases

| ID | Requirement | Source |
|---|---|---|
| FR-012 | Devices can be registered with a unique registration ID, platform, vendor, OS version and app version. | SRC-2.6 |
| FR-013 | Devices can be queried with filters and pagination, updated and deleted. | SRC-2.6 |
| FR-014 | Device online state and last-active time are tracked. | SRC-2.6 |
| FR-015 | Tags can be created, listed, deleted and assigned to or removed from devices. | SRC-2.6 |
| FR-016 | A device has at most one alias; an alias may map to several devices. Aliases can be listed and removed. | SRC-2.6 |
| FR-017 | Stale registrations can be cleaned up by inactivity age, with a dry-run preview. | SRC-2.6 |
| FR-018 | Testing environments: max 1,000 devices, 50 tags, 10 devices per tag, 10 tags per device, enforced in the backend, including under concurrent requests. | SRC-2.6, 2.10 |

### Messages and delivery

| ID | Requirement | Source |
|---|---|---|
| FR-019 | Supported message types: `NOTIFICATION`, `CUSTOM` (JSON payload), `IN_APP`. | SRC-2.3 |
| FR-020 | Notifications carry title, body, target platforms, audience, strategy and delivery time. | SRC-2.3 |
| FR-021 | Style identifiers `DEFAULT`, `THUMBNAIL`, `BIG_PICTURE`, `TEXT`, `INBOX`, `CUSTOM` are validated and stored with their configuration. The Android app draws them; `CUSTOM` falls back to plain text. | SRC-2.3 |
| FR-022 | Audience may be `all`, or specific registration IDs, tags or aliases. | SRC-2.6 |
| FR-023 | Each message has a unique `msgid`. | SRC-2.7 |
| FR-024 | Strategies `mtpush`, `fcm_mtpush`, `pns_mtpush`, `mtpush_fcm`, `mtpush_pns` are implemented exactly as specified. | SRC-2.4 |
| FR-025 | Ten channel identifiers are supported: `fcm`, `huawei`, `honor`, `xiaomi`, `meizu`, `oppo`, `vivo`, `apns`, `harmonyos`, `mtpush`. | SRC-2.2 |
| FR-026 | Every attempt records channel, outcome, timestamp and failure reason. | SRC-2.4 |
| FR-027 | Fallback is bounded: at most one attempt per channel and two channels per target per dispatch, with no retry of a failed channel. | SRC-2.4 |
| FR-028 | Targets that do not exist, are inactive or do not match the target platforms are recorded as invalid and never sent to. | SRC-2.7, 7 |
| FR-029 | A repeated request with the same `Idempotency-Key` does not create a second message or delivery. A reused key with a different body is rejected. | SRC-2.11 |
| FR-030 | Simulated results are clearly labelled as simulated in storage, API and UI. | SRC-2.2 |
| FR-031 | Channels are implemented behind a common interface so that real adapters can replace simulators. | SRC-2.2 |
| FR-032 | Simulator outcomes are configurable per environment and per channel, and deterministic. | SRC-2.4 |

### Scheduling

| ID | Requirement | Source |
|---|---|---|
| FR-033 | Messages can be sent immediately or scheduled for a future time. | SRC-2.9 |
| FR-034 | Jobs move through `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, `CANCELLED`. | SRC-2.9 |
| FR-035 | A separate worker process polls MySQL and dispatches due jobs. | SRC-2.9 |
| FR-036 | A job can only be claimed by one worker, and a retried job does not re-deliver to targets that were already processed. | SRC-2.9 |
| FR-037 | Jobs left in `PROCESSING` after a crash are recovered on restart, up to a maximum attempt count. | SRC-2.9 |
| FR-038 | Pending jobs can be cancelled. Jobs already processing or finished cannot. | SRC-2.9 |
| FR-039 | Local schedule times are interpreted in the application's timezone; times with an explicit offset are honoured. | SRC-2.9 |

### Analytics

| ID | Requirement | Source |
|---|---|---|
| FR-040 | The funnel planned → valid → sent → delivered → displayed → clicked is reported per environment and per `msgid`. | SRC-2.7 |
| FR-041 | Delivery, display and click-through rates and stage-by-stage loss counts are provided. | SRC-2.7 |
| FR-042 | Failure reasons are aggregated. | SRC-2.7 |
| FR-043 | Statistics are broken down by platform, channel, message type and app version. | SRC-2.7 |
| FR-044 | Daily and monthly trends are available over a configurable date range and shown as charts. | SRC-2.7 |
| FR-045 | Analytics are computed from stored targets, attempts and events, not manually edited counters. | SRC-2.7, 4 |
| FR-046 | A message-device pair counts at most once per stage, regardless of the number of attempts. | SRC-2.7 |
| FR-047 | Simulated delivered, display and click events are recorded explicitly and marked as simulated. | SRC-2.7 |

### Testing environment and platform

| ID | Requirement | Source |
|---|---|---|
| FR-048 | Requests against a testing environment are limited to 10 per second; excess requests receive HTTP 429. | SRC-2.10 |
| FR-049 | The REST API is documented with Swagger/OpenAPI and executable locally. | SRC-2.8 |
| FR-050 | Sensitive administrative actions are written to an audit log. | SRC-4 |
| FR-051 | The console provides the 13 pages listed in SRC-5, backed by real APIs, with loading, empty, success, validation and error states. | SRC-5 |

### Real push delivery

| ID | Requirement | Source |
|---|---|---|
| FR-052 | Messages to a device registered by the app are sent through FCM HTTP v1, with title, body and a custom data payload, to one or many devices. | Brief §1, §3 |
| FR-053 | FCM message IDs and provider responses are stored on the delivery attempt. | Brief §3 |
| FR-054 | The Android app requests notification permission, obtains a token and registers it with the backend. | Brief §1, §7 |
| FR-055 | A refreshed token replaces the stored one. An invalid or expired token is marked as such, and later messages skip it until it is refreshed. | Brief §1 |
| FR-056 | Notifications appear on the phone with the app in the foreground and in the background. | Brief §1 |
| FR-057 | The app reports receipt, display and clicks. Display failures are reported with a reason. | Brief §1 |
| FR-058 | Provider acceptance, device receipt, display and click are separate stages, and each records its source. Provider acceptance never counts as delivery. | Brief §1 |
| FR-059 | A simulator never reports delivery to a real device. Manual simulated events cannot be recorded against one. | Brief §4 |
| FR-060 | Provider errors, network errors and missing configuration are recorded as failure reasons, and fallback runs where possible. | Brief §1, §3 |
| FR-061 | Duplicate delivery is prevented by idempotency keys, target de-duplication and client-side message ID tracking. | Brief §1 |
| FR-062 | A sender can select one channel instead of the strategy's chain. | Brief §6 |
| FR-063 | Analytics can be limited to real devices or to simulated records. | Brief §4 |
| FR-064 | Automated tests cannot send a real notification. The real-device test requires an explicit flag. | Brief §9 |

### Added after checking the product specification

| ID | Requirement | Source |
|---|---|---|
| FR-065 | `mtpush_fcm` and `mtpush_pns` use their second channel when Engagelab is not online. | Section 0 |
| FR-066 | A new testing environment starts with a copy of production's configuration. | Section 0 |
| FR-067 | The portal opens on production, whichever environment was used last. | Section 0 |
| FR-068 | Loss has four stages: planned-valid, valid-sent, sent-delivered and delivered-clicked. | Section 0 |
| FR-069 | The overview compares today with yesterday by hour, and shows yesterday's funnel and the notification permission rate. | Section 0 |
| FR-070 | New, online and active users are reported by platform, vendor and app version, by day or month. | Section 0 |
| FR-071 | Trends, and per-msgid loss with two-level reasons, can be filtered by platform and channel. Failed sends count towards the channel that failed them. | Section 0 |
| FR-072 | The delivery strategy can be sent as `distribution_new`. | Section 0 |

## 5. Non-functional requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-001 | Portability | Runs on Windows with Node.js 22.12+ and MySQL 8, without Docker or Redis. |
| NFR-002 | Persistence | All business data lives in MySQL. Schema changes go through Prisma migrations. |
| NFR-003 | Security | Secrets come from environment variables; no plaintext secret appears in source, logs or stored data. Passwords use bcrypt. |
| NFR-004 | Security | Database access goes through Prisma, or parameterised queries where raw SQL is needed. |
| NFR-005 | Reliability | Multi-step changes use transactions; limits are enforced under a row lock so concurrent requests cannot exceed them. |
| NFR-006 | API consistency | Errors share one JSON shape with a code, message, details and request ID. Lists share one pagination shape. |
| NFR-007 | Observability | Structured JSON logging with request IDs; credentials and tokens are redacted. |
| NFR-008 | Testability | Channel outcomes, clock and rate limiter can be injected; tests do not depend on randomness or wall-clock timing. |
| NFR-009 | Test isolation | Tests run only against a database whose name ends in `_test`, and refuse to start otherwise. |
| NFR-010 | Maintainability | Modular monolith with TypeScript strict mode, linting and type checks on both sides. |
| NFR-011 | Usability | Responsive admin interface with consistent components. |
| NFR-012 | Security | Firebase credentials come from a Git-ignored file or an environment variable, and never reach the frontend. FCM tokens are never returned by the API. |
| NFR-013 | Security | A device can act only for itself, proven by a per-device secret stored as a keyed hash. |
| NFR-014 | Compatibility | The Android project opens in Android Studio Flamingo, and supports Android 7.0 and newer. |

## 6. Business rules

| ID | Rule |
|---|---|
| BR-01 | Deliverability per target is decided by the first channel in its chain to accept. After a channel accepts, no fallback runs, because a second send could produce a duplicate on the device. |
| BR-02 | Channel chains depend on the device: `pns` maps to the device's manufacturer channel on Android, and both `fcm` and `pns` map to APNs on iOS and HarmonyOS push on HarmonyOS. |
| BR-03 | A channel that does not apply or is disabled is recorded as `SKIPPED` and consumes no provider call. |
| BR-04 | Delivered requires sent. Displayed and clicked require delivered. A click implies a display, which is recorded automatically if missing. |
| BR-05 | Rates with a zero denominator are reported as `null`, not 0%. |
| BR-06 | Limits apply only to testing environments. Production has no device or tag limit in this implementation. |
| BR-07 | Messages always record their audience. Target rows are resolved at dispatch time, so scheduled messages reach devices registered after scheduling. |
| BR-08 | Deleting a device keeps its historical targets and analytics, using the snapshots stored on the target row. |
| BR-09 | A channel with no real adapter is `SKIPPED` for a real device. Only strategies containing FCM can reach one. |
| BR-10 | For a real device, only the device can create delivered, displayed and clicked events. A later stage implies the earlier ones, which are recorded as inferred. |

### Rate definitions

| Metric | Formula |
|---|---|
| Delivery rate | delivered / sent |
| Display rate | displayed / delivered |
| Click-through rate | clicked / displayed |
| Invalid loss | planned − valid |
| Send loss | valid − sent |
| Delivery loss | sent − delivered |
| Click loss | delivered − clicked |
| Of which never displayed (detail, not a fifth stage) | delivered − displayed |

## 7. Assumptions and ambiguities in the source

| ID | Ambiguity in the brief | Decision | Why |
|---|---|---|---|
| A-01 | Honor is a supported channel (SRC-2.2), but the manufacturer list in SRC-2.4 omits it. | Honor is treated as a manufacturer channel for `pns` strategies. The list is one constant. | Honor devices would otherwise have no manufacturer path, though the channel exists. |
| A-02 | Strategies mention FCM and manufacturer channels, which do not exist on iOS or HarmonyOS. | Those slots map to the platform's system channel (BR-02). | Keeps every strategy meaningful on every supported platform. |
| A-03 | "Sent" and "delivered" are not differentiated at channel level. | A channel returns `DELIVERED`, `ACCEPTED` (sent, no receipt yet, e.g. device offline) or `FAILED`. FCM always returns `ACCEPTED`. | Needed for the two stages to differ, and FCM offers no delivery receipt. |
| A-04 | Whether an accepted but undelivered message should fall back. | It does not (BR-01). | Avoids duplicates. |
| A-05 | Retry behaviour is left open. | No same-channel retry. A worker job is retried up to 3 times only for infrastructure errors. | Bounded and easy to reason about. |
| A-06 | Denominators are not given. | As defined in section 6. | The source requires them to be defined. |
| A-07 | Ownership of applications by admin users is not specified. | Admins are platform operators with access to all applications. | Tenancy would add complexity without assessment value. |
| A-08 | "Synchronize" metadata could mean copying between records. | Shared fields live once on `Application`, and environments read them. | Two copies cannot disagree. Synchronisation code is unnecessary. |
| A-09 | Whether the 10 QPS limit covers console traffic. | It covers all requests scoped to a testing environment, from either auth method. | The limit is described as a property of the environment. |
| A-10 | Which date an event belongs to in trends. | Cohort basis: all stages are attributed to the message's dispatch date in the application's timezone. | Rates in a bucket stay at or below 100%. |
| A-11 | Master Secret hash algorithm is not specified. | HMAC-SHA-256 with a server-side pepper. | The secret is 256 bits of randomness, and verification runs per API call. See technical decisions. |
| A-12 | Callback settings are required, but outbound callbacks are not. | Callback settings are stored per environment. No outbound callback is sent, and the UI says so. | Keeps the local app free of outbound network calls. |
| A-13 | "Inactive device" is undefined. | A device is `ACTIVE` or `INACTIVE`, set via the API. `online` only affects whether delivery is confirmed. | Separates administrative state from connectivity. |
| A-14 | Audience entries that match nothing. | Unknown registration IDs, tags and aliases count towards planned, and are recorded as invalid with a reason. | Makes planned vs valid loss meaningful. |
| A-15 | Scheduling needs a timezone. | IANA timezone on `Application`, default `Asia/Shanghai`. | Required by SRC-2.9. |
| A-16 | "All five strategies work" cannot mean delivery to a phone through a simulator. | All five work on simulated records. On a real phone, only those containing FCM deliver, and the others are reported as failed. | Reporting a simulated delivery to a real phone would be false. |
| A-17 | Push user statistics need daily history, which no table keeps. | New users come from registration time. Active users come from each device's last activity, so a device counts once, on its latest active day. Online is the current count. "Channel" (渠道) is shown as device vendor. | A daily snapshot table is more than a small assessment needs. |
| A-18 | Does "not online" apply to a real phone? | Yes. This project has no Engagelab connection, so a real phone is offline to it, and `mtpush_fcm` reaches it through FCM. | This is what the strategy describes. |
| A-19 | The strategy table omits Honor, though it is a listed channel. | Honor is treated as a manufacturer channel. See A-01. | Honor devices would otherwise have no vendor path. |

## 8. Acceptance criteria

| Module | Acceptance criteria |
|---|---|
| Applications | Creating an app returns an AppKey and a one-time secret. No later API response contains the secret or hash. Deactivated apps reject writes with 403. |
| Credentials | After rotation, the old secret returns 401 and the new one succeeds. |
| Environments | Enabling testing creates a separate AppKey and secret. Renaming the app shows in both environments. Changing the testing callback leaves production unchanged. |
| Devices | CRUD works. A duplicate registration ID returns 409. Device 1,001 in a testing environment is rejected with 409. Concurrent registrations do not exceed the limit. |
| Tags and aliases | The 51st tag, 11th device on a tag and 11th tag on a device are rejected with 409 in testing and allowed in production. |
| Messages | Invalid payloads return 400 with field details. Valid sends return a `msgid`, and details show targets and attempts. |
| Delivery | All eight scenarios in SRC-7 pass with deterministic simulator settings. |
| Scheduling | A due job is processed once by concurrent workers. A stale job is recovered. A pending job can be cancelled, and a completed one cannot. |
| Analytics | Totals match a hand-calculated fixture. A fallback delivery counts as one delivered. |
| Testing limits | Request 11 inside one second receives 429 with `Retry-After`. Requests in the next window succeed. |
| Frontend | The 13 pages load real data and show loading, empty and error states. |
| Real delivery | The eight-step procedure in [testing.md](testing.md) passes on a physical phone with a real Firebase project. |

## 9. Traceability matrix

| Source | Requirements | Implementation | Tests |
|---|---|---|---|
| SRC-2.2 Channels | FR-025, 030, 031, 032 | `modules/delivery/channels.ts` | `unit/channels.test.ts` |
| SRC-2.3 Message types | FR-019 to 022 | `modules/messages/schemas.ts` | `unit/payload-validation.test.ts`, `integration/messages.test.ts` |
| SRC-2.4 Strategies | FR-024, 026, 027 | `modules/delivery/strategy.ts`, `dispatcher.ts` | `unit/strategy.test.ts`, `integration/delivery.test.ts` |
| SRC-2.5 Apps and credentials | FR-001 to 011 | `modules/apps`, `modules/environments`, `lib/credentials.ts`, `middleware/auth.ts` | `unit/credentials.test.ts`, `integration/apps.test.ts`, `integration/auth.test.ts`, `integration/environments.test.ts` |
| SRC-2.6 Devices | FR-012 to 018 | `modules/devices`, `modules/tags`, `modules/limits.ts` | `unit/limits.test.ts`, `integration/devices.test.ts`, `integration/testing-limits.test.ts` |
| SRC-2.7 Analytics | FR-040 to 047 | `modules/analytics`, `modules/messages/events.ts` | `unit/metrics.test.ts`, `integration/analytics.test.ts` |
| SRC-2.8 REST APIs | FR-049, NFR-006 | `routes.ts`, `docs/openapi.ts` | `integration/system.test.ts` |
| SRC-2.9 Scheduling | FR-033 to 039 | `modules/scheduler`, `worker.ts` | `unit/time.test.ts`, `integration/scheduler.test.ts` |
| SRC-2.10 Testing environment | FR-006, 007, 018, 048 | `modules/environments`, `lib/rate-limiter.ts` | `unit/rate-limiter.test.ts`, `integration/testing-limits.test.ts` |
| SRC-2.11 Security | FR-029, NFR-003 to 007 | `middleware/*`, `lib/logger.ts`, `lib/errors.ts` | `integration/auth.test.ts`, `integration/messages.test.ts` |
| SRC-5 Frontend pages | FR-051 | `frontend/src/views/*` | `frontend/tests/*`, `e2e/ui-flow.mjs` |
| SRC-7 E2E | All | Whole system | `integration/e2e-flow.test.ts`, `e2e/ui-flow.mjs` |
| Product specification | FR-065 to 072 | `modules/delivery/strategy.ts`, `modules/apps/service.ts`, `modules/analytics`, `frontend/src/stores/workspace.ts` | `integration/spec-alignment.test.ts`, `integration/delivery.test.ts` |
| Real delivery | FR-052 to 064 | `modules/delivery/fcm.ts`, `firebase.ts`, `dispatcher.ts`, `modules/client`, `modules/messages/events.ts`, `android/` | `unit/fcm.test.ts`, `integration/real-delivery.test.ts`, `integration/client-api.test.ts`, `scripts/real-fcm-test.mjs` |
