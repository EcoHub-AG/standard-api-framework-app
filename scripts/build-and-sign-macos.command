#!/bin/bash
set -e
cd "$(dirname "$0")/.."

# ============================================================
# Config - fill these in once you have an Apple Developer
# account and a Developer ID Application certificate.
# See docs/MACOS_BUILD_SETUP.md for how to obtain each value.
# ============================================================

# Path to the exported certificate (.p12) and its password.
export APPLE_CERTIFICATE="$(base64 -i /path/to/DeveloperIDApplication.p12)"
export APPLE_CERTIFICATE_PASSWORD="<p12-export-password>"

# The exact signing identity string, e.g.
# "Developer ID Application: EcoHub AG (TEAMID1234)"
export APPLE_SIGNING_IDENTITY="Developer ID Application: <Your Org Name> (<TEAMID>)"

# Apple ID used for notarization + an app-specific password
# generated at https://appleid.apple.com/account/manage
export APPLE_ID="<your-apple-id-email>"
export APPLE_PASSWORD="<app-specific-password>"
export APPLE_TEAM_ID="<TEAMID>"

# ============================================================
# 1. Sanity checks
# ============================================================
if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found. See docs/MACOS_BUILD_SETUP.md."
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "[ERROR] Rust/cargo not found. See docs/MACOS_BUILD_SETUP.md."
  exit 1
fi

if [[ "$APPLE_TEAM_ID" == "<TEAMID>" ]]; then
  echo "[ERROR] Apple signing values are still placeholders."
  echo "Edit scripts/build-and-sign-macos.command and fill in your Apple Developer details."
  exit 1
fi

# ============================================================
# 2. Install dependencies
# ============================================================
echo "[INFO] Installing npm dependencies..."
npm install

# ============================================================
# 3. Build, sign, and notarize via Tauri
# ============================================================
echo "[INFO] Building, signing, and notarizing macOS bundle..."
npm run tauri build

echo "[OK] Build complete. Installers are in src-tauri/target/release/bundle/"
echo "Press any key to close this window..."
read -n 1 -s
