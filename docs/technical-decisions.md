# Technical decisions

Each entry gives the choice, why it was made, and what it costs.

## Delivery

### TD-1. FCM acceptance is "sent", never "delivered"

**Decision.** A real channel returns `ACCEPTED`. Only a report from the phone creates `DELIVERED`.

**Why.** FCM's response means Google queued the message. It offers no delivery receipt to the sender, and marking it delivered would be false.

**Cost.** Delivery rates depend on the app reporting. A phone that receives a message and loses its network shows as undelivered until the report gets through.

### TD-2. Data-only FCM messages by default

**Decision.** The backend sends a `data` payload with high priority and no `notification` block. The app draws the notification.

**Why.** With a `notification` block, Android draws background messages itself and `onMessageReceived` never runs. The app could not report receipt, and could not draw the Big Picture or Inbox styles.

**Cost.** The app must run to show a message, so aggressive phone manufacturers can block it. `FCM_PAYLOAD_MODE=hybrid` is the escape hatch: more robust delivery, but only the click is reported in the background.

### TD-3. A simulator cannot report delivery to a real phone

**Decision.** For a real device, any step other than FCM is `SKIPPED`. The reason is `MTPUSH_OFFLINE` when `mtpush` comes first in a two-channel strategy, and `SIMULATOR_CANNOT_REACH_REAL_DEVICE` otherwise. The target fails if nothing else can reach it.

**Why.** A simulated "delivered" for a phone that received nothing is exactly the false claim the brief forbids. It also matches the specification: `mtpush_fcm` uses FCM when Engagelab is not online, and a phone has no Engagelab connection here.

**Cost.** `mtpush`, `pns_mtpush` and `mtpush_pns` fail on a real phone until real adapters exist. The console warns before sending. All five strategies still work on simulated records.

### TD-4. No retry on the same channel

**Decision.** Each channel is tried once per target. Failure moves to the next step.

**Why.** Retrying a timed-out send risks a duplicate, and the Firebase SDK already retries some transient errors. This keeps fallback bounded.

**Cost.** A brief FCM outage fails a message where a retry might have worked.

### TD-5. One FCM call per device, not `sendEach`

**Decision.** Each target gets its own `send`, 25 at a time.

**Why.** Each target needs its own attempt row, provider response and failure reason. Per-target calls keep that simple.

**Cost.** More HTTP calls than a batch. At scale this would use `sendEach`, mapping each response to its target.

### TD-6. Sending is at-least-once, and the phone deduplicates

**Decision.** A crash after Google accepts and before the result is saved may cause a second send. The phone ignores a msgid it has seen.

**Why.** At-most-once risks losing a notification, which is worse than a duplicate that gets filtered. FCM can also deliver twice on its own, so the phone needs this logic anyway.

**Cost.** The app remembers the last 200 msgids. A duplicate older than that would show twice.

## Device identity

### TD-7. Device secrets on top of the AppKey

**Decision.** Registering returns a per-device secret, stored as a keyed hash, and it is required for every later call.

**Why.** An AppKey ships inside the APK, so it is public. Using it alone would let anyone report fake clicks or change another device's token.

**Cost.** A lost secret means the app starts again as a new device. It is stored next to the installation ID, so the two are lost together.

### TD-8. Real devices are identified by `installationId`

**Decision.** A device with an installation ID is real. Only the client API sets it.

**Why.** It survives token changes. `pushToken` could not be the marker, because a token can be released to another row.

**Cost.** None of note.

### TD-9. Keep a dead token, but mark it invalid

**Decision.** On `UNREGISTERED`, the token stays and `pushTokenStatus` becomes `INVALID`. Later messages count the device as an invalid target and do not call FCM.

**Why.** It avoids wasted calls and keeps the failure visible. The update is keyed on the token used, so a refresh that raced the send is not undone.

**Cost.** The device stays in the list until it is cleaned up.

## Events and analytics

### TD-10. Later stages imply earlier ones

**Decision.** A click without a delivered event creates the missing stages, marked `inferred`.

**Why.** Reports can arrive out of order or be lost, and a click does prove receipt. A funnel where clicked exceeds delivered would be nonsense. The flag keeps inferred rows distinguishable from direct reports.

**Cost.** The display rate cannot separate reported displays from inferred ones without inspecting events.

### TD-11. A phone's report outranks a provider error

**Decision.** If a target failed, and the phone later reports receipt, the target becomes `DELIVERED`.

**Why.** A timed-out send may still have arrived, and the phone is the better witness.

**Cost.** The message-level status can read `FAILED` while its funnel shows a delivery.

### TD-12. Real and simulated figures are separated, not blended

