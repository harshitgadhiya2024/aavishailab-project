<#
Builds a Windows .msi installer for the Rust Aavishield connector
(services/endpoint-agent). It replaced build.ps1, the removed Python
connector's builder — every "build.ps1" mention below points at that script
in git history.

    powershell -ExecutionPolicy Bypass -File packaging\windows\build-rust.ps1 -Version 1.0.0

Requires a Rust toolchain and WiX Toolset v3 (candle.exe / light.exe) on
PATH. Unlike build.ps1 there is no PyInstaller freeze step — this compiles
the connector directly.

Verified 2026-10-29 on Windows 11 (25H2, ARM64): this script built the
.msi with WiX 3.14, and it installed fresh, upgraded 2.9.5 in place and
uninstalled cleanly. See docs/windows-test-checklist.md, fix 7, for what
the package sets up (the Aavishield service, ACLs, cleanup on removal).

To package a cross-compiled exe on a Windows box without Rust:

    build-rust.ps1 -Version 2.9.7 -PrebuiltExe path\to\aavishield-agent.exe

Signing is opt-in, identical contract to build.ps1:

    $env:SIGNING_CERT_THUMBPRINT = "abc123..."   # cert in the machine store, or
    $env:SIGNING_CERT_PFX        = "C:\certs\aavishield.pfx"
    $env:SIGNING_CERT_PASSWORD   = "..."

or SSL.com eSigner cloud signing (the key never leaves SSL.com), via an
unpacked CodeSignTool:

    $env:CODESIGNTOOL_DIR        = "C:\tools\CodeSignTool"
    $env:ESIGNER_USERNAME        = "..."
    $env:ESIGNER_PASSWORD        = "..."
    $env:ESIGNER_CREDENTIAL_ID   = "..."
    $env:ESIGNER_TOTP_SECRET     = "..."
#>
param(
    [string]$Version = "1.0.0",
    # Package an already-built aavishield-agent.exe instead of running cargo
    # (for testing a cross-compiled build on a Windows machine).
    [string]$PrebuiltExe = ""
)

$ErrorActionPreference = "Stop"

$RepoRoot  = (Resolve-Path "$PSScriptRoot\..\..").Path
$AgentDir  = Join-Path $RepoRoot "services\endpoint-agent"
$BuildDir  = Join-Path $RepoRoot "build\windows-rust"
$OutDir    = Join-Path $RepoRoot "dist"

$AdminUrl  = if ($env:AAVISHIELD_ADMIN_URL)  { $env:AAVISHIELD_ADMIN_URL }  else { "https://api.aavishield.com" }
$PortalUrl = if ($env:AAVISHIELD_PORTAL_URL) { $env:AAVISHIELD_PORTAL_URL } else { "https://employee.aavishield.com" }

Write-Host "==> Building Aavishield Rust connector $Version for Windows"
Write-Host "    admin:  $AdminUrl"
Write-Host "    portal: $PortalUrl"

Remove-Item -Recurse -Force $BuildDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $BuildDir, $OutDir | Out-Null

# ─── 1. Build the agent ───────────────────────────────────────────────────────
# AAVISHIELD_VERSION stamps into the binary via build.rs (see its own doc
# comment) — without this, config::AGENT_VERSION falls back to a fixed dev
# string that would make update.rs think an update is *always* available
# and loop forever redownloading itself, since the fallback never equals
# whatever version the manifest actually advertises.
if ($PrebuiltExe) {
    $AgentExe = (Resolve-Path $PrebuiltExe).Path
    Write-Host "==> Using prebuilt $AgentExe"
} else {
Write-Host "==> cargo build --release"
Push-Location $AgentDir
$env:AAVISHIELD_VERSION = $Version
try {
    & cargo build --release
    if ($LASTEXITCODE -ne 0) { throw "cargo build failed with exit code $LASTEXITCODE" }
} finally {
    Remove-Item Env:\AAVISHIELD_VERSION
    Pop-Location
}

$AgentExe = "$AgentDir\target\release\aavishield-agent.exe"
if (-not (Test-Path $AgentExe)) { throw "cargo build did not produce $AgentExe" }
}

