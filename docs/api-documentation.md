# API documentation

The full, executable reference is Swagger UI at <http://localhost:4000/api/docs>. The raw OpenAPI document is at `/api/docs.json`. This page is an overview with worked examples.

## Authentication

| Caller | Method | Paths |
|---|---|---|
| Console | `Authorization: Bearer <JWT>` from `POST /api/v1/auth/login` | `/api/v1/apps`, `/api/v1/environments/{envId}/...`, `/api/v1/audit-logs` |
| Server integration | `Authorization: Basic base64(AppKey:MasterSecret)` | `/api/v1/open/...` |
| Android app, registering | `X-App-Key` | `/api/v1/client/ping`, `/api/v1/client/devices` |
| Android app, afterwards | `X-Registration-Id` and `X-Device-Secret` | `/api/v1/client/...` |

Each path under `/environments/{envId}` also exists under `/open`, where the credentials select the environment. The examples below use `/open`.

## Conventions

Errors have one shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": [], "requestId": "..." } }
```

Lists return `{ "data": [...], "meta": { "page", "pageSize", "total", "totalPages" } }`, and accept `page` and `pageSize` (at most 100).

| Status | Meaning |
|---|---|
| 400 | Validation failed |
| 401 | Missing or invalid credentials |
| 403 | Application inactive or expired, or IP not allowed |
| 404 | Not found |
| 409 | Conflict: duplicate, limit reached or invalid state |
| 429 | Rate limited. See `Retry-After` |

## Push API

### Send a notification to a real phone

```http
POST /api/v1/open/messages
Idempotency-Key: 7d0f7a2e-order-1234
```

```json
{
  "type": "NOTIFICATION",
  "title": "Your order has shipped",
  "body": "Track it in the app.",
  "platforms": ["ANDROID"],
  "audience": { "type": "REGISTRATION_IDS", "values": ["rid_0123456789abcdef01234567"] },
  "strategy": "fcm_mtpush"
}
```

Response, immediately after sending:

```json
{
  "data": {
    "msgid": "1793400000000123456",
    "status": "COMPLETED",
    "isSimulated": false,
    "delivery": { "real": 1, "simulated": 0 },
    "funnel": { "planned": 1, "valid": 1, "sent": 1, "delivered": 0, "displayed": 0, "clicked": 0 },
    "idempotentReplay": false
  }
}
```

`COMPLETED` means the send finished, not that the phone has it. `delivered` rises when the phone reports.

| Field | Values |
|---|---|
| `type` | `NOTIFICATION`, `CUSTOM`, `IN_APP` |
| `style` | `DEFAULT`, `THUMBNAIL`, `BIG_PICTURE`, `TEXT`, `INBOX`, `CUSTOM`, with `styleConfig` |
| `customPayload` | Required for `CUSTOM`, at most 4 KB |
| `audience.type` | `ALL`, `REGISTRATION_IDS`, `TAGS`, `ALIASES` |
| `strategy`, or `distribution_new` | `mtpush`, `fcm_mtpush`, `pns_mtpush`, `mtpush_fcm`, `mtpush_pns` |
| `channel` | Optional. Tries only this channel |
| `scheduledAt` | Optional. Without an offset, read in the application's timezone |

FCM carries at most 4 KB of data per message. A larger message fails with `PAYLOAD_TOO_LARGE`, before any call to Google.

### Inspect a message

| Request | Returns |
|---|---|
| `GET /messages` | History, with funnels. Filter by `status`, `type`, `strategy`, `search` |
| `GET /messages/{msgid}` | One message |
| `GET /messages/{msgid}/targets` | Recipients, with attempts and events |
| `GET /messages/{msgid}/attempts` | Attempts, with provider message IDs and responses |

`POST /messages/{msgid}/events` records simulated events on simulated targets. It never changes a real device's record.

## Report API

| Request | Returns |
|---|---|
| `GET /analytics?from=2026-10-01&to=2026-10-31&granularity=day` | Totals, rates, loss, breakdowns and trend |
| `GET /analytics?deliveryMode=REAL` | The same, for real devices only |
| `GET /analytics?platform=ANDROID&channel=fcm` | The same, for one platform or channel |
| `GET /analytics/overview` | Today and yesterday by hour, yesterday's funnel, and the notification permission rate |
| `GET /analytics/users?granularity=month` | New, online and active users, by platform, vendor and app version |
| `GET /analytics/messages/{msgid}?channel=fcm` | Funnel, rates, loss and reasons for one message. `platform` and `channel` are optional |

Rates are `null` when nothing could have happened, because no data is not 0%.

| Metric | Formula |
|---|---|
| Delivery rate | delivered / sent |
| Display rate | displayed / delivered |
| Click-through rate | clicked / displayed |

`loss` has the four stages `invalid`, `notSent`, `notDelivered` and `notClicked`, which sum to planned minus clicked. `notDisplayed` is extra detail inside `notClicked`.

`failureReasons` is two-level: `stage` (`INVALID_TARGET`, `SEND_FAILED`, `DISPLAY_FAILED`), then `reason`.

In `/analytics/users`, a device counts as active once, on the last day it was seen, and `online` is the current count.

## Schedule API

Create a schedule with `POST /messages` and `scheduledAt`.

| Request | Effect |
|---|---|
| `GET /schedules?status=PENDING` | List jobs |
| `POST /schedules/{jobId}/cancel` | Cancel a pending job. Returns 409 once it has started |

## Device, tag and alias API

| Request | Effect |
|---|---|
| `GET /devices` | List. Filter by `platform`, `status`, `online`, `tag`, `alias`, `appVersion`, `search` |
| `POST /devices` | Create a **simulated** record. Real phones use the client API |
| `GET`, `PATCH`, `DELETE /devices/{registrationId}` | Read, update, delete |
| `POST /devices/cleanup` | Delete devices inactive for N days. `dryRun` previews |
| `PUT /devices/{registrationId}/tags` | Add or remove tags |
| `PUT /devices/{registrationId}/alias` | Set or clear the alias |
| `GET`, `POST /tags`, `DELETE /tags/{name}` | Manage tags |
| `POST /tags/{name}/devices` | Add or remove devices on a tag |
| `GET /aliases`, `DELETE /aliases/{name}` | Manage aliases |

Testing environments allow 10 requests per second, 1,000 devices, 50 tags, 10 devices per tag and 10 tags per device.

## Client API

Called by the Android app.

### Register

```http
POST /api/v1/client/devices
X-App-Key: <AppKey>
```

```json
{
  "installationId": "3f2b8c1e-5d4a-4b7e-9f10-2a6c8e1d7b34",
  "pushToken": "<FCM registration token>",
  "platform": "ANDROID",
  "vendor": "Google",
  "model": "Pixel 8",
  "osVersion": "14",
  "appVersion": "1.0.0",
  "notificationsEnabled": true
}
```

Returns 201 with `registrationId` and `deviceSecret`, which is shown only once. A later call with the same `installationId` must include `X-Device-Secret`. It then returns 200 and updates the record.

### Other calls

| Request | Purpose |
|---|---|
| `GET /api/v1/client/ping` | Connectivity test. Reports the application, environment and whether FCM is configured |
| `PUT /api/v1/client/devices/me/token` | Replace the FCM token. Also revives a token marked invalid |
| `POST /api/v1/client/events` | Report an event |

### Report an event

```json
{ "msgid": "1793400000000123456", "type": "DELIVERED", "occurredAt": "2026-10-31T02:00:00.000Z" }
```

`type` is `DELIVERED`, `DISPLAYED`, `CLICKED` or `DISPLAY_FAILED`, which takes a `reason`.

Repeats are safe, and return `"duplicate": true`. A device can only report messages sent to it. Any other request returns 404. An `occurredAt` that is implausible for the message is replaced with the server's time.
