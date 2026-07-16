#!/usr/bin/env node

/**
 * upload-desktop-releases.mjs
 *
 * Uploads Tauri desktop installer artifacts to UploadThing and
 * generates/updates a download manifest.
 *
 * Usage:
 *   node scripts/upload-desktop-releases.mjs --dir ./release-assets
 *   node scripts/upload-desktop-releases.mjs --dir ./release-assets --version 0.2.0
 *   node scripts/upload-desktop-releases.mjs --dir ./release-assets --dry-run
 *
 * Environment:
 *   UPLOADTHING_TOKEN  — required
 *
 * The script will:
 *   1. Scan the directory for .dmg, .exe, .AppImage files
 *   2. Delete any previous uploads with matching customId on UploadThing
 *   3. Upload the new files
 *   4. Upload/update a download-manifest.json with all URLs
 *   5. Print the manifest URL to stdout
 */

import fs from "node:fs";
import path from "node:path";
import { UTApi } from "uploadthing/server";

// ── Config ──────────────────────────────────────────────────────

const PLATFORM_MAP = {
  "aarch64.dmg": "macos-arm64",
  "x64.dmg": "macos-x64",
  "x64-setup.exe": "windows-x64",
  "x64_en-US.msi": "windows-x64",
  "amd64.AppImage": "linux-x64",
  "x86_64.AppImage": "linux-x64",
};

const CUSTOM_IDS = {
  "macos-arm64": "larkup-desktop-macos-arm64",
  "macos-x64": "larkup-desktop-macos-x64",
  "windows-x64": "larkup-desktop-windows-x64",
  "linux-x64": "larkup-desktop-linux-x64",
};

const MANIFEST_CUSTOM_ID = "larkup-download-manifest";
const TAURI_UPDATE_CUSTOM_ID = "larkup-tauri-latest-json";

// ── CLI Args ────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { dir: null, version: null, dryRun: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir" && args[i + 1]) opts.dir = args[++i];
    else if (args[i] === "--version" && args[i + 1]) opts.version = args[++i];
    else if (args[i] === "--dry-run") opts.dryRun = true;
    else if (args[i] === "--help") {
      console.log(`
Usage: node upload-desktop-releases.mjs [options]

Options:
  --dir <path>       Directory containing installer files (required)
  --version <x.y.z>  Version string (default: read from package.json)
  --dry-run          Scan and report without uploading
  --help             Show this help
`);
      process.exit(0);
    }
  }

  if (!opts.dir) {
    console.error("Error: --dir is required");
    process.exit(1);
  }

  return opts;
}

// ── Helpers ─────────────────────────────────────────────────────

function detectPlatform(filename) {
  for (const [suffix, platform] of Object.entries(PLATFORM_MAP)) {
    if (filename.endsWith(suffix)) return platform;
  }
  // Broader fallback patterns
  if (filename.endsWith(".dmg")) {
    if (filename.includes("aarch64") || filename.includes("arm64")) return "macos-arm64";
    if (filename.includes("x64") || filename.includes("x86_64") || filename.includes("intel")) return "macos-x64";
  }
  if (filename.endsWith(".exe")) return "windows-x64";
  if (filename.endsWith(".AppImage")) return "linux-x64";
  return null;
}

function scanInstallers(dir) {
  const files = fs.readdirSync(dir, { recursive: true });
  const results = {};

  for (const file of files) {
    const filename = typeof file === "string" ? file : file.toString();
    const basename = path.basename(filename);
    const platform = detectPlatform(basename);

    if (platform) {
      const fullPath = path.join(dir, filename);
      const stat = fs.statSync(fullPath);
      results[platform] = {
        path: fullPath,
        filename: basename,
        size: stat.size,
        platform,
      };
    }
  }

  return results;
}

