// Step 3 + Step 4 of the Part 1 guide, plus the production App Check provider.
// Every other file imports `app` from here, so Firebase is initialised once.
//
// Each variable is read as `import.meta.env.NAME` on purpose: Vite then inlines
// only that value. Copying `import.meta.env` into a variable would ship every
// VITE_ value (including a debug token) in the public bundle.
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";

export const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

// App Check debug mode — dev only, and it MUST be set BEFORE initializeAppCheck().
// VITE_APPCHECK_DEBUG_TOKEN (optional) pins a token already registered in the
// console; otherwise `true` makes the SDK print a new one in the console.
// In `npm run build` this whole block is removed, token included.
if (import.meta.env.DEV) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
}

// Production provider: Google Cloud Fraud Defense (formerly reCAPTCHA
// Enterprise). reCAPTCHA v3 "Classic" is deprecated in the Firebase console.
// The site key is public (it ships in the page); there is no secret key here.
const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;

/** False in a production build made without a reCAPTCHA site key. */
export const appCheckReady = Boolean(import.meta.env.DEV || siteKey);
if (!appCheckReady) {
  console.error("VITE_RECAPTCHA_SITE_KEY is missing: App Check cannot run in this production build.");
}

export const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(siteKey || "missing-site-key"),
  isTokenAutoRefreshEnabled: true,
});
