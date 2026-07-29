# macOS Build & Signing Setup (Fresh Machine)

This guide sets up a Mac from scratch to build, sign, and notarize the
Standard API Framework Tauri app, and covers getting the Apple Developer
credentials you don't have yet.

macOS signing is completely separate from the Windows/Azure Key Vault setup —
Apple requires its own certificate and its own notarization step. There is no
way to sign a macOS app with the Azure Key Vault certificate; Apple only
accepts certificates it issues itself.

## Part A — One-time Apple Developer setup

### 1. Enroll in the Apple Developer Program

- Go to https://developer.apple.com/programs/enroll/
- Enroll as an **Organization** (not Individual) if you want the cert issued
  to "EcoHub AG" rather than a personal name — this requires a D-U-N-S number
  for the company, which Apple can look up during enrollment.
- Cost: $99 USD/year.
- Approval can take from a few hours to a few days for organizations.

### 2. Create a Developer ID Application certificate

This is the certificate type Apple requires for software distributed
**outside** the Mac App Store (which is your case).

1. On a Mac, open **Keychain Access** → menu **Keychain Access → Certificate
   Assistant → Request a Certificate From a Certificate Authority**.
2. Enter your email, name, select **Saved to disk**, and save the
   `CertificateSigningRequest.certSigningRequest` file.
3. Go to https://developer.apple.com/account/resources/certificates/list
4. Click **+**, choose **Developer ID Application**, upload the CSR file.
5. Download the resulting `.cer` file and double-click it to install it into
   your Keychain (it pairs automatically with the private key generated in
   step 1).

### 3. Export the certificate as a .p12 file

1. In Keychain Access, find the new certificate under **My Certificates**
   (login keychain). It will show a disclosure triangle with the private key
   under it.
2. Right-click the certificate → **Export "Developer ID Application: ..."**
3. Save as `DeveloperIDApplication.p12`, set an export password — you'll
   need this password later as `APPLE_CERTIFICATE_PASSWORD`.

### 4. Find your Team ID

https://developer.apple.com/account → **Membership** → **Team ID**
(a 10-character alphanumeric string).

### 5. Create an app-specific password for notarization

1. Go to https://appleid.apple.com/account/manage
2. Sign in, go to **Sign-In and Security → App-Specific Passwords**
3. Generate one, label it e.g. "Tauri Notarization"
4. Save it — this is `APPLE_PASSWORD` (NOT your normal Apple ID password).

You now have everything needed:
- `DeveloperIDApplication.p12` file + its export password
- Signing identity string (find it by running `security find-identity -v -p codesigning` — see step 4 below)
- Apple ID email
- App-specific password
- Team ID

## Part B — Set up the build machine

### 1. Install Xcode Command Line Tools

```bash
xcode-select --install
```

### 2. Install Homebrew (if not already installed)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 3. Install Node.js

```bash
brew install node
```

Verify:
```bash
node -v
npm -v
```

### 4. Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Restart your terminal, then verify:
```bash
rustc --version
cargo --version
```

Add both Apple Silicon and Intel targets so you can build universal binaries
if needed:
```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

### 5. Install the certificate into your Keychain

Double-click `DeveloperIDApplication.p12` (from Part A, step 3) in Finder,
or:

```bash
security import DeveloperIDApplication.p12 -k ~/Library/Keychains/login.keychain-db -P "<export-password>" -T /usr/bin/codesign
```

Then confirm it's usable for code signing:

```bash
security find-identity -v -p codesigning
```

You should see a line like:
```
1) ABCD1234... "Developer ID Application: EcoHub AG (TEAMID1234)"
```
The quoted string is your `APPLE_SIGNING_IDENTITY`.

### 6. Clone the project

```bash
git clone <repo-url> standard-api-framework-app
cd standard-api-framework-app
```

### 7. Make the build script executable

Git doesn't always preserve the executable bit across platforms, so run
this once after cloning:

```bash
chmod +x scripts/build-and-sign-macos.command
```

## Part C — Configure and run the build script

Open `scripts/build-and-sign-macos.command` in a text editor and fill in the
placeholders at the top:

```bash
export APPLE_CERTIFICATE="$(base64 -i /path/to/DeveloperIDApplication.p12)"
export APPLE_CERTIFICATE_PASSWORD="<p12-export-password>"
export APPLE_SIGNING_IDENTITY="Developer ID Application: EcoHub AG (TEAMID1234)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="<app-specific-password>"
export APPLE_TEAM_ID="TEAMID1234"
```

Then either:

- **Double-click** `build-and-sign-macos.command` in Finder, or
- Run it from Terminal:
  ```bash
  ./scripts/build-and-sign-macos.command
  ```

The script will:
1. Verify Node.js and Rust are installed
2. Run `npm install`
3. Run `npm run tauri build`, which — because the `APPLE_*` environment
   variables are set — automatically signs the `.app` bundle and `.dmg`,
   then submits it to Apple for notarization and staples the ticket

Output lands in:
```
src-tauri/target/release/bundle/macos/*.app
src-tauri/target/release/bundle/dmg/*.dmg
```

Notarization can take anywhere from under a minute to ~30 minutes depending
on Apple's queue; `tauri build` waits for it to complete before finishing.

## Verifying the result

```bash
codesign -dv --verbose=4 "src-tauri/target/release/bundle/macos/Standard API Framework.app"
spctl -a -vv "src-tauri/target/release/bundle/macos/Standard API Framework.app"
```

`spctl` should report `accepted` and `source=Notarized Developer ID`.

## Troubleshooting

- **"errSecInternalComponent" during signing** — the Keychain is locked or
  the cert/key pair didn't import correctly. Re-run the `security import`
  step and make sure you double-click-installed the `.cer` from Apple into
  the *same* keychain that holds the private key from the CSR step.
- **Notarization fails with "The signature does not include a secure
  timestamp"** — usually a `codesign` flag issue; make sure you're on a
  recent Xcode Command Line Tools version (`xcode-select --install` again
  or `softwareupdate --list`).
- **Notarization fails with "Team ID mismatch"** — double-check
  `APPLE_TEAM_ID` matches the team the certificate was issued under.
- **"No identity found" from codesign** — run
  `security find-identity -v -p codesigning` and confirm the exact string
  matches `APPLE_SIGNING_IDENTITY` character-for-character, including the
  parenthesized Team ID.
