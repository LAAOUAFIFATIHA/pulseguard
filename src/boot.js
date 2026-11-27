// Sign-in gate. The app (main.js) is only loaded once someone is signed in,
// their email is verified and they have a profile with consent.
import "./style.css";
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
} from "firebase/auth";
import { auth, loadProfile, saveProfile, signOutAndClear } from "./db.js";
import { authMessage, countsAsFailure, createThrottle, MIN_PASSWORD } from "./auth-errors.js";

const $ = (id) => document.getElementById(id);
const SCREENS = ["boot-screen", "auth-screen", "verify-screen", "onboard-screen", "app"];
const show = (id) => SCREENS.forEach((s) => ($(s).hidden = s !== id));
const say = (id, msg = "") => ($(id).textContent = msg);

let mode = "signin";
let appLoaded = false;
const throttle = createThrottle();

// ── Sign in / sign up / reset ─────────────────────────────────────────────
function setMode(next) {
  mode = next;
  const signup = mode === "signup";
  $("auth-title").textContent = signup ? "Create your account" : "Sign in";
  $("auth-submit").textContent = signup ? "Create account" : "Sign in";
  $("auth-subtitle").textContent = signup ? "Start monitoring in a minute." : "Welcome back. Sign in to continue.";
  $("auth-switch-text").textContent = signup ? "Already have an account?" : "New to PulseGuard?";
  $("auth-switch").textContent = signup ? "Sign in" : "Create an account";
  $("signup-extra").hidden = !signup;
  $("auth-consent").required = signup;
  $("auth-password").autocomplete = signup ? "new-password" : "current-password";
  say("auth-message");
}

let countdown;
function lockWhileThrottled(reason) {
  clearInterval(countdown);
  const tick = () => {
    const left = throttle.wait();
    $("auth-submit").disabled = $("google-signin").disabled = left > 0;
    if (left > 0) say("auth-message", `${reason} Too many failed attempts. Wait ${left} s.`);
    else {
      clearInterval(countdown);
      say("auth-message", reason); // keep the real cause visible
    }
  };
  if (throttle.wait()) {
    tick();
    countdown = setInterval(tick, 1000);
  }
}

async function attempt(action) {
  if (throttle.wait()) return;
  $("auth-submit").disabled = $("google-signin").disabled = true;
  say("auth-message", "Please wait…");
  let reason;
  try {
    await action();
    throttle.succeed();
    say("auth-message");
  } catch (err) {
    console.error(err.code);
    if (countsAsFailure(err)) throttle.fail();
    say("auth-message", authMessage(err));
    reason = authMessage(err);
  } finally {
    $("auth-submit").disabled = $("google-signin").disabled = false;
    if (reason) lockWhileThrottled(reason);
  }
}

$("auth-form").onsubmit = (e) => {
  e.preventDefault();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  if (mode === "signup" && password.length < MIN_PASSWORD) {
    return say("auth-message", `Use at least ${MIN_PASSWORD} characters for your password.`);
  }
  attempt(async () => {
    if (mode === "signup") {
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(user);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  });
};

$("google-signin").onclick = () => attempt(() => signInWithPopup(auth, new GoogleAuthProvider()));
$("auth-switch").onclick = () => setMode(mode === "signup" ? "signin" : "signup");

$("toggle-password").onclick = () => {
  const hidden = $("auth-password").type === "password";
  $("auth-password").type = hidden ? "text" : "password";
  $("toggle-password").textContent = hidden ? "Hide" : "Show";
  $("toggle-password").setAttribute("aria-pressed", String(hidden));
};

$("reset-password").onclick = async () => {
  const email = $("auth-email").value.trim();
  if (!email) return say("auth-message", "Type your email first.");
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (err) {
    if (/network|invalid-email|too-many/.test(err.code)) return say("auth-message", authMessage(err));
  }
  say("auth-message", "If an account exists for that address, a reset link is on its way.");
};

// ── Email verification ────────────────────────────────────────────────────
$("check-verified").onclick = async () => {
  say("verify-message", "Checking…");
  try {
    await auth.currentUser.reload();
    if (!auth.currentUser.emailVerified) return say("verify-message", "Not verified yet. Open the link in your email.");
    await auth.currentUser.getIdToken(true); // so the rules see email_verified
    await route(auth.currentUser);
  } catch (err) {
    say("verify-message", authMessage(err));
  }
};
$("resend-email").onclick = async () => {
  try {
    await sendEmailVerification(auth.currentUser);
    say("verify-message", "Email sent. Check your inbox and spam folder.");
  } catch (err) {
    say("verify-message", authMessage(err));
  }
};
$("verify-signout").onclick = () => signOut(auth);

// ── First sign-in: profile + consent ──────────────────────────────────────
$("onboard-form").onsubmit = async (e) => {
  e.preventDefault();
  say("onboard-message", "Saving…");
  try {
    await saveProfile({
      displayName: $("ob-name").value,
      age: $("ob-age").value,
      restingHr: $("ob-rest").value,
      role: $("ob-role").value,
    });
    await route(auth.currentUser);
  } catch (err) {
    console.error(err);
    say("onboard-message", "Could not save your profile. Check the values and your connection.");
  }
};
$("onboard-signout").onclick = () => signOutAndClear();

/** A message the user can act on when the app cannot start. */
function bootError(err, stage) {
  if (!navigator.onLine) return "You are offline. Connect to the internet, then tap Retry.";
  if (stage === "app") return "The app could not start on this browser. Try Retry, or open it in Chrome.";
  if (err?.code === "permission-denied") {
    return "The database refused access. This happens when the site check (App Check) fails: tap Retry, or try a private tab.";
  }
  if (err?.code === "unavailable") return "Can't reach the database. Check your connection, then tap Retry.";
  return "Couldn't load your account. Tap Retry.";
}

$("boot-retry").onclick = () => location.reload();
$("boot-signout").onclick = () => signOutAndClear();

// ── Route guard ───────────────────────────────────────────────────────────
async function route(user) {
  if (!user || user.isAnonymous) {
    if (appLoaded) return location.reload(); // signed out elsewhere: drop all state
    if (user) await signOut(auth);
    setMode(mode);
    return show("auth-screen");
  }
  $("auth-password").value = "";
  if (!user.emailVerified) {
    say("verify-address", user.email);
    return show("verify-screen");
  }
  show("boot-screen");
  $("boot-actions").hidden = $("boot-detail").hidden = true;
  say("boot-message", "Loading PulseGuard…");
  let stage = "account";
  try {
    if (!(await loadProfile())) {
      $("ob-name").value ||= user.displayName ?? "";
      return show("onboard-screen");
    }
    stage = "app";
    if (!appLoaded) {
      await import("./main.js");
      appLoaded = true;
    }
    show("app");
  } catch (err) {
    console.error(err);
    show("boot-screen");
    say("boot-message", bootError(err, stage));
    // the exact cause, to report a problem
    $("boot-detail").textContent = `${stage}: ${err?.code ?? err?.name ?? "error"}${err?.message ? " · " + err.message.slice(0, 160) : ""}`;
    $("boot-detail").hidden = false;
    $("boot-actions").hidden = false;
  }
}

setMode("signin");
onAuthStateChanged(auth, route);
