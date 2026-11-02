# Interview guide

A script for demonstrating the project, and answers to likely questions.

## Before the interview

Do a full rehearsal on the same phone and network. Then, on the day:

1. Close everything you do not need, and pause OneDrive, which used 3.3 GB on this PC.
2. Start the system: `npm run db:local:start`, then `npm run dev`. If the API returns 503, MySQL has stopped, so run the first command again.
3. Connect the device: `adb connect <ip>:<port>`, using the port on the **Wireless debugging** screen, because it changes. Then run `adb reverse tcp:4000 tcp:4000`.
4. Open the app and press **Test backend connection**.
5. Send one test message, to wake everything up.
6. Check that the phone has mobile data or Wi-Fi. FCM needs the internet, even when the backend uses USB.

Have a screen recording of a successful run ready, in case the venue's network blocks FCM.

## Demonstration, about 8 minutes

**1. The point (30 seconds).** "The requirement was that the notification really arrives. So this sends through Firebase Cloud Messaging to a real phone, and the phone reports what happened. Everything else in the system is built around being honest about the difference."

**2. Create an application (1 minute).** Open **Applications** and create one. Point out that the Master Secret appears once, because only a hash is stored. Copy the AppKey.

**3. Register the phone (1 minute).** Enter the AppKey in the app and press **Save and register**. Open **Devices**, and show the phone listed as **Real phone**, beside simulated records.

**4. Send the notification (2 minutes).** Open **New push**, tick the phone, choose `fcm_mtpush`, and send. Hold up the phone. **This is the moment that matters.**

**5. Show the evidence (1 minute).** Open the message. Walk through the stages: "Accepted by provider" is Google's response, with its message ID. "Received" and "Displayed" were reported by the phone. Say clearly that Google only tells us it accepted the message.

**6. Background and click (1 minute).** Press Home on the phone, and send again. It still arrives. Tap it, and watch **Clicked** appear on the dashboard by itself.

**7. Honesty about simulation (1 minute).** Choose `mtpush` on the form, and show the warning. Send it, and show the target fail with `SIMULATOR_CANNOT_REACH_REAL_DEVICE`. "It would have been easy to report success here. It would also have been false."

**8. Depth, if time allows.** Choose from: fallback on a simulated device, a scheduled send, the analytics page filtered to **Real devices only**, or the testing limits.

## Key questions

**How do you know the message was delivered?**
FCM cannot tell the sender. Its response only means Google accepted it. So `sent` comes from Google, and `delivered` comes only from the app, when `onMessageReceived` runs and it calls our API.

**Why data-only messages instead of notification messages?**
With a `notification` block, Android draws background messages itself and never calls the app, so I could not report receipt or draw custom styles. Data-only means the app always runs. The cost is that some manufacturers block background apps, so `FCM_PAYLOAD_MODE=hybrid` is a fallback.

**What happens when a token expires?**
FCM returns `UNREGISTERED`. I mark the token invalid, and later messages count that device as an invalid target without calling Google. When the app starts, or `onNewToken` fires, it sends a new token and the device recovers.

**How do you prevent duplicates?**
In layers. An idempotency key stops a repeated API call. A unique key stops one device being targeted twice. Compare-and-swap stops two workers taking one job. Only pending targets are sent, so a retry skips finished ones. The collapse key handles retries inside FCM, and the phone ignores message IDs it has seen. Events have a unique key, so a stage counts once.

**Is it exactly-once?**
No. If the process dies after Google accepts and before I save the result, a retry sends again. It is at-least-once sending, with an idempotent receiver. That is the right trade: a filtered duplicate is better than a lost notification.

**What if the phone reports before the server saves Google's response?**
That race is real, because FCM can be very fast. The dispatcher only moves a target out of `PENDING`, so it cannot overwrite `DELIVERED`. There is a test that reports from inside the mocked send.

**Did real-device testing find anything automated tests missed?**
Yes. The phone sends two reports about 10 ms apart, and they deadlocked in MySQL. A 15-second gap in one report's arrival time pointed to the app's retry delay, and the API log confirmed it. I reproduced it with a failing test, then fixed it with a row lock. The report time dropped from 15.4 seconds to 0.2.

**Why does a simulated channel fail on a real phone?**
A simulator cannot reach a phone, so reporting delivery would be false. The spec says `mtpush_fcm` uses FCM when Engagelab is not online, and a phone has no Engagelab connection here, so it reaches the phone through real FCM. Forced `mtpush` has nothing else to use, so it reports failure. All five strategies work on simulated devices.

**How closely does this follow the product specification?**
Section 0 of [requirements.md](requirements.md) has the translated specification and a line-by-line alignment table. It reproduces the product's behaviour for one small application, not its scale. Where I simplified, such as active user history, the table says so.

**How are the device APIs secured, given that the AppKey is public?**
An AppKey ships in the APK, so anyone can extract it. It only allows registration, within limits. Registration returns a per-device secret, stored as a keyed hash, and every later call needs it. A device can only report on messages sent to it.

**Why HMAC for secrets but bcrypt for passwords?**
Secrets are 256 random bits, so they cannot be brute-forced, and they are checked on every request. Passwords are low-entropy, so they need a slow hash.

**How are Firebase credentials protected?**
The key is a Git-ignored file read only by the backend. It never reaches the frontend. Errors name the problem without printing the contents.

**How do you stop tests sending real notifications?**
A hard guard: no real sender can exist when `NODE_ENV=test`. The real-device test is a separate script that requires `--confirm`.

**How would this scale?**
Move rate limits to Redis, sending to a queue with workers per provider, use FCM's batch API, and pre-aggregate analytics into rollup tables. Today's design is deliberately a single node, because it had to run on a laptop.

**What would you do next?**
Implement `mtpush` as a real persistent connection, add a real manufacturer adapter, add HTTPS, and encrypt the device secret on the phone.

## Honest limits to state up front

- Only FCM is real. Other channels are simulators.
- `mtpush`, `pns_mtpush` and `mtpush_pns` cannot reach a real phone.
- `DISPLAYED` means Android accepted the notification, not that a person saw it.
- The Android app uses plain HTTP, for local use only.
- Phones without Google Play services cannot be reached.
- Web Push was optional, and is not implemented.
