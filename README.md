# PulseGuard

PulseGuard is an ECG coaching companion for Chrome. It uses **Firebase AI Logic hybrid inference**: short coaching tips and symptom notes run on-device with **Gemini Nano** when the laptop supports it (so they still work offline), and long ECG reports go to **Gemini in the cloud**. Every request is protected by **Firebase App Check**, and a badge shows which model answered: green **On device** or blue **In cloud**.

## Run it

```bash
git clone https://github.com/LAAOUAFIFATIHA/pulseguard.git
cd pulseguard
npm install
cp .env.example .env
npm run dev
```

Then fill `.env` with your Firebase web config and open the address Vite prints in **Chrome 139+ on a desktop or laptop**.

## Firebase setup

Create a Firebase project (Analytics not needed, Spark plan is fine), open **AI Services → AI Logic → Get started**, choose the **Gemini Developer API**, and finish the workflow (it enforces App Check for AI Logic). Register a web app under **Project settings → Your apps → Web** and copy its config into `.env`. Run `npm run dev`, copy the `App Check debug token` printed in the browser console, and add it under **Security → App Check → Apps → Manage debug tokens** (optionally also put it in `.env` as `VITE_APPCHECK_DEBUG_TOKEN` so it stays the same).

## History and training data

Tick **Save my ECG sessions** to store 10-second ECG blocks (int16, 250 Hz) with their scenario label, beats and alerts, plus the AI answers, in Cloud Firestore. Each browser signs in anonymously and can only read its own data ([firestore.rules](firestore.rules)). **Export** downloads a session as JSON for training. The data is simulated: a model trained on it learns the simulator, not real hearts.

Each block also holds the accelerometer signal (25 Hz), skin temperature and humidity (1 Hz) and the measured movement (moving / still). Sessions carry the optional profile (age, sex, running level, height, weight). All sensor values are simulated.

Setup: enable **Authentication → Anonymous**, create a **Firestore database**, then run `firebase deploy --only firestore:rules`.

## Deploy (Firebase Hosting)

The hosted site cannot use the debug token, so App Check uses **Google Cloud Fraud Defense** (formerly reCAPTCHA Enterprise; reCAPTCHA v3 "Classic" is deprecated):

1. In the Google Cloud console for the same project, open **Fraud Defense** (reCAPTCHA) and create a **website** key with the domains `<project-id>.web.app` and `<project-id>.firebaseapp.com` (never `localhost`), without the checkbox challenge.
2. Put its **site key** in `.env` as `VITE_RECAPTCHA_SITE_KEY`.
3. In the Firebase console, **Security → App Check → Apps → your web app → Fraud Defense**, paste the same site key and save.
4. Run `firebase login` once, then `npm run deploy` (tests, build, deploy to `https://<project-id>.web.app`).

Answers are streamed, and a request log shows which side answered and how fast. Coaching tips can be read aloud (browser speech synthesis). Symptom notes go through a privacy gate: they are processed on-device, the app asks before sending one to the cloud, and they are never saved in the history.

## Live ECG monitor

The smart T-shirt is simulated ([`src/ecg.js`](src/ecg.js)): a synthetic ECG (P, QRS and T waves) is generated in real time and drawn as a heart-monitor sweep. Heart rate is **measured from the signal** by an R-peak detector, and threshold rules in [`src/anomaly.js`](src/anomaly.js) raise alerts once a condition lasts 8 seconds:

| Alert | Rule |
| --- | --- |
| Fast heart rate at rest | above 120 bpm while resting |
| Slow heart rate | below 50 bpm |
| Irregular rhythm | R-R interval variation (CV) above 15 % |
| Above exercise target zone | above 145 bpm while exercising |
| Signal lost | no beat for 3 s |

**Coach me now** sends the live reading as a short single-turn prompt (on-device first); **Doctor report** sends the whole session with its alert timeline (cloud first). Prompts are built in [`src/prompts.js`](src/prompts.js). Run `npm test` to check the rules against every scenario.

PulseGuard is a demo, not a medical device.

## How hybrid inference is used

All AI calls are in [`src/ai.js`](src/ai.js):

| Task | Model object | Mode |
| --- | --- | --- |
| Live coaching text | `coachModel` | `PREFER_ON_DEVICE` |
| Private symptom note → JSON tags (structured output) | `privateSymptomModel`, then `cloudSymptomModel` only if you agree | `ONLY_ON_DEVICE`, then `ONLY_IN_CLOUD` |
| Long report, trends, doctor summary | `reportModel` | `PREFER_IN_CLOUD` |

`response.inferenceSource` (`on_device` / `in_cloud`) drives the badge.

## Getting Gemini Nano on device

1. Chrome 139+, 22 GB free disk, a GPU with more than 4 GB VRAM (or 16 GB RAM and 4+ cores).
2. Enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and restart Chrome.
3. In the app, click **Prepare on-device model** and wait for 100 %. `chrome://on-device-internals` should show the model as ready.

Until the model is ready, `PREFER_ON_DEVICE` answers from the cloud.

## Known limits

- On-device: single-turn text (and images), structured output, up to 9,216 tokens per request. No multi-turn chat, audio, PDFs or tools.
- The App Check debug token works only in the browser where it was registered; a production provider for the hosted link comes in Part 2.

## License

[Apache 2.0](LICENSE)

## Part 3: a model for the ESP32 (pipeline test)

```bash
node ml/generate_dataset.mjs
python ml/train.py
```

The first command writes simulated sessions to `ml/data/`; app exports can be dropped in the same folder. `train.py` (NumPy only) computes four features per 10 s block (heart rate, R-R variation, ECG and acceleration spread), trains a small neural network with a train/test split by session, and exports `ml/out/pulseguard_model.h` for microcontrollers. **The accuracy on simulated data says nothing about real hearts:** it only shows the pipeline works. The C code has not been compiled or run on an ESP32 yet, and the feature extraction still has to be ported to firmware.
