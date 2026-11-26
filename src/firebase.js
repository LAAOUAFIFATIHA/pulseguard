// Step 3 + Step 4 of the Part 1 guide.
// Every other file imports `app` from here, so Firebase is initialised once.
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

const env = import.meta.env;

export const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
});

// App Check debug mode — MUST be set BEFORE initializeAppCheck().
// - In `npm run dev` it is always on.
// - VITE_APPCHECK_DEBUG_TOKEN (optional, in .env) pins a token you already
//   registered in the console; otherwise `true` makes the SDK print a new one
//   in the browser console ("App Check debug token: ...").
// Never paste a real token in this file: it would end up in the public repo.
if (env.DEV) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = env.VITE_APPCHECK_DEBUG_TOKEN || true;
}

// In debug mode the provider below is bypassed by the debug provider.
// Part 2 replaces the placeholder with a real reCAPTCHA v3 / Enterprise site
// key so judges can use the hosted link.
export const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider(env.VITE_RECAPTCHA_SITE_KEY || "debug-placeholder"),
  isTokenAutoRefreshEnabled: true,
});
