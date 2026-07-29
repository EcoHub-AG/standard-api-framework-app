@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM Config - fill these in with your Key Vault details
REM ============================================================
set KEYVAULT_URL=https://ecohub-cert-premium-kv.vault.azure.net/
set CERT_NAME=EcoHub-Code-Signing-CSR
set TIMESTAMP_URL=http://rfc3161timestamp.globalsign.com/advanced

REM ============================================================
REM 1. Verify Azure CLI login
REM ============================================================
echo [INFO] Checking Azure CLI login...
call az account show >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Not logged in to Azure CLI. Run "az login" first.
    pause
    exit /b 1
)

REM ============================================================
REM 2. Fetch a short-lived access token scoped to Key Vault
REM ============================================================
for /f "delims=" %%T in ('call az account get-access-token --resource https://vault.azure.net --query accessToken -o tsv') do set AZURE_ACCESS_TOKEN=%%T

if "%AZURE_ACCESS_TOKEN%"=="" (
    echo [ERROR] Failed to acquire access token.
    pause
    exit /b 1
)

echo [OK] Access token acquired.

REM ============================================================
REM 3. Ensure AzureSignTool is installed
REM ============================================================
where azuresigntool >nul 2>&1
if errorlevel 1 (
    echo [INFO] Installing AzureSignTool...
    dotnet tool install --global AzureSignTool --add-source https://api.nuget.org/v3/index.json --ignore-failed-sources
    if errorlevel 1 (
        echo [ERROR] Failed to install AzureSignTool.
        pause
        exit /b 1
    )
)

REM ============================================================
REM 4. Build and sign via Tauri
REM ============================================================
echo [INFO] Building and signing Windows bundle...
call npm run tauri build

if errorlevel 1 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
)

echo [OK] Build complete. Installers are in src-tauri\target\release\bundle\
pause
endlocal
