# Build a SIGNED Windows installer (.exe) for the Delphic Secure Client
# Connector. Run on Windows with Python, Inno Setup (iscc), and a code-signing
# certificate. Turns "download a script" into a signed native installer.
#
# Required env for signing:
#   $env:SIGN_CERT   = path to your .pfx code-signing cert
#   $env:SIGN_PASS   = cert password
#
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$Version = if ($env:VERSION) { $env:VERSION } else { "1.0.0" }

Write-Host "> Installing build deps"
python -m pip install -q -r requirements-build.txt

Write-Host "> Building EXE with PyInstaller"
pyinstaller --noconfirm aavishield-connector.spec

$exe = "dist\DelphicSecureConnector.exe"

if ($env:SIGN_CERT) {
    Write-Host "> Code-signing the EXE"
    signtool sign /f $env:SIGN_CERT /p $env:SIGN_PASS /tr http://timestamp.digicert.com /td sha256 /fd sha256 $exe
} else {
    Write-Warning "SIGN_CERT not set - producing an UNSIGNED build (SmartScreen will warn)."
}

Write-Host "> Building installer with Inno Setup"
# installer.iss registers AavishieldAgent as a Windows service + imports the CA.
iscc /DMyAppVersion=$Version installer.iss

if ($env:SIGN_CERT) {
    Write-Host "> Signing the installer"
    signtool sign /f $env:SIGN_CERT /p $env:SIGN_PASS /tr http://timestamp.digicert.com /td sha256 /fd sha256 "Output\DelphicSecureConnector-$Version-Setup.exe"
}

Write-Host "Built Output\DelphicSecureConnector-$Version-Setup.exe"
