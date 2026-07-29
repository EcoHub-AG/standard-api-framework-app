# Windows Build & Signing Setup (Fresh Machine)

This guide sets up a brand-new Windows machine so it can build and code-sign
the Standard API Framework Tauri app using the Azure Key Vault certificate.

Run all commands in an **elevated PowerShell** window (Run as Administrator)
unless noted otherwise.

## 1. Install Git

```powershell
winget install --id Git.Git -e
```

Verify:
```powershell
git --version
```

## 2. Install Node.js (LTS)

```powershell
winget install --id OpenJS.NodeJS.LTS -e
```

Verify:
```powershell
node -v
npm -v
```

## 3. Install Rust (required to compile the Tauri/Rust backend)

Download and run `rustup-init.exe`:

```powershell
winget install --id Rustlang.Rustup -e
```

After install, open a **new** terminal and verify:

```powershell
rustc --version
cargo --version
```

Make sure the default toolchain target is `x86_64-pc-windows-msvc` (not `-gnu`):

```powershell
rustup default stable-msvc
```

## 4. Install Visual Studio Build Tools (C++ workload)

Rust on Windows needs the MSVC linker. Install via winget:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

This step takes a while (several GB download). If you already have
Visual Studio 2022 installed with the "Desktop development with C++"
workload, you can skip this.

## 5. Install WebView2 Runtime

Usually already present on Windows 10/11. If missing:

```powershell
winget install --id Microsoft.EdgeWebView2Runtime -e
```

## 6. Install .NET SDK (needed for AzureSignTool)

```powershell
winget install --id Microsoft.DotNet.SDK.8 -e
```

Verify:
```powershell
dotnet --version
```

## 7. Install Azure CLI

```powershell
winget install --id Microsoft.AzureCLI -e
```

Verify:
```powershell
az --version
```

Log in (this opens a browser):

```powershell
az login
```

Confirm you're logged into the correct tenant/subscription (`EcoHub AG`):

```powershell
az account show
```

If it shows the wrong subscription:

```powershell
az account set --subscription "<subscription-id-or-name>"
```

## 8. Verify Key Vault access

Confirm your account has permission to read the certificate (needs
**Key Vault Certificate User** / **Key Vault Crypto User** role on the vault):

```powershell
az account get-access-token --resource https://vault.azure.net
```

This should print a token. If it errors with a permission/403 issue,
ask the Key Vault admin to grant your account access to
`ecohub-cert-premium-kv`.

## 9. Clone the project

```powershell
git clone <repo-url> standard-api-framework-app
cd standard-api-framework-app
```

## 10. Install project dependencies

```powershell
npm install
```

## 11. Run the build-and-sign script

```powershell
.\scripts\build-and-sign-windows.cmd
```

This will:
- Confirm you're logged into Azure CLI
- Fetch a short-lived Key Vault access token
- Install AzureSignTool if it's not already present
- Run `npm run tauri build`, which compiles the app and signs every
  binary/installer using the Azure Key Vault certificate

Output installers land in:

```
src-tauri\target\release\bundle\msi\
src-tauri\target\release\bundle\nsis\
```

## 12. Verify the signature (optional sanity check)

```powershell
Get-AuthenticodeSignature "src-tauri\target\release\bundle\nsis\Standard API Framework_0.1.0_x64-setup.exe" | Format-List Status, StatusMessage, SignerCertificate
```

`Status` should read `Valid`.

## Troubleshooting

- **`dotnet tool install` fails with a NuGet source error** — a machine-wide
  NuGet config may point at an unreachable private feed. The script already
  works around this by forcing `nuget.org` via `--add-source` +
  `--ignore-failed-sources`, so this should not require manual action.
- **`cargo build` fails linking** — usually means the MSVC Build Tools
  (step 4) or the C++ workload is missing.
- **`az account get-access-token` returns empty/errors** — you're not logged
  in, or logged into the wrong tenant. Re-run `az login`.
- **Signing fails with "certificate not found"** — check the `CERT_NAME`
  value in `scripts\build-and-sign-windows.cmd` matches the certificate name
  in the vault (`EcoHub-Code-Signing-CSR`), and confirm your account has
  Key Vault permissions (step 8).
