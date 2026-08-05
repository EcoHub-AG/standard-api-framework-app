# Releasing via the CI Pipeline

This is the current way to ship a release — GitHub Actions builds and
publishes both platforms automatically. It replaces the manual
"build on your own Mac, build on your own PC, merge the JSON by hand"
process in [`RELEASE_GUIDE.md`](./RELEASE_GUIDE.md), which is kept
only as background reading on how the signing itself works.

## What the pipeline does

Two workflows live in [`.github/workflows`](../.github/workflows):

- **`ci.yml`** — runs on every push/PR to `master`. Type-checks and
  builds the frontend, and runs `cargo check` for both macOS and
  Windows. No secrets, no artifacts, just a sanity check.
- **`release.yml`** — runs when you push a tag matching `vX.Y.Z`.
  Builds both platforms in parallel and publishes one **draft** GitHub
  Release:
  - **macOS**: a universal build (Intel + Apple Silicon) via
    `--target universal-apple-darwin`. **Not codesigned or notarized**
    (no Apple Developer account is wired into CI) — installers will
    trigger Gatekeeper's "unidentified developer" warning, and users
    need to right-click → Open the first time.
  - **Windows**: codesigned using the Azure Key Vault certificate,
    same as `scripts/sign.cmd` does locally.
  - Both jobs publish to the *same* release, and `tauri-action` merges
    each platform's `latest.json` into a single manifest automatically
    — you don't merge anything by hand.

## One-time setup (already done, listed for reference)

These repo secrets must exist under **Settings → Secrets and variables
→ Actions** for the workflow to actually produce signed/working
artifacts (see [`RELEASING.md`](./RELEASING.md) and
[`WINDOWS_BUILD_SETUP.md`](./WINDOWS_BUILD_SETUP.md) for what each
value means and how to obtain it):

| Secret | Purpose |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | base64 of `src-tauri/updater.key` — signs update artifacts so the in-app updater trusts them |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | passphrase for that key (empty, per `RELEASING.md`) |
| `AZURE_CREDENTIALS` | JSON from `az ad sp create-for-rbac --sdk-auth` for a service principal with sign rights on the `EcoHub-Code-Signing-CSR` cert — used by `azure/login` to authenticate before `scripts/sign.cmd` runs |

If macOS signing/notarization is added back later, the Apple secrets
(`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`,
`APPLE_TEAM_ID`) would need to be restored to the `release.yml` env
block — see `docs/MACOS_BUILD_SETUP.md` for how to obtain them.

## Every release

### 1. Bump the version and merge it to `master`

Edit both files to the same new version and open a normal PR:

```jsonc
// package.json
"version": "0.2.0",

// src-tauri/tauri.conf.json
"version": "0.2.0",
```

Merging this to `master` does **not** trigger a release by itself —
`release.yml` only runs off a tag push. `ci.yml` will run on the PR as
a normal sanity check.

### 2. Tag the merged commit and push the tag

```bash
git checkout master
git pull
git tag v0.2.0
git push origin v0.2.0
```

The tag name must be `vX.Y.Z` and match the version you just merged —
nothing enforces this automatically, so double-check before pushing.

### 3. Watch the pipeline

Pushing the tag triggers `release.yml`. Follow it under the repo's
**Actions** tab. It runs the macOS and Windows jobs in parallel; each
takes roughly 10–20 minutes (Windows signing adds a little, mostly from
Azure token exchange + `AzureSignTool`).

If a job fails on a placeholder/missing secret, fix the secret and
re-run just that job from the Actions UI — no need to re-tag.

### 4. Review and publish the draft release

When both jobs finish, a **draft** release named
`Standard API Framework vX.Y.Z` appears under the repo's **Releases**
tab, containing:

- `*.msi` / `*-setup.exe` (Windows) and their `.sig` files
- `*.dmg` and/or `.app.tar.gz` (macOS) and their `.sig` files
- one merged `latest.json` describing `windows-x86_64`, `darwin-x86_64`,
  and `darwin-aarch64`

Open the draft, write user-facing release notes (this becomes the
`"notes"` field shown in the in-app update banner — see
[`RELEASING.md`](./RELEASING.md)), and click **Publish release**.

### 5. Done

The moment it's published,
`https://github.com/EcoHub-AG/standard-api-framework-app/releases/latest/download/latest.json`
starts serving the new manifest. Existing installs pick up the update
next time they open the app and check.

## If something goes wrong

- **Windows job fails at `azure/login`** — `AZURE_CREDENTIALS` is
  missing, still a placeholder, or the service principal lost its Key
  Vault sign permission.
- **Windows job fails inside `scripts/sign.cmd`** — same causes as the
  manual build; see
  [`WINDOWS_BUILD_SETUP.md`](./WINDOWS_BUILD_SETUP.md#troubleshooting).
- **"Signature invalid" on install (either platform)** — the build
  wasn't signed with the `updater.key` whose public half is embedded
  in `tauri.conf.json` (`plugins.updater.pubkey`); check
  `TAURI_SIGNING_PRIVATE_KEY` is the current key, not a stale/placeholder
  value.
- **Update banner never appears after publishing** — check the release's
  `latest.json` has all three platform keys, and that the tag matches
  `tauri.conf.json`'s `version`.
- **macOS users report a Gatekeeper block that isn't the normal
  "right-click Open" warning** — the build genuinely isn't signed by
  design (see above); a hard block usually means Gatekeeper's stricter
  outside that flow, worth a fresh look at whether Apple signing should
  be added back.
