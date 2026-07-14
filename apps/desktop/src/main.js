const SERVER_URL = "http://localhost:4567";
const POLL_INTERVAL = 800;
const MAX_WAIT = 60_000;

// ── License Key Management ──────────────────────────────────────
//
// TODO: Re-enable when enterprise license validation is implemented.
//       See packages/ee for planned features requiring license keys.
//
// const LICENSE_STORAGE_KEY = "larkup_license_key";
//
// function getSavedLicense() {
//   return localStorage.getItem(LICENSE_STORAGE_KEY);
// }
//
// function saveLicense(key) {
//   localStorage.setItem(LICENSE_STORAGE_KEY, key);
// }
//
// /**
//  * Validate a license key.
//  * Replace with an API call when the license server is ready:
//  *
//  *   const res = await fetch("https://api.larkup.de/license/validate", {
//  *     method: "POST",
//  *     headers: { "Content-Type": "application/json" },
//  *     body: JSON.stringify({ key }),
//  *   });
//  *   return res.ok;
//  */
// function validateLicense(key) {
//   const cleaned = key.trim().toUpperCase();
//   return /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(cleaned);
// }

// ── Server Health Polling ───────────────────────────────────────

async function waitForServer() {
  const statusEl = document.getElementById("status-text");
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT) {
    try {
      const res = await fetch(SERVER_URL, { mode: "no-cors" });
      // Any response means the server is up (no-cors gives opaque response)
      return true;
    } catch {
      // Server not ready yet
    }

    if (statusEl) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      statusEl.textContent = `Waiting for the server to boot (${elapsed}s)`;
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  if (statusEl) {
    statusEl.textContent = "Server took too long to start. Please restart the app.";
    statusEl.style.color = "#ef4444";
  }
  return false;
}

function navigateToApp() {
  const splash = document.getElementById("splash");
  if (splash) {
    splash.classList.add("fade-out");
    setTimeout(() => {
      window.location.href = SERVER_URL;
    }, 300);
  } else {
    window.location.href = SERVER_URL;
  }
}

// ── Boot Sequence ───────────────────────────────────────────────

async function boot() {
  const splash = document.getElementById("splash");

  // Community edition — go straight to loading (no license gate)
  splash.style.display = "flex";
  await startApp();

  // ── TODO: Re-enable license gate for enterprise ───────────
  //
  // const licenseGate = document.getElementById("license-gate");
  // const activateBtn = document.getElementById("activate-btn");
  // const licenseInput = document.getElementById("license-input");
  // const licenseError = document.getElementById("license-error");
  //
  // const savedKey = getSavedLicense();
  // if (savedKey && validateLicense(savedKey)) {
  //   licenseGate.style.display = "none";
  //   splash.style.display = "flex";
  //   await startApp();
  //   return;
  // }
  //
  // licenseGate.style.display = "flex";
  // splash.style.display = "none";
  //
  // activateBtn.addEventListener("click", async () => {
  //   const key = licenseInput.value.trim();
  //   if (!key) {
  //     licenseError.textContent = "Please enter a license key.";
  //     licenseError.style.display = "block";
  //     return;
  //   }
  //   if (!validateLicense(key)) {
  //     licenseError.textContent = "Invalid key format. Expected: XXXX-XXXX-XXXX-XXXX";
  //     licenseError.style.display = "block";
  //     return;
  //   }
  //   saveLicense(key.trim().toUpperCase());
  //   licenseError.style.display = "none";
  //   licenseGate.style.display = "none";
  //   splash.style.display = "flex";
  //   await startApp();
  // });
  //
  // licenseInput.addEventListener("keydown", (e) => {
  //   if (e.key === "Enter") activateBtn.click();
  // });
}

async function startApp() {
  // The sidecar might signal readiness via window.__LARKUP_SERVER_READY
  if (window.__LARKUP_SERVER_READY) {
    navigateToApp();
    return;
  }

  // Listen for the Rust side signaling readiness
  window.__onServerReady = () => navigateToApp();

  // Also poll as a fallback
  const ready = await waitForServer();
  if (ready) {
    navigateToApp();
  }
}

// Start
document.addEventListener("DOMContentLoaded", boot);