**Decision.** Every target has a `deliveryMode`, and analytics can filter on it. Simulated data triggers a notice.

**Why.** Mixed figures would otherwise read as real performance.

**Cost.** One more filter in the UI and API.

### TD-13. Cohort-based analytics

**Decision.** All stages count on the day the message was dispatched, in the application's timezone.

**Why.** Rates in a bucket stay at or below 100%.

**Cost.** Yesterday's figures change as late reports arrive.

### TD-21. Push user statistics without daily history

**Decision.** New users come from registration time, and active users from each device's last activity. Online is the current count.

**Why.** True daily active and online history needs a snapshot table and a scheduled job, which is more than a small assessment needs.

**Cost.** A device active on several days counts only on the latest, so past active counts read lower than the truth.

### TD-22. Loss has four stages, and display is extra detail

**Decision.** Loss follows the specification: planned, valid, sent, delivered, clicked. `notDisplayed` is reported as detail inside the last stage.

**Why.** The specification's funnel omits display, but the gap between delivered and displayed is what reveals disabled notifications, so it is too useful to drop.

**Cost.** The funnel has six bars and the loss table four stages, which needs a sentence of explanation.

### TD-14. Analytics are computed from rows on request

**Decision.** There are no counters or rollups.

**Why.** Figures cannot drift from the evidence, and buckets can follow DST-aware timezones.

**Cost.** It would not scale. Production would use rollup tables.

## Platform

### TD-15. Android versions pinned to the installed IDE

**Decision.** AGP 8.0.2, Gradle 8.0.2, Kotlin 1.8.22, SDK 33 and Firebase BOM 32.2.3.

**Why.** The development machine has Android Studio Flamingo, which supports AGP up to 8.0, and SDK 33. Newer versions would not open in it. Target SDK 33 still covers the Android 13 notification permission.

**Cost.** The project is behind current versions. A Play Store release would need a newer target SDK.

### TD-16. The Firebase plugin applies only when configured

**Decision.** The build applies `google-services` only if `google-services.json` exists.

**Why.** A clean checkout can build, and the app explains what is missing.

**Cost.** A forgotten file produces an app that cannot register, not a build error. The app says so on screen.

### TD-17. `namespace` differs from `applicationId`

**Decision.** The Kotlin package stays `com.engagelab.apppush.demo`. The installed ID is `com.caleb.engagelab`, which is the package registered in Firebase.

**Why.** Only `applicationId` must match Firebase, and Android keeps the two independent.

**Cost.** The names differ, which can surprise a reader.

### TD-18. No Web Push channel

**Decision.** Web Push, listed as "if feasible", is not implemented.

**Why.** It needs a new platform through the schema, strategies, a service worker and analytics, and the assessment is about a phone. That effort went to reliable phone delivery.

**Cost.** One less real channel.

### TD-19. Modular monolith, without a broker

**Decision.** One API, one worker and MySQL.

**Why.** It runs on a Windows laptop with no Docker or Redis, and `FOR UPDATE` plus compare-and-swap give the guarantees needed here.

**Cost.** Horizontal scaling needs shared rate limits and a queue.

### TD-20. Master Secrets use HMAC, not bcrypt

**Decision.** HMAC-SHA-256 with a server-side pepper, for Master Secrets and device secrets.

**Why.** They hold 256 bits of randomness, so they cannot be brute-forced, and they are checked on every call. A slow hash would add latency and no security. Admin passwords are low-entropy, so they use bcrypt.

**Cost.** Changing the pepper invalidates all secrets.

### TD-21. A small translation module, with English text as the key

**Decision.** The console uses a small module, `frontend/src/lib/i18n.ts`, and a dictionary in `zh.ts` keyed by the English text. The Android app uses standard string resources and AppCompat's per-app language.

**Why.** There are two languages and one dictionary, so a library would add little. Pages stay readable, because the English is still in the template. The key type comes from the dictionary, so text with no Chinese entry fails the typecheck.

**Cost.** Changing English text means changing its key. Swagger stays in English, and validation messages generated by the API's schema library stay in English when they have no entry.

### TD-22. The Android client is an SDK, and the demo app is its first user

**Decision.** Registration, receiving, display and reporting live in the `apppush-sdk` library, behind one `AppPush` object. The demo app uses only that public API. The SDK ships as a Maven repository.

**Why.** Other developers can add push to their own apps. A plain `.aar` lists no dependencies, so each developer would have to find Firebase and WorkManager by hand. A repository brings them along.

**Cost.** The SDK reports a tap only if the app passes its intents to `handleIntent`. A hidden trampoline activity would avoid that, but it adds another way for a tap to fail. There is no hosted repository, so developers copy the folder into their project.
