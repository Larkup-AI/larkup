const SERVER_URL = "http://localhost:4567";
const POLL_INTERVAL = 800;
const MAX_WAIT = 120_000;

// ── License Key Management ──────────────────────────────────────

const LICENSE_STORAGE_KEY = "larkup_license_key";
// Allow overriding the API URL via local storage for testing, defaults to the vercel domain
const LICENSE_API_URL = localStorage.getItem("larkup_api_url") || "https://api-beige-omega-37.vercel.app";

function getSavedLicense() {
  return localStorage.getItem(LICENSE_STORAGE_KEY);
}

function saveLicense(key) {
  localStorage.setItem(LICENSE_STORAGE_KEY, key);
}

/**
 * Validate a license key against the Larkup API.
 */
async function validateLicense(key) {
  try {
    const cleaned = key.trim().toUpperCase();
    const res = await fetch(`${LICENSE_API_URL}/api/license/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: cleaned }),
    });
    
    if (!res.ok) return false;
    const data = await res.json();
    return data.valid === true;
  } catch (error) {
    console.error("License validation failed:", error);
    return false;
  }
}

// ── Server Health Polling ───────────────────────────────────────

async function waitForServer() {
  const statusEl = document.getElementById("status-text");
  const retryContainer = document.getElementById("retry-container");
  const spinner = document.getElementById("spinner");
  const start = Date.now();

  if (retryContainer) retryContainer.style.display = "none";
  if (spinner) spinner.style.display = "block";
  if (statusEl) statusEl.style.color = "#71717a";

  while (Date.now() - start < MAX_WAIT) {
    try {
      const res = await fetch(SERVER_URL, { mode: "no-cors", cache: "no-store" });
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
    statusEl.textContent = "Server took too long to start. Please try again.";
    statusEl.style.color = "#ef4444";
  }
  if (spinner) spinner.style.display = "none";
  if (retryContainer) retryContainer.style.display = "block";
  
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
  const licenseGate = document.getElementById("license-gate");
  const activateBtn = document.getElementById("activate-btn");
  const licenseInput = document.getElementById("license-input");
  const licenseError = document.getElementById("license-error");

  const savedKey = getSavedLicense();
  if (savedKey) {
    splash.style.display = "flex";
    const isValid = await validateLicense(savedKey);
    if (isValid) {
      licenseGate.style.display = "none";
      await startApp();
      return;
    } else {
      // Key expired or invalidated
      licenseError.textContent = "Your license key is invalid or has expired.";
      licenseError.style.display = "block";
    }
  }

  licenseGate.style.display = "flex";
  splash.style.display = "none";

  activateBtn.addEventListener("click", async () => {
    const key = licenseInput.value.trim();
    if (!key) {
      licenseError.textContent = "Please enter a license key.";
      licenseError.style.display = "block";
      return;
    }
    
    // Disable button while validating
    activateBtn.disabled = true;
    activateBtn.textContent = "Validating...";
    
    const isValid = await validateLicense(key);
    
    activateBtn.disabled = false;
    activateBtn.textContent = "Activate";

    if (!isValid) {
      licenseError.textContent = "Invalid license key. Please try again.";
      licenseError.style.display = "block";
      return;
    }

    saveLicense(key.trim().toUpperCase());
    licenseError.style.display = "none";
    licenseGate.style.display = "none";
    splash.style.display = "flex";
    await startApp();
  });

  licenseInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") activateBtn.click();
  });
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
document.addEventListener("DOMContentLoaded", () => {
  boot();

  const retryBtn = document.getElementById("retry-btn");
  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      startApp();
    });
  }
});