# ─── 2. Sign the binary ───────────────────────────────────────────────────────
function Invoke-Sign([string]$Path) {
    if ($env:ESIGNER_USERNAME) {
        Write-Host "==> Signing $Path (SSL.com eSigner)"
        # CodeSignTool reads conf\code_sign_tool.properties relative to the
        # current directory, so it has to run from its own folder.
        Push-Location $env:CODESIGNTOOL_DIR
        try {
            $out = & java -jar (Get-ChildItem jar\code_sign_tool-*.jar | Select-Object -First 1).FullName sign `
                "-username=$env:ESIGNER_USERNAME" "-password=$env:ESIGNER_PASSWORD" `
                "-credential_id=$env:ESIGNER_CREDENTIAL_ID" "-totp_secret=$env:ESIGNER_TOTP_SECRET" `
                "-input_file_path=$Path" -override 2>&1 | Out-String
        } finally {
            Pop-Location
        }
        Write-Host $out
        # Its exit code isn't reliable on failure; the success line is.
        if ($LASTEXITCODE -ne 0 -or $out -notmatch "Code signed successfully") {
            throw "eSigner signing failed for $Path"
        }
    } elseif ($env:SIGNING_CERT_THUMBPRINT) {
        Write-Host "==> Signing $Path (thumbprint)"
        & signtool sign /sha1 $env:SIGNING_CERT_THUMBPRINT /fd SHA256 `
            /tr http://timestamp.digicert.com /td SHA256 $Path
    } elseif ($env:SIGNING_CERT_PFX) {
        Write-Host "==> Signing $Path (pfx)"
        & signtool sign /f $env:SIGNING_CERT_PFX /p $env:SIGNING_CERT_PASSWORD /fd SHA256 `
            /tr http://timestamp.digicert.com /td SHA256 $Path
    } else {
        Write-Host "==> No signing cert configured — leaving $Path UNSIGNED (testing only)"
    }
}
Invoke-Sign $AgentExe

# ─── 3. WiX source ────────────────────────────────────────────────────────────
# TOKEN and ADMINURL are optional MSI properties so an MDM push can enroll
# silently: msiexec /i aavishield-agent.msi /qn TOKEN=dse_... ADMINURL=https://...
# They are written to enroll.json at C:\ProgramData\Aavishield\enroll.json —
# config::enroll_drop_paths() already checks that exact path (see config.rs),
# so this needs no counterpart change on the connector side; the mechanism
# was verified this session against a real server, just via the env-var half
# of it (AAVISHIELD_ENROLL_TOKEN), not this drop-file half.
$Wxs = @"
<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi" xmlns:util="http://schemas.microsoft.com/wix/UtilExtension">
  <Product Id="*" Name="Aavishield Agent" Language="1033" Version="$Version"
           Manufacturer="Aavishield" UpgradeCode="9B3E5C2A-1F4B-4E52-8F1D-2C7A1B4D9F41">
    <!-- Platform x64: up to 2.9.5 this was a 32-bit package, so the 64-bit
         agent landed in Program Files (x86) and its Run key under
         WOW6432Node. MajorUpgrade still finds and removes those (same
         UpgradeCode). -->
    <Package InstallerVersion="500" Compressed="yes" InstallScope="perMachine" Platform="x64"
             Description="Aavishield security agent" />
    <!-- afterInstallInitialize: the old version is removed completely
         (service, files) before the new one is laid down, so no file is
         ever replaced while the old agent still holds it open. -->
    <MajorUpgrade Schedule="afterInstallInitialize"
                  DowngradeErrorMessage="A newer version of the Aavishield Agent is already installed." />
    <MediaTemplate EmbedCab="yes" />

    <!-- The Aavishield mark (packaging/icons/aavishield.ico, generated from
         the brand favicon by packaging/make-icons.py) as the icon shown in
         Settings > Apps and Programs and Features. The .exe carries the
         same icon itself via build.rs. -->
    <Icon Id="AavishieldIcon.ico" SourceFile="$RepoRoot\packaging\icons\aavishield.ico" />
    <Property Id="ARPPRODUCTICON" Value="AavishieldIcon.ico" />

    <Property Id="TOKEN" Secure="yes" />
    <Property Id="ADMINURL" Secure="yes" />

    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="ProgramFiles64Folder">
        <Directory Id="INSTALLFOLDER" Name="Aavishield" />
      </Directory>
      <Directory Id="CommonAppDataFolder">
        <Directory Id="DATAFOLDER" Name="Aavishield" />
      </Directory>
    </Directory>

    <DirectoryRef Id="INSTALLFOLDER">
      <Component Id="AgentExe" Guid="*" Win64="yes">
        <File Id="AavishieldAgentExe" Source="$AgentExe" KeyPath="yes" />
        <!-- The SYSTEM half of the agent (src/service.rs): starts the agent
             in every signed-in session and restarts it if it stops (there
             is no Run key any more; the service is the launcher), trusts
             the organisation's inspection CA machine-wide once someone
             enrolls, and installs updates. Program Files stays writable by
             administrators only: the service runs this file as SYSTEM. -->
        <ServiceInstall Id="AavishieldService" Name="AavishieldService" DisplayName="Aavishield"
                        Description="Keeps Aavishield protection running for everyone who signs in to this PC, and installs its updates."
                        Type="ownProcess" Start="auto" Account="LocalSystem" ErrorControl="normal"
                        Arguments="--service" Vital="yes">
          <util:ServiceConfig FirstFailureActionType="restart" SecondFailureActionType="restart"
                              ThirdFailureActionType="restart" RestartServiceDelayInSeconds="10" ResetPeriodInDays="1" />
        </ServiceInstall>
        <ServiceControl Id="AavishieldServiceControl" Name="AavishieldService" Start="install" Stop="both" Remove="uninstall" Wait="yes" />
      </Component>
      <!-- Shown on the agent's Windows notifications ("Download blocked"). -->
      <Component Id="AgentIcon" Guid="*" Win64="yes">
        <File Id="AavishieldIco" Source="$RepoRoot\packaging\icons\aavishield.ico" Name="aavishield.ico" KeyPath="yes" />
      </Component>
    </DirectoryRef>

    <DirectoryRef Id="DATAFOLDER">
      <Component Id="EnrollDrop" Guid="*" Win64="yes">
        <CreateFolder />
        <RemoveFile Id="RemoveEnrollJson" Name="enroll.json" On="uninstall" />
        <RegistryValue Root="HKLM" Key="Software\Aavishield" Name="Installed"
                       Type="integer" Value="1" KeyPath="yes" />
      </Component>
    </DirectoryRef>

    <Feature Id="Main" Title="Aavishield Agent" Level="1">
      <ComponentRef Id="AgentExe" />
      <ComponentRef Id="AgentIcon" />
      <ComponentRef Id="EnrollDrop" />
    </Feature>

    <!-- Writes the enrollment drop when TOKEN was supplied on the command line. -->
    <CustomAction Id="WriteEnrollJson" Directory="DATAFOLDER"
                  ExeCommand='cmd.exe /c echo {"token":"[TOKEN]","admin_url":"[ADMINURL]"} &gt; "[DATAFOLDER]enroll.json"'
                  Execute="deferred" Impersonate="no" Return="ignore" />

    <!-- Closes the agent in every user session so none of its files are in
         use: on install, on uninstall, and inside an upgrade, where the
         *old* package's copy of this action runs while it is being removed.
         It comes right after StopServices, so the service has already
         stopped and cannot start the agent again. Session 0 is skipped;
         that is the service itself, which Windows Installer stops. -->
    <CustomAction Id="StopAgents" Directory="TARGETDIR"
                  ExeCommand='taskkill.exe /F /IM aavishield-agent.exe /FI "SESSION ne 0"'
                  Execute="deferred" Impersonate="no" Return="ignore" />

    <!-- A real uninstall (not an upgrade): give every user a direct internet
         connection back, remove the CA the service trusted, report the
         removal to the company, and delete per-user enrollment so a
         reinstall starts clean. See service::uninstall_cleanup. -->
    <CustomAction Id="UninstallCleanup" FileKey="AavishieldAgentExe" ExeCommand="--uninstall-cleanup"
                  Execute="deferred" Impersonate="no" Return="ignore" />

    <InstallExecuteSequence>
      <Custom Action="StopAgents" After="StopServices" />
      <Custom Action="WriteEnrollJson" After="InstallFiles">TOKEN</Custom>
      <!-- REMOVE="ALL" AND NOT UPGRADINGPRODUCTCODE: a real uninstall only,
           never the remove-then-reinstall MajorUpgrade does internally when
           updating to a newer version — that must keep the existing
           enrollment, not silently disconnect the device on every update. -->
      <Custom Action="UninstallCleanup" After="StopAgents">REMOVE="ALL" AND NOT UPGRADINGPRODUCTCODE</Custom>
    </InstallExecuteSequence>
  </Product>
</Wix>
"@

$WxsPath = "$BuildDir\aavishield-rust.wxs"
Set-Content -Path $WxsPath -Value $Wxs -Encoding UTF8

# ─── 4. Build the MSI ─────────────────────────────────────────────────────────
Write-Host "==> candle / light"
& candle.exe -nologo -arch x64 -ext WixUtilExtension -out "$BuildDir\aavishield-rust.wixobj" $WxsPath
if ($LASTEXITCODE -ne 0) { throw "candle.exe failed with exit code $LASTEXITCODE" }
$MsiOut = Join-Path $OutDir "aavishield-agent-$Version.msi"
& light.exe -nologo -sval -ext WixUtilExtension -out $MsiOut "$BuildDir\aavishield-rust.wixobj"
if ($LASTEXITCODE -ne 0) { throw "light.exe failed with exit code $LASTEXITCODE" }

Invoke-Sign $MsiOut

Write-Host ""
Write-Host "Built: $MsiOut"
(Get-FileHash -Algorithm SHA256 $MsiOut).Hash.ToLower()
