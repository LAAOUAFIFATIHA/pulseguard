// Settings page and the sign-out buttons (sidebar, top bar, settings).
import { auth, exportAll, signOutAndClear, deleteAccount, usesPassword } from "./db.js";
import { download } from "./history-ui.js";

const $ = (id) => document.getElementById(id);

export function initSettings() {
  const note = (msg) => ($("settings-status").textContent = msg);
  const email = auth.currentUser.email;
  $("account-email").textContent = email;
  $("header-email").textContent = email;
  $("delete-password-row").hidden = !usesPassword();

  const signOut = async (button) => {
    button.disabled = true;
    try {
      await signOutAndClear();
    } catch (err) {
      console.error(err);
      button.disabled = false;
      note("Sign-out failed. Try again.");
    }
  };
  for (const id of ["sign-out", "header-signout", "top-signout"]) {
    $(id).onclick = (e) => signOut(e.currentTarget);
  }

  $("export-data").onclick = async () => {
    try {
      note("Preparing your data…");
      download("pulseguard-my-data.json", await exportAll());
      note("Downloaded.");
    } catch (err) {
      console.error(err);
      note("Export failed. Check your connection.");
    }
  };

  $("delete-account").onclick = async () => {
    if (!navigator.onLine) return note("Connect to the internet to delete your account.");
    if (usesPassword() && !$("delete-password").value) return note("Type your password to confirm.");
    if (!confirm("Delete all your data and your account? This cannot be undone.")) return;
    try {
      note("Deleting…");
      $("save-history").checked = false; // no new writes while deleting
      await deleteAccount($("delete-password").value);
    } catch (err) {
      console.error(err);
      note(/credential|password/.test(err.code) ? "Wrong password." : "Deletion failed. Please try again.");
    }
  };
}
