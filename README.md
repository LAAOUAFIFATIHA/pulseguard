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
| **Home** | Feed with two tabs: **Following** (people you follow, your friends and you) and **Community** (public runs), 10 at a time, likes, comments and reports |
| **Live monitor** | Press **Start**: live ECG, heart rate, temperature, humidity, movement, alerts, latest coaching tip and the **automatic AI safety check** |
| **AI coach** | Coaching tip, doctor report, spoken tips, streaming answers with a request log, private symptom notes, on-device model setup |
| **History** | Saved sessions with distance, **Share** to the feed, and a replay player (heart-rate chart, alert zones, play/pause, 1× to 60×) |
| **Team** | Create, discover or join teams, live status of every member, group run with GPS, team alerts |
| **Friends** | Public card with @handle, search by name or handle, friend requests, **follow requests**, group-run invites |
| **Rating** | Your rating (starts at 500), rank and division (Rookie X to Legend I), chart, peak and the last changes with their reasons |
| **Plan a run** | AI run plan (warm-up, run, walk, water, rest, cool-down) checked by safety rules, then **live mode** with voice cues |
| **Compete** | Friend challenges (Incoming, Active, History), runners at your level, leaderboards |
| **Runner page** | Any runner's profile: counters, Follow / Add friend / Challenge / Mute / Block, and Posts, Records, Badges tabs |
| **Profile** | Your header (avatar, rank, runs, followers, following, friends, pinned badges) with tabs Posts, Records, Badges and Details (card editor, status, thresholds, personal details) |
| **Settings** | Data collection, account privacy (public or private), blocked and muted people, raw-signal download, export, sign out, delete account |

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

### Home feed and shared runs

- **History → Share** posts a run summary: distance, time, pace, average and maximum heart rate, alert count and a heart-rate chart. Choose **Everyone**, **Friends** or **Only me**. A post never contains raw ECG, location or AI answers.
- Distance and pace come from a **simulated** GPS speed (about 9.5 km/h when jogging, 0 at rest), shown on the Live monitor and saved in each 10 s summary.
- Likes: one per person; the like and the counter change in the same write, and the rules check they match.

### Demo runners for testing (local emulators only)

```bash
npm run emulators
```

```bash
npm run seed:demo
```

This adds 8 demo runners (handles `demo_…`, marked **Demo** in the feed) with public and friends-only runs, friendships, likes, ratings from 560 to 3110, weekly distance, challenge wins and follows. **Karim** has a private account. The test account follows Nora and Youssef, is followed by Adam, and has a challenge invite from Yasmine. Add `-- --friend your_handle` to make them friends with your test account so their friends-only runs appear. A ready test account is included: `test.runner@example.test` / `Demo-runner-2026` (friends with Yasmine, Omar and Salma). Demo runners sign in with `demo.<name>@example.test` and the same password. Open the test app with `npx vite --mode emulator --port 5180` (or `VITE_USE_EMULATORS=1 npm run dev`). In emulator mode the cloud AI is blocked by App Check, so the planner shows its **Rules plan** fallback. The script only talks to the local emulators and never to a real project.

### Friends and group-run invites

- Create a **public card** on the Profile page: name, unique **@handle** (3 to 20 characters: `a-z 0-9 _`), emoji avatar, city, runner level and bio. It never contains email, health data, raw ECG or AI answers.
- **Search** by name or @handle prefix (10 results). **Settings → Who can find me** hides you from search (Everyone / Nobody). Friends and pending requests still see your card.
- **Requests**: send, accept, decline, cancel, remove. A red badge in the menu counts open requests and invites.
- **Group-run invites**: from the Team page, invite accepted friends. An invite lasts 2 hours. Accepting it joins that team, premium included, and leaves your current team (one team at a time). Location is still shared only with **Group run** on.

### Follow, private accounts, block and mute

- **Follow** a public account at once; a **private** account gets a follow request that its owner approves or declines (Friends page). Following and followers are written on both sides in one batch.
- A private account shows only its name, avatar and rating to people who do not follow it. Turning private makes your public runs followers-only, and a private account cannot post publicly.
- **Block** ends follows in both directions, pending requests and the friendship. A blocked person cannot see your card or followers-only posts, follow you, comment, send a friend request or invite you. **Mute** only hides someone's posts from your feed. Both lists are private (Settings).
- Counters (runs, followers, following, friends) are counted from the relation documents, so nobody can type their own numbers.

### Rating and ranks