function scanSignatures(dir) {
  const files = fs.readdirSync(dir, { recursive: true });
  const results = {};

  for (const file of files) {
    const filename = typeof file === "string" ? file : file.toString();
    if (filename.endsWith(".sig")) {
      const basename = path.basename(filename);
      const fullPath = path.join(dir, filename);
      // The .sig file corresponds to the installer with the same name minus .sig
      const installerName = basename.replace(/\.sig$/, "");
      const platform = detectPlatform(installerName);
      if (platform) {
        results[platform] = {
          path: fullPath,
          filename: basename,
          content: fs.readFileSync(fullPath, "utf-8").trim(),
        };
      }
    }
  }

  return results;
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  // Validate env
  if (!process.env.UPLOADTHING_TOKEN && !opts.dryRun) {
    console.error("Error: UPLOADTHING_TOKEN environment variable is required");
    process.exit(1);
  }

  // Read version
  if (!opts.version) {
    try {
      const pkgPath = path.resolve("apps/desktop/package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      opts.version = pkg.version;
    } catch {
      try {
        const pkgPath = path.resolve("package.json");
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        opts.version = pkg.version;
      } catch {
        opts.version = "0.0.0";
      }
    }
  }

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   Larkup Desktop — Upload to UploadThing    ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log();
  console.log(`  Version:   ${opts.version}`);
  console.log(`  Directory: ${opts.dir}`);
  console.log(`  Dry run:   ${opts.dryRun}`);
  console.log();

  // Scan for installers
  const installers = scanInstallers(opts.dir);
  const signatures = scanSignatures(opts.dir);

  const platforms = Object.keys(installers);
  if (platforms.length === 0) {
    console.error("Error: No installer files found in the directory");
    console.error("Expected: .dmg, .exe, or .AppImage files");
    process.exit(1);
  }

  console.log(`  Found ${platforms.length} installer(s):`);
  for (const [platform, info] of Object.entries(installers)) {
    const sizeMB = (info.size / 1024 / 1024).toFixed(1);
    const hasSig = signatures[platform] ? " + .sig" : "";
    console.log(`    • ${platform}: ${info.filename} (${sizeMB} MB)${hasSig}`);
  }
  console.log();

  if (opts.dryRun) {
    console.log("  Dry run — skipping upload");
    return;
  }

  // Initialize UTApi
  const utapi = new UTApi({
    token: process.env.UPLOADTHING_TOKEN,
  });

  // Step 1: Delete old files
  console.log("▸ Cleaning up old uploads...");
  const allCustomIds = [
    ...Object.values(CUSTOM_IDS),
    MANIFEST_CUSTOM_ID,
    TAURI_UPDATE_CUSTOM_ID,
  ];

  try {
    // List existing files and find ones with our custom IDs
    const existingFiles = await utapi.listFiles({ limit: 100 });
    const filesToDelete = existingFiles.files
      .filter((f) => allCustomIds.includes(f.customId))
      .map((f) => f.key);

    if (filesToDelete.length > 0) {
      await utapi.deleteFiles(filesToDelete);
      console.log(`  Deleted ${filesToDelete.length} old file(s)`);
    } else {
      console.log("  No old files to clean up");
    }
  } catch (err) {
    console.warn(`  Warning: Could not clean up old files: ${err.message}`);
  }

  // Step 2: Upload installers
  console.log();
  console.log("▸ Uploading installers...");
  const manifest = {
    version: opts.version,
    released_at: new Date().toISOString(),
    downloads: {},
  };

  for (const [platform, info] of Object.entries(installers)) {
    console.log(`  Uploading ${platform}: ${info.filename}...`);

    const fileBuffer = fs.readFileSync(info.path);
    const file = new File([fileBuffer], info.filename);

    const response = await utapi.uploadFiles(file, {
      metadata: { platform, version: opts.version },
      customId: CUSTOM_IDS[platform],
    });

    if (response.error) {
      console.error(`  ✗ Failed to upload ${platform}: ${response.error.message}`);
      process.exit(1);
    }

    manifest.downloads[platform] = {
      url: response.data.ufsUrl || response.data.url,
      filename: info.filename,
      size: info.size,
      key: response.data.key,
    };

    console.log(`  ✓ ${platform} uploaded`);
  }

  // Step 3: Upload download manifest
  console.log();
  console.log("▸ Uploading download manifest...");

  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestFile = new File([manifestJson], "download-manifest.json", {
    type: "application/json",
  });

  const manifestResponse = await utapi.uploadFiles(manifestFile, {
    customId: MANIFEST_CUSTOM_ID,
  });

  if (manifestResponse.error) {
    console.error(`  ✗ Failed to upload manifest: ${manifestResponse.error.message}`);
    process.exit(1);
  }

  const manifestUrl = manifestResponse.data.ufsUrl || manifestResponse.data.url;
  console.log(`  ✓ Manifest uploaded: ${manifestUrl}`);

  // Step 4: Upload Tauri update JSON (for auto-updater)
  console.log();
  console.log("▸ Uploading Tauri update manifest...");

  const tauriUpdate = {
    version: `v${opts.version}`,
    notes: `Larkup Desktop v${opts.version}`,
    pub_date: new Date().toISOString(),
    platforms: {},
  };

  // Map platform -> Tauri target names
  const tauriTargets = {
    "macos-arm64": "darwin-aarch64",
    "macos-x64": "darwin-x86_64",
    "windows-x64": "windows-x86_64",
    "linux-x64": "linux-x86_64",
  };

  for (const [platform, target] of Object.entries(tauriTargets)) {
    if (manifest.downloads[platform]) {
      tauriUpdate.platforms[target] = {
        url: manifest.downloads[platform].url,
        signature: signatures[platform]?.content || "",
      };
    }
  }

  const tauriUpdateJson = JSON.stringify(tauriUpdate, null, 2);
  const tauriUpdateFile = new File([tauriUpdateJson], "latest.json", {
    type: "application/json",
  });

  const tauriUpdateResponse = await utapi.uploadFiles(tauriUpdateFile, {
    customId: TAURI_UPDATE_CUSTOM_ID,
  });

  if (tauriUpdateResponse.error) {
    console.error(`  ✗ Failed to upload Tauri update: ${tauriUpdateResponse.error.message}`);
  } else {
    const tauriUrl = tauriUpdateResponse.data.ufsUrl || tauriUpdateResponse.data.url;
    console.log(`  ✓ Tauri update manifest uploaded: ${tauriUrl}`);
  }

  // Done
  console.log();
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  ✓ All uploads complete                     ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log();
  console.log(`  Manifest URL: ${manifestUrl}`);
  console.log();
  console.log("  Download URLs:");
  for (const [platform, info] of Object.entries(manifest.downloads)) {
    console.log(`    ${platform}: ${info.url}`);
  }
  console.log();

  // Write manifest to stdout-parseable format
  console.log(`::set-output name=manifest_url::${manifestUrl}`);
  console.log(`::set-output name=version::${opts.version}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
