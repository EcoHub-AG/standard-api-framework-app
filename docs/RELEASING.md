# Publishing an Update

The app checks `https://github.com/mirsabbir/standard-api-framework-app/releases/latest/download/latest.json`
on startup (`src/components/UpdateBanner.tsx`) and, if it lists a newer
version, offers an in-app "Update & Restart" button. This is powered by
Tauri's `updater` plugin (`src-tauri/tauri.conf.json` → `plugins.updater`).

## One-time setup (already done)

- `src-tauri/updater.key` / `updater.key.pub` — the update-signing keypair
  (`npx tauri signer generate`). The private key is **git-ignored** — keep
  a copy somewhere safe (password manager, secrets vault). Losing it means
  future updates can never be verified by apps already in the field; you'd
  have to ship a new pubkey via a fresh manual install.
- The public key is embedded in `tauri.conf.json` (`plugins.updater.pubkey`).

## Every release

1. Bump `version` in both `src-tauri/tauri.conf.json` and `package.json`.
2. Before building, point the build at the private signing key so Tauri
   signs the update artifacts:

   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw src-tauri\updater.key
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
   ```

   (bash equivalent: `export TAURI_SIGNING_PRIVATE_KEY=$(cat src-tauri/updater.key)`)

3. Run the existing platform build script as usual
   (`scripts\build-and-sign-windows.cmd` / `scripts/build-and-sign-macos.command`).
   Because `bundle.createUpdaterArtifacts` is `true`, this also produces
   `*.sig` signature files and a `latest.json` manifest alongside the
   installers in `src-tauri/target/release/bundle/`.
4. Each platform build produces its own `latest.json`, only describing
   that platform. Since Windows and macOS are built on separate machines,
   merge the `platforms` object from both into a single `latest.json`
   before uploading (same `version`/`notes`, combined `platforms` keys:
   `windows-x86_64`, `darwin-x86_64`, `darwin-aarch64`, etc.).
5. Create a new GitHub Release tagged `vX.Y.Z` and upload the installers
   + their `.sig` files for every platform, plus the single merged
   `latest.json`. Tauri's updater reads it from that release's assets via
   the `.../releases/latest/download/latest.json` URL configured above.
6. Publish the release. Existing installs will pick up the update next
   time they check.
