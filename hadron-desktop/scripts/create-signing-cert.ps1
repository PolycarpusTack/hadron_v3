# create-signing-cert.ps1
# Creates a self-signed code signing certificate for Hadron Desktop.
# Run this ONCE on the build machine (requires Administrator privileges).
#
# After creation:
#   - The cert is stored in the Windows Certificate Store (CurrentUser\My)
#   - A .pfx file is exported to hadron-desktop/certs/ for CI/backup
#   - A .cer file is exported for deployment to client machines via Group Policy
#
# For client machines to trust the signature, deploy the .cer file via:
#   Group Policy > Computer Configuration > Windows Settings >
#   Security Settings > Public Key Policies > Trusted Publishers
#
# Usage: Run as Administrator in PowerShell
#   .\scripts\create-signing-cert.ps1

param(
    [string]$CertName = "Hadron Desktop Code Signing",
    [string]$Password = "",
    [int]$ValidYears = 3
)

$ErrorActionPreference = "Stop"

# Prompt for PFX password if not provided
if (-not $Password) {
    $securePass = Read-Host "Enter password for .pfx export" -AsSecureString
} else {
    $securePass = ConvertTo-SecureString $Password -AsPlainText -Force
}

$certsDir = Join-Path $PSScriptRoot "..\certs"
if (-not (Test-Path $certsDir)) {
    New-Item -ItemType Directory -Path $certsDir -Force | Out-Null
}

$pfxPath = Join-Path $certsDir "hadron-signing.pfx"
$cerPath = Join-Path $certsDir "hadron-signing.cer"

# Check if cert already exists
$existing = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -like "*$CertName*" }
if ($existing) {
    Write-Host "Certificate already exists:" -ForegroundColor Yellow
    Write-Host "  Subject: $($existing.Subject)"
    Write-Host "  Thumbprint: $($existing.Thumbprint)"
    Write-Host "  Expires: $($existing.NotAfter)"
    $overwrite = Read-Host "Overwrite? (y/N)"
    if ($overwrite -ne "y") {
        Write-Host "Aborted." -ForegroundColor Red
        exit 0
    }
    Remove-Item "Cert:\CurrentUser\My\$($existing.Thumbprint)" -Force
}

Write-Host "`nCreating self-signed code signing certificate..." -ForegroundColor Cyan

$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject "CN=$CertName, O=Hadron Team, L=Internal" `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -NotAfter (Get-Date).AddYears($ValidYears) `
    -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")

Write-Host "Certificate created." -ForegroundColor Green
Write-Host "  Thumbprint: $($cert.Thumbprint)"
Write-Host "  Expires: $($cert.NotAfter)"

# Export .pfx (private key, for signing)
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePass | Out-Null
Write-Host "`nExported PFX (for build machine): $pfxPath" -ForegroundColor Green

# Export .cer (public key only, for client deployment)
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null
Write-Host "Exported CER (for Group Policy): $cerPath" -ForegroundColor Green

# Print environment variables needed for Tauri signing
Write-Host "`n=== Tauri Build Configuration ===" -ForegroundColor Cyan
Write-Host "Set these environment variables before running 'cargo tauri build':"
Write-Host ""
Write-Host "  `$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '<your-pfx-password>'" -ForegroundColor Yellow
Write-Host ""
Write-Host "Or use signtool directly by setting in tauri.conf.json:" -ForegroundColor Yellow
Write-Host "  bundle.windows.signCommand = `"signtool sign /fd SHA256 /a /f certs/hadron-signing.pfx /p <password> `"%1`"`""

Write-Host "`n=== Client Deployment ===" -ForegroundColor Cyan
Write-Host "To trust this certificate on corporate machines:"
Write-Host "  1. Deploy '$cerPath' via Group Policy to:"
Write-Host "     Computer Config > Windows Settings > Security Settings >"
Write-Host "     Public Key Policies > Trusted Publishers"
Write-Host "  2. Also add to 'Trusted Root Certification Authorities' if needed"
Write-Host ""
Write-Host "Thumbprint (for reference): $($cert.Thumbprint)" -ForegroundColor Green
