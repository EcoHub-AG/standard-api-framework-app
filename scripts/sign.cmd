@echo off
azuresigntool sign --azure-key-vault-url=%KEYVAULT_URL% --azure-key-vault-accesstoken=%AZURE_ACCESS_TOKEN% --azure-key-vault-certificate=%CERT_NAME% --timestamp-rfc3161=%TIMESTAMP_URL% --timestamp-digest=sha256 --file-digest=sha256 %1
