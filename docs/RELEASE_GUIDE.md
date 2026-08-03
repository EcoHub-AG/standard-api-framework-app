# Release Guide — Windows & macOS

This is the top-level checklist for shipping a new version. It ties together
the three docs that already exist in this folder:

- [`WINDOWS_BUILD_SETUP.md`](./WINDOWS_BUILD_SETUP.md) — one-time setup of a
  Windows machine that can build + sign (Azure Key Vault).
- [`MACOS_BUILD_SETUP.md`](./MACOS_BUILD_SETUP.md) — one-time setup of a Mac
  that can build + sign + notarize (Apple Developer ID).
- [`RELEASING.md`](./RELEASING.md) — how the in-app updater's signing key
  and `latest.json` manifest work.

Read this file when you actually want to cut a release. Read the other
three only once, when setting up a new build machine.

## Why Windows and macOS are built separately

Tauri produces a single cross-platform app, but each OS needs its own native
signing credential and its own build machine:

| | Windows | macOS |
|---|---|---|
| Build machine | Windows PC | Mac |
| Signing credential | Azure Key Vault cert (`EcoHub-Code-Signing-CSR`) | Apple "Developer ID Application" cert (`.p12`) |
| Signing tool | AzureSignTool, via `scripts/sign.cmd` | `codesign`, invoked by Tauri automatically |
| Extra step | none | Notarization (Apple scans the binary — takes seconds to ~30 min) |
| Build script | `scripts\build-and-sign-windows.cmd` | `scripts/build-and-sign-macos.command` |
| Output | `.msi`, `.exe` (NSIS) in `src-tauri\target\release\bundle\{msi,nsis}\` | `.app`, `.dmg` in `src-tauri/target/release/bundle/{macos,dmg}/` |

There is no cross-compiling here — you cannot produce the macOS build from
Windows or vice versa. You need access to (or a colleague with) both a
Windows machine and a Mac, each already set up per the docs above.

## Versioning — one number for both platforms

There is **only one version number** for the whole app, kept in two files
that must always match:

- [`package.json`](../package.json) → `"version"`
- [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) → top-level `"version"`

Tauri reads that single field and stamps it into **both** platforms'
metadata automatically — you never set a separate Windows version or macOS
version:

- **Windows**: becomes the `.exe`/`.msi` file version and product version
  (what you see under file Properties → Details).
- **macOS**: becomes both `CFBundleShortVersionString` and
  `CFBundleVersion` in the `.app`'s `Info.plist` (what shows under "About"
  and in Finder's "Get Info").

So bumping the version is a single step done once, before building on
either machine — not something you do twice differently per platform.
Use plain semver (`MAJOR.MINOR.PATCH`, e.g. `0.2.0` → `0.2.1`); the
in-app updater compares these as semver to decide if a release is "newer."

**Never reuse a version number for a new release.** The updater and both
app stores' version metadata assume version numbers only go up. If you
need to re-publish the same code, bump the patch number anyway.

## Full release checklist

### 1. Bump the version (once, on whichever machine you're already on)

Edit both files to the same new version:

```jsonc
// package.json
"version": "0.2.0",

// src-tauri/tauri.conf.json
"version": "0.2.0",
```

Commit this change (e.g. `chore: bump version to 0.2.0`) and push, so both
build machines build from the same commit.

### 2. Set the updater signing key (on each build machine, before building)

The private key signs the update artifacts so the in-app updater can trust
them. It's git-ignored — you must have your own copy (see
[`RELEASING.md`](./RELEASING.md) for where it lives / how to recover it).

The CLI expects this env var to be the **base64-encoded** key file content
(not the raw minisign text) — it base64-decodes it internally before
parsing.

PowerShell (Windows):
```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = [Convert]::ToBase64String([IO.File]::ReadAllBytes("src-tauri\updater.key"))
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
```

bash (macOS):
```bash
export TAURI_SIGNING_PRIVATE_KEY=$(base64 -i src-tauri/updater.key)
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
```

### 3. Build on Windows

```powershell
.\scripts\build-and-sign-windows.cmd
```

Produces, alongside the installers: `latest.json` + `.sig` files (because
`bundle.createUpdaterArtifacts` is `true`). This `latest.json` only
describes the `windows-x86_64` platform.

Full walkthrough (Azure login, token, AzureSignTool): see
[`WINDOWS_BUILD_SETUP.md`](./WINDOWS_BUILD_SETUP.md) step 11.

### 4. Build on macOS

```bash
./scripts/build-and-sign-macos.command
```

Fill in your `APPLE_*` credentials in the script first if not already done
(see [`MACOS_BUILD_SETUP.md`](./MACOS_BUILD_SETUP.md) Part C). This also
produces its own `latest.json`, describing only `darwin-x86_64` and/or
`darwin-aarch64` depending on which target(s) you built.

### 5. Merge the two `latest.json` files into one

Windows and macOS each only know about themselves. Before uploading, merge
the `platforms` object from both into a single file, keeping one shared
`version`/`notes`:

```json
{
  "version": "0.2.0",
  "notes": "What changed in this release",
  "pub_date": "2026-08-03T00:00:00Z",
  "platforms": {
    "windows-x86_64": { "signature": "...", "url": "https://github.com/.../Standard-API-Framework_0.2.0_x64-setup.exe" },
    "darwin-x86_64":  { "signature": "...", "url": "https://github.com/.../Standard-API-Framework_0.2.0_x64.app.tar.gz" },
    "darwin-aarch64": { "signature": "...", "url": "https://github.com/.../Standard-API-Framework_0.2.0_aarch64.app.tar.gz" }
  }
}
```

Take the `windows-x86_64` entry from the Windows build's `latest.json` and
the `darwin-*` entries from the macOS build's `latest.json` — copy them
into one file by hand (or script it once you're doing this often).

### 6. Create the GitHub Release

- Tag: `vX.Y.Z` (must match the version you bumped to).
- Upload every installer + its matching `.sig` file from both machines:
  - Windows: `*.msi`, `*.exe` (NSIS), and their `.sig` files.
  - macOS: `*.dmg` and/or `.app.tar.gz`, and their `.sig` files.
- Upload the single **merged** `latest.json` from step 5.
- Write release notes — the `"notes"` field in `latest.json` is what shows
  in the in-app update banner, so keep it short and user-facing.

### 7. Publish

Once published, `https://.../releases/latest/download/latest.json` starts
serving the new manifest immediately. Existing installs pick it up the
next time they open the app (see the updater flow in
[`RELEASING.md`](./RELEASING.md)).

## Quick troubleshooting pointers

- Build/signing errors specific to one OS → see the **Troubleshooting**
  section at the bottom of that OS's setup doc
  ([Windows](./WINDOWS_BUILD_SETUP.md#troubleshooting) /
  [macOS](./MACOS_BUILD_SETUP.md#troubleshooting)).
- Update banner never appears after publishing → double check the merged
  `latest.json` actually has both platform keys, and that the tag/version
  in `tauri.conf.json` matches the GitHub Release tag.
- "Signature invalid" on install → the build wasn't signed with the same
  `updater.key` whose public half is embedded in `tauri.conf.json`
  (`plugins.updater.pubkey`) — see [`RELEASING.md`](./RELEASING.md).
