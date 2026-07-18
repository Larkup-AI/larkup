const SERVER_URL = "http://127.0.0.1:4567";
const POLL_INTERVAL = 800;
const MAX_WAIT = 120_000;



// Server Health Polling

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
      const res = await fetch(SERVER_URL, {
        mode: "no-cors",
        cache: "no-store",
      });
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

// Boot Sequence

async function boot() {
  const splash = document.getElementById("splash");
  if (splash) splash.style.display = "flex";
  await startApp();
}

async function startApp() {
  // We no longer rely on Javascript to navigate, because Tauri blocks it
  // and redirects it to the default browser via shell.open.
  // The Rust sidecar code will detect when the server is ready 
  // and use window.navigate() to securely redirect the webview.
  
  // Just show the "waiting for server" message by polling
  await waitForServer();
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