- Everyone starts at **500**. Ranks every 1000 points: Rookie, Pacer, Racer, Master, Grand Master, Legend; 10 divisions each (X lowest, I highest), for example **Master II**.
- A finished run is compared with what is expected at your rating (Elo-like), with K = 40, 20 then 12, bonuses for goals, consistency (up to ×1.2) and difficulty (heat, humidity, night: ×1 to ×1.5). Simulated runs count at 50 %.
- **No gain** after an urgent alert ("Rest is part of training"), and none for runs under 5 minutes, above 25 km/h or with more than 30 % signal lost. Runs never lower the rating; only inactivity does, slowly, and never below the start of your rank (rank shield).
- Each change is an event with its reasons; the rules check each event is used once and moves the rating by at most 60. Details: [docs/rating.md](docs/rating.md).

### Challenges and leaderboards

- Challenge a **friend**: run X km, run X km under Y minutes, most distance this week, most active days, or best endurance score, for 1 to 14 days.
- Invites expire after 48 h. Only runs **after acceptance and before the deadline** count. Each runner writes only their own result, and it must point to a real saved run inside that window.
- **Rated** challenges: finisher +10, winner +5 more, times difficulty and a level-gap factor (smaller when a much stronger runner beats a weaker one). Never negative, given once per challenge. At most 3 rated challenges a week and 1 per friend; a warning appears when the goal is above 130 % of your longest run.
- **Runners at your level**: findable runners within ±150 of your rating.
- **Leaderboards**: Friends, Following, My team, or My city (opt-in), by rating, this week's distance or challenges won.

### Badges and records

- 14 badges with a rarity, a description, the unlock date and a progress bar: First run, 7- and 30-day streak, 10 and 50 runs, 100 km, Early bird, Night owl, Heat warrior, Zone master, Iron heart, Challenger, Social runner, Coach student. Pin up to 3 on your profile. A toast and confetti appear when one unlocks.
- Records: longest run, fastest 1, 5 and 10 km (estimated from the average pace of longer runs), best endurance score, longest streak, most runs in a week, hottest run and rating peak. Others see your badges and records like the rest of your network (not when your account is private and they do not follow you).

### Run planner and live mode

- **Plan a run**: goal, level, age, resting heart rate, weather (typed, or **Use local weather** from Open-Meteo with rounded coordinates), start time and walk breaks.
- The AI (cloud first, Gemini Nano as fallback) returns **strict JSON** segments: type, start minute, duration, heart-rate zone 1 to 5, pace hint and note. A validator checks a 5 to 10 minute warm-up, a 5 minute cool-down, water at least every 20 minutes (12 when above 28 °C or 70 % humidity), a rest stop above 60 minutes and no zone 4 or 5 in the heat. If the AI is missing or its plan breaks a rule, a **Rules plan** is used instead (badge shown).
- **Live mode** (Live monitor, after **Start**): current segment, countdown, next segment, progress and time in zone. Voice cues in English, French or Arabic, never the same cue twice within 30 s. Heart rate above the zone for 20 s → "slow down" and 30 s more on the next walk or water stop. Skin temperature near its limit → "find shade" and an extra stop.
- The run keeps the plan id and how well it was followed; that adds a small bonus to the rating. Plans can be saved and shared with friends. General guidance, not medical advice.

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
| `profiles/{uid}` | public card: name, handle, avatar, city, level, bio, findable flag, rating and rank (must match the rating document), private flag, pinned badges, weekly km, challenges won, city leaderboard opt-in |
| `handles/{handle}` | reserved handle → owner uid |
| `connections/{uidA_uidB}` | friend request or friendship (ids sorted), requester, status |
| `users/{uid}/friends/{friendUid}` | accepted friends, written on both sides with the acceptance |
| `runInvites/{teamCode_toUid}` | group-run invite: from, to, team, status, expiry |
| `posts/{id}` | shared run: author card, caption, visibility, summary stats, heart-rate trend, like count |
| `posts/{id}/likes/{uid}` | one like per person |
| `posts/{id}/comments/{cid}` | comments (the post owner can hide them) |
| `reports/{id}` | reports of posts or comments (create only) |
| `users/{uid}/runs/{sessionId}` | finished run summary: distance, time, heart rate, zones, endurance, plan id and adherence |
| `users/{uid}/rating/current` | rating, peak, rank, rated runs, last event |
| `users/{uid}/ratingEvents/{id}` | one event per run, challenge or inactivity week, with its reasons |
| `users/{uid}/following/{uid}`, `followers/{uid}` | follows, written on both sides |
| `users/{uid}/followRequests/{uid}` | requests to follow a private account |
| `users/{uid}/blocked/{uid}`, `muted/{uid}` | private lists |
| `users/{uid}/badges/{id}` | unlocked badges |
| `users/{uid}/public/records` | personal records |
| `users/{uid}/runPlans/{id}` | saved run plans, optionally shared with friends |
| `challenges/{id}` | two friends, type, goal, days, rated, status, deadline, winner |
| `challenges/{id}/results/{uid}` | each runner's own progress and the run that proves it |

