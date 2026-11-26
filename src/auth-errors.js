// Friendly sign-in messages and client-side throttling. Messages never say
// whether an email address has an account.

const BAD_LOGIN = "Email or password is incorrect.";
const MESSAGES = {
  "auth/invalid-credential": BAD_LOGIN,
  "auth/invalid-login-credentials": BAD_LOGIN,
  "auth/user-not-found": BAD_LOGIN,
  "auth/wrong-password": BAD_LOGIN,
  "auth/user-disabled": BAD_LOGIN,
  "auth/email-already-in-use":
    "We couldn't create the account. If you already have one, sign in or reset your password.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/weak-password": "Choose a stronger password (at least 10 characters).",
  "auth/password-does-not-meet-requirements": "That password does not meet the requirements.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes, then try again.",
  "auth/network-request-failed": "No connection. Check your network and try again.",
  "auth/popup-closed-by-user": "The Google window was closed before sign-in finished.",
  "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups and try again.",
  "auth/unauthorized-domain": "This web address is not authorised for sign-in yet.",
  "auth/operation-not-allowed": "This sign-in method is not enabled yet.",
  "auth/configuration-not-found": "Sign-in is not set up yet for this app (Firebase Authentication is off).",
  "auth/requires-recent-login": "For safety, confirm your identity again.",
};

export const authMessage = (err) => MESSAGES[err?.code] ?? "Something went wrong. Please try again.";

// Setup and network problems are not wrong guesses: they never lock the form.
export const countsAsFailure = (err) =>
  !/configuration-not-found|operation-not-allowed|unauthorized-domain|network-request-failed|popup/.test(err?.code ?? "");

export const MIN_PASSWORD = 10;

/** After 3 failures, lock for 15 s, doubling each time, at most 5 minutes. */
export function createThrottle({ now = Date.now, free = 3, base = 15, max = 300 } = {}) {
  let failures = 0;
  let until = 0;
  return {
    fail() {
      failures++;
      if (failures >= free) until = now() + Math.min(max, base * 2 ** (failures - free)) * 1000;
    },
    succeed() {
      failures = 0;
      until = 0;
    },
    /** Seconds still to wait (0 when allowed). */
    wait: () => Math.max(0, Math.ceil((until - now()) / 1000)),
  };
}
