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

## How hybrid inference is used

All AI calls are in [`src/ai.js`](src/ai.js):

| Task | Model object | Mode |
| --- | --- | --- |
| Live coaching text | `coachModel` | `PREFER_ON_DEVICE` |
| Symptom note → JSON tags (structured output) | `symptomModel` | `PREFER_ON_DEVICE` |
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