Raw ECG and accelerometer signals are **never uploaded**. **Download raw signal** saves them to your computer for training.

## Security and privacy

- Health data is processed only after consent. It can be exported or deleted with the account.
- [`firestore.rules`](firestore.rules) denies everything by default, requires a verified email and checks keys, types and sizes.
- A user reads only their own data. Team members see each other's shared card, never email, profile details, raw ECG or AI answers.
- **Location** is sent only with Group run on, to your team only, and removed when you switch it off. If the app is closed abruptly, the last position stays on your card until it is overwritten or you leave the team.
- **Post rules:** public posts are readable by signed-in users, friends-only posts only by accepted friends, private posts only by the owner. The author block must match the poster's own public card. Only the owner edits the caption or visibility, or deletes. The like counter moves by one only together with the person's own like.
- **Friends rules:** only the two people read or write their connection, only the receiver accepts, the connection id must match the two sorted uids, and requests go only to findable people. Friend lists are written only together with an accepted connection. Handles are first come, first served and cannot be taken over. Invites go only to accepted friends, from a team member, once per friend per team, for at most 2 hours.
- **Follow and block rules:** you can only follow as yourself, never while blocked, and a private account only through its own approval. Block and mute lists are readable only by their owner. Blocked people cannot read the card, followers-only posts, comment, request friendship or invite.
- **Rating rules:** the card's rating and rank must equal the rating document; every change needs a new event in the same batch, used once, at most ±60; run events need a saved run, challenge events a challenge you are in, decay events stay above the rank floor.
- **Challenge rules:** only friends, never a blocked pair; only the invited friend accepts, within 48 h; each runner writes only their own result from a real run inside the window; a challenge closes after the deadline or when both met the goal.
- **Weather:** Use local weather sends rounded coordinates (about 1 km) to open-meteo.com, only when you press it.
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

`npm test` runs 79 logic tests: signals, rules, safety check, team alerts, history, rating and calibration, run summaries, challenges (including the table of the 4 outcomes), every badge condition and records, and the run planner with a fake clock (segments, cues, anti-repeat, slow-down, heat stop). `npm run test:rules` runs 51 security-rule tests in the emulator: other users cannot read or write your data, follows, private accounts, blocks, rating events, comments, challenges and results, badges and shared plans.

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
src/home.js           Home feed, post cards, Share dialog
src/feed.js           merges feed sources newest first
src/people.js         runner pages, follow, block, mute, privacy
src/rating.js         rating model, ranks, endurance score
src/ratingui.js       Rating page, rank badge, confetti
src/runsummary.js     finished-run summary
src/challenges.js     challenge rules and outcomes (pure)
src/compete.js        Compete page, leaderboards
src/achievements.js   badges and records (pure)
src/badgesui.js       Records and Badges tabs
src/runplan.js        rules plan, validator, live engine (pure)
src/planui.js         Plan a run page and live mode
src/run.js            distance and pace
scripts/seed-demo.mjs demo runners for the emulators
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
- Distance, pace and heart rate in posts are simulated. Deleting an account removes its posts but not the likes it left on other people's posts.
- Friend requests and invites appear only while the app is open (no push notifications). Search is by name or handle prefix only. Firestore indexes in `firestore.indexes.json` must be deployed for search: `firebase deploy --only firestore`.
- On-device AI does not run on phones.
- Rating, challenge outcomes, weekly km and challenges won are computed in the app. The rules limit each change (±60, once per run or challenge, never negative for runs and challenges), but a modified client could still choose a value inside those limits. A Cloud Function should compute them on the server.
- A blocked person can still see your **public** posts in the Community feed list (the app hides them; Firestore list queries cannot check blocks per document).
- Fastest 1/5/10 km are estimated from whole-run average pace. Badges and records are recomputed when you open your profile or finish a run.

## License

[Apache 2.0](LICENSE)
