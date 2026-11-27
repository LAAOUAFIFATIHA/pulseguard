# PulseGuard

PulseGuard is a heart-monitoring and coaching web app for athletes and teams, built for the **#BuildHybridAI 2026** hackathon. A smart shirt (simulated for now) streams heart rate, ECG, skin temperature, humidity and movement. Threshold rules detect problems, **Firebase AI Logic hybrid inference** explains them (Gemini Nano on the device when possible, Gemini in the cloud otherwise), and teammates are warned when someone is in trouble.

> **PulseGuard is a demo, not a medical device.** It cannot diagnose. "No warning signs" only means that no rule was triggered. In an emergency, call emergency services.

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Firebase setup](#firebase-setup)
- [Deploy](#deploy)
- [How it works](#how-it-works)
- [Data model](#data-model)
- [Security and privacy](#security-and-privacy)
- [Tests](#tests)
- [Model for the ESP32](#model-for-the-esp32)
- [Project structure](#project-structure)
- [Known limits](#known-limits)

## Features

| Page | What it does |
| --- | --- |
| **Live monitor** | Press **Start**: live ECG, heart rate, temperature, humidity, movement, alerts, latest coaching tip and the **automatic AI safety check** |
| **AI coach** | Coaching tip, doctor report, spoken tips, streaming answers with a request log, private symptom notes, on-device model setup |
| **History** | Saved sessions with a replay player (heart-rate chart, alert zones, play/pause, 1× to 60×) |
| **Team** | Create, discover or join teams, live status of every member, group run with GPS, team alerts |
| **Friends** | Public card with @handle, search by name or handle, friend requests (accept, decline, cancel, remove), group-run invites |
| **Profile** | Public card editor, current status, last normal heart rate, personal thresholds, personal details |
| **Settings** | Data collection, raw-signal download, export, sign out, delete account |

Accounts use email/password (with email verification) or Google. Sign out is always available.

### Automatic safety check

After you press **Start** and heart-rate data arrives, the app checks the person without any further click:

1. The **rules** give a verdict immediately: *No warning signs*, *Take care* or *Stop and check*.
2. The **AI** is asked after 15 s of data, again when a new alert starts (at least 20 s apart), and every 3 minutes.
3. The AI may **raise** the verdict, never lower it. If it is unreachable, the rules still work.

The automatic check can be switched off, and monitoring can be set to start by itself (off by default), on the Live monitor page.

### Team alerts and group run

- When a member who shares their status has an **urgent alert** (fast or slow heart rate, irregular rhythm, dangerously high heart rate, high temperature), every other member sees a warning on **any page**, with a sound and, if allowed, a browser notification.
- With **Group run** switched on, a member's **GPS position** is shared while their monitor runs. Teammates see the distance, the accuracy and a link that opens OpenStreetMap.
- Group run is **off by default** and resets when the app reloads. Switching it off removes the position.
- Alerts reach teammates **only while their app is open**. There is no server push.

### Friends and group-run invites

- Create a **public card** on the Profile page: name, unique **@handle** (3 to 20 characters: `a-z 0-9 _`), emoji avatar, city, runner level and bio. It never contains email, health data, raw ECG or AI answers.
- **Search** by name or @handle prefix (10 results). **Settings → Who can find me** hides you from search (Everyone / Nobody). Friends and pending requests still see your card.
- **Requests**: send, accept, decline, cancel, remove. A red badge in the menu counts open requests and invites.
- **Group-run invites**: from the Team page, invite accepted friends. An invite lasts 2 hours. Accepting it joins that team, premium included, and leaves your current team (one team at a time). Location is still shared only with **Group run** on.

### Discover and premium teams

A team is private unless its owner publishes it (**Directory settings**). Published free teams can be joined in one step. Premium teams are run by an account with the coach role: athletes send a request and join after the coach approves. **No payment is processed** (the price is only text) and coach roles are not verified.

## Quick start

Requirements: Node.js 20+, Google Chrome (139+ on desktop for on-device AI), Java 11+ only for the emulator tests.

```bash
git clone https://github.com/LAAOUAFIFATIHA/pulseguard.git
cd pulseguard
npm install
cp .env.example .env
npm run dev
```

Fill `.env` with your Firebase web config, then open the address Vite prints.

To try everything without touching your real Firebase project (accounts and database run locally):

```bash
npm run emulators
```

```bash
VITE_USE_EMULATORS=1 npm run dev
```

## Firebase setup

1. Create a project (Spark plan is enough). Open **AI Services → AI Logic → Get started**, choose the **Gemini Developer API** and finish the workflow, which enforces App Check.
2. Register a web app and copy its config into `.env`.
3. **Authentication → Sign-in method:** enable **Email/Password** and **Google**, keep **Anonymous** off.
4. **Authentication → Settings:** turn on **Email enumeration protection** and list your domains under **Authorized domains**.
5. Create a **Firestore** database, then publish the rules: `firebase deploy --only firestore:rules`.
6. **App Check, local development:** run `npm run dev`, copy the debug token from the browser console, and add it under **App Check → Apps → Manage debug tokens**. Never commit it.

## Deploy

The hosted site uses **Google Cloud Fraud Defense** (reCAPTCHA Enterprise) for App Check:

1. Create a **website** key without the checkbox challenge for your hosting domains (never `localhost`).
2. Put the site key in `.env` as `VITE_RECAPTCHA_SITE_KEY` and register it under **App Check → Apps → Fraud Defense**.
3. `firebase login`, then `npm run deploy` (tests, build, upload to Hosting). Publish the rules separately (step 5 above).

## How it works

### Signals

The shirt is simulated: [`src/ecg.js`](src/ecg.js) builds a synthetic ECG (P, QRS, T) and [`src/sensors.js`](src/sensors.js) the accelerometer, skin temperature and humidity. Heart rate is **measured from the signal** by an R-peak detector, and movement from the accelerometer, so a real sensor can replace the simulator.

Scenarios: resting, jogging, fast at rest, slow, irregular, overheating while running, electrode off.

### Alert rules

A condition must last 8 seconds ([`src/anomaly.js`](src/anomaly.js), [`src/rules.js`](src/rules.js)):

| Alert | Default rule | Team warned |
| --- | --- | --- |
| Fast heart rate at rest | above 120 bpm at rest | yes |
| Slow heart rate | below 50 bpm | yes |
| Irregular rhythm | R-R variation above 15 % | yes |
| Heart rate dangerously high | above 185 bpm while exercising | yes |
| Body temperature too high | skin 37.5 °C or more | yes |
| Above exercise zone | above 145 bpm while exercising | no |
| Signal lost | no beat for 3 s | no |

Age and resting heart rate personalise the heart-rate limits. These are simple heuristics, not clinical criteria.

### Hybrid AI

| Task | Model | Mode |
| --- | --- | --- |
| Coaching tip and automatic check | `coachModel` | `PREFER_ON_DEVICE` |
| Doctor report | `reportModel` | `PREFER_IN_CLOUD` |
| Private symptom note | on-device first, cloud only if you agree | `ONLY_ON_DEVICE`, then `ONLY_IN_CLOUD` |

All calls are in [`src/ai.js`](src/ai.js) and prompts in [`src/prompts.js`](src/prompts.js). A badge shows **On device** or **In cloud**.

For Gemini Nano: 22 GB free disk and a GPU with more than 4 GB VRAM (or 16 GB RAM and 4+ cores), enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, restart, then click **Prepare on-device model**. Otherwise answers come from the cloud.

## Data model

| Path | Content |
| --- | --- |
| `users/{uid}` | profile, consent date, team code |
| `users/{uid}/windows` | one summary per 10 s (heart rate, variation, movement, temperature, humidity, label) |
| `users/{uid}/events` | alerts (type, start, end, peak) |
| `teams/{code}` | name, owner, directory settings |
| `teams/{code}/members/{uid}` | shared status, trend, last session, urgent flag, optional position |
| `teams/{code}/requests/{uid}` | applications to a premium team |
| `profiles/{uid}` | public card: name, handle, avatar, city, level, bio, findable flag |
| `handles/{handle}` | reserved handle → owner uid |
| `connections/{uidA_uidB}` | friend request or friendship (ids sorted), requester, status |
| `users/{uid}/friends/{friendUid}` | accepted friends, written on both sides with the acceptance |
| `runInvites/{teamCode_toUid}` | group-run invite: from, to, team, status, expiry |

Raw ECG and accelerometer signals are **never uploaded**. **Download raw signal** saves them to your computer for training.

## Security and privacy

- Health data is processed only after consent. It can be exported or deleted with the account.
- [`firestore.rules`](firestore.rules) denies everything by default, requires a verified email and checks keys, types and sizes.
- A user reads only their own data. Team members see each other's shared card, never email, profile details, raw ECG or AI answers.
- **Location** is sent only with Group run on, to your team only, and removed when you switch it off. If the app is closed abruptly, the last position stays on your card until it is overwritten or you leave the team.
- **Friends rules:** only the two people read or write their connection, only the receiver accepts, the connection id must match the two sorted uids, and requests go only to findable people. Friend lists are written only together with an accepted connection. Handles are first come, first served and cannot be taken over. Invites go only to accepted friends, from a team member, once per friend per team, for at most 2 hours.
- The map link sends the coordinates to openstreetmap.org when a teammate clicks it.
- Your name is not sent to the AI. Other profile values and readings are sent in prompts. Symptom notes are never stored.
- App Check protects AI Logic. Signing out clears the offline copy. Security headers are set in `firebase.json` (no Content-Security-Policy yet).
- The sign-in lockout is a browser courtesy, not a server protection.

## Tests

```bash
npm test
```

```bash
npm run test:rules
```

`npm test` runs the logic tests (signals, rules, safety check, team alerts, history). `npm run test:rules` checks the security rules in the emulator, including that another user cannot read or write your data.

## Model for the ESP32

A first training pipeline, not a finished model:

```bash
node ml/generate_dataset.mjs
```

```bash
python ml/train.py
```

It writes simulated sessions to `ml/data/` (never committed; downloaded raw recordings can be added), trains a small network with NumPy on four features per 10 s block, and exports `ml/out/pulseguard_model.h`. **Accuracy on simulated data says nothing about real hearts.** The C file has not been compiled or run on an ESP32, and feature extraction still has to be written in firmware.

## Project structure

```
index.html            pages and sign-in screens
src/boot.js           sign-in gate
src/router.js         one page per feature
src/monitor.js        live loop (signals, rules, chart)
src/healthcheck.js    automatic safety check
src/team.js           teams, discover, group run
src/team-alerts.js    warnings for teammates
src/friends.js        Friends page, public card, run invites
src/social.js         handles, connections, search helpers
src/location.js       GPS and distance
src/history-ui.js     recording and History page
src/replay.js         session replay
src/db.js             Firebase Auth and Firestore
src/ai.js             Firebase AI Logic
test/                 unit and security rules tests
ml/                   dataset and training scripts
```

## Known limits

- All sensor values are simulated. No shirt or ESP32 is connected yet.
- Alerts need open apps with a connection. A closed or sleeping phone receives nothing, and browsers may pause a background tab.
- No real payments, no verified coaches, one team per user.
- Friend requests and invites appear only while the app is open (no push notifications). Search is by name or handle prefix only. Firestore indexes in `firestore.indexes.json` must be deployed for search: `firebase deploy --only firestore`.
- On-device AI does not run on phones.

## License

[Apache 2.0](LICENSE)
