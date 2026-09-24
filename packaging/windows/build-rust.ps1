<#
Builds a Windows .msi installer for the Rust Aavishield connector
(services/endpoint-agent). A sibling to build.ps1, which does the same for
the Python connector — see packaging/macos/build-rust.sh's header for why
this is a separate script rather than one shared with a language flag.

    powershell -ExecutionPolicy Bypass -File packaging\windows\build-rust.ps1 -Version 1.0.0

Requires a Rust toolchain and WiX Toolset v3 (candle.exe / light.exe) on
PATH. Unlike build.ps1 there is no PyInstaller freeze step — this compiles
the connector directly.

**UNVERIFIED.** This script, and the CA-trust-less WiX source it writes
below, have never been run — there is no Windows machine, and no way to
even dry-compile a .wxs with candle.exe, anywhere this was written. It is
translated in good faith from build.ps1, which HAS been used to produce a
real signed .msi, keeping every piece that still applies unchanged (the
Run-key startup, the INSTALLFOLDER write-permission grant for self-update,
the TOKEN/ADMINURL enrollment properties) and dropping only what the Rust
connector genuinely doesn't do yet (installing the CA into the machine
trust store — see uninstall.rs's and the top-level README's Scope notes).
Treat every line here as "written, not proven" until it has actually built
and installed on a real Windows box, the same standard this project holds
every other never-tested Windows/macOS path to.

Signing is opt-in, identical contract to build.ps1:

    $env:SIGNING_CERT_THUMBPRINT = "abc123..."   # cert in the machine store, or
    $env:SIGNING_CERT_PFX        = "C:\certs\aavishield.pfx"
    $env:SIGNING_CERT_PASSWORD   = "..."
#>
param(
    [string]$Version = "1.0.0"
)

$ErrorActionPreference = "Stop"

$RepoRoot  = (Resolve-Path "$PSScriptRoot\..\..").Path
$AgentDir  = Join-Path $RepoRoot "services\endpoint-agent"
$BuildDir  = Join-Path $RepoRoot "build\windows-rust"
$OutDir    = Join-Path $RepoRoot "dist"

$AdminUrl  = if ($env:AAVISHIELD_ADMIN_URL)  { $env:AAVISHIELD_ADMIN_URL }  else { "https://aavishield-api.aavishailab.com" }
$PortalUrl = if ($env:AAVISHIELD_PORTAL_URL) { $env:AAVISHIELD_PORTAL_URL } else { "https://aavishield-employee.aavishailab.com" }

Write-Host "==> Building Aavishield Rust connector $Version for Windows"
Write-Host "    admin:  $AdminUrl"
Write-Host "    portal: $PortalUrl"

Remove-Item -Recurse -Force $BuildDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $BuildDir, $OutDir | Out-Null

# ─── 1. Build the agent ───────────────────────────────────────────────────────
Write-Host "==> cargo build --release"
Push-Location $AgentDir
& cargo build --release
if ($LASTEXITCODE -ne 0) { throw "cargo build failed with exit code $LASTEXITCODE" }
Pop-Location

$AgentExe = "$AgentDir\target\release\aavishield-agent.exe"
if (-not (Test-Path $AgentExe)) { throw "cargo build did not produce $AgentExe" }

# ─── 2. Sign the binary ───────────────────────────────────────────────────────
function Invoke-Sign([string]$Path) {
    if ($env:SIGNING_CERT_THUMBPRINT) {
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
# silently: msiexec /i aavishield-agent-rust.msi /qn TOKEN=dse_... ADMINURL=https://...
# They are written to enroll.json at C:\ProgramData\Aavishield\enroll.json —
# config::enroll_drop_paths() already checks that exact path (see config.rs),
# so this needs no counterpart change on the connector side; the mechanism
# was verified this session against a real server, just via the env-var half
# of it (AAVISHIELD_ENROLL_TOKEN), not this drop-file half.
$Wxs = @"
<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi" xmlns:util="http://schemas.microsoft.com/wix/UtilExtension">
  <Product Id="*" Name="Aavishield Agent (Rust)" Language="1033" Version="$Version"
           Manufacturer="Aavishield" UpgradeCode="9B3E5C2A-1F4B-4E52-8F1D-2C7A1B4D9F41">
    <Package InstallerVersion="500" Compressed="yes" InstallScope="perMachine"
             Description="Aavishield security agent (Rust connector)" />
    <MajorUpgrade DowngradeErrorMessage="A newer version of the Aavishield Agent is already installed." />
    <MediaTemplate EmbedCab="yes" />

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
      <Component Id="AgentExe" Guid="*">
        <File Id="AavishieldAgentExe" Source="$AgentExe" KeyPath="yes" />
        <!-- Runs at logon: the agent manages the current user's proxy settings,
             so it belongs in the user session rather than as a SYSTEM service —
             identical reasoning to build.ps1's Python build. -->
        <RegistryValue Root="HKLM"
                       Key="Software\Microsoft\Windows\CurrentVersion\Run"
                       Name="AavishieldAgent" Type="string"
                       Value="&quot;[INSTALLFOLDER]aavishield-agent.exe&quot;" />
      </Component>
    </DirectoryRef>

    <!-- Same self-update write-permission grant build.ps1's Python build
         needs, for the identical reason: update.rs's download_and_swap()
         replaces its own .exe in place, and Program Files is
         Administrators/SYSTEM-write by default. -->
    <DirectoryRef Id="INSTALLFOLDER">
      <Component Id="AgentExePermissions" Guid="4F8A2D1C-9B3E-4A05-B6E7-3D8F5C2A1B90">
        <CreateFolder>
          <util:PermissionEx User="Users" GenericRead="yes" GenericExecute="yes"
                              GenericWrite="yes" Delete="yes" />
        </CreateFolder>
      </Component>
    </DirectoryRef>

    <DirectoryRef Id="DATAFOLDER">
      <Component Id="EnrollDrop" Guid="*">
        <CreateFolder />
        <RemoveFile Id="RemoveEnrollJson" Name="enroll.json" On="uninstall" />
        <RegistryValue Root="HKLM" Key="Software\Aavishield" Name="Installed"
                       Type="integer" Value="1" KeyPath="yes" />
      </Component>
    </DirectoryRef>

    <Feature Id="Main" Title="Aavishield Agent (Rust)" Level="1">
      <ComponentRef Id="AgentExe" />
      <ComponentRef Id="AgentExePermissions" />
      <ComponentRef Id="EnrollDrop" />
    </Feature>

    <!-- Writes the enrollment drop when TOKEN was supplied on the command line. -->
    <CustomAction Id="WriteEnrollJson" Directory="DATAFOLDER"
                  ExeCommand='cmd.exe /c echo {"token":"[TOKEN]","admin_url":"[ADMINURL]"} &gt; "[DATAFOLDER]enroll.json"'
                  Execute="deferred" Impersonate="no" Return="ignore" />

    <!-- No CA-trust scheduled task here, unlike build.ps1's Python build:
         the Rust connector only checks whether the CA is trusted
         (config::mitm_ca_trusted) — it doesn't install it into the machine
         Root store yet. Shipping the SYSTEM task that build.ps1 creates
         would silently do nothing but burn a scheduled-task slot, which is
         worse than honestly omitting it. Restore this block (copy it from
         build.ps1's CreateCaTrustTask/StartCaTrustTask/RemoveCaTrustTask/
         RemoveCaCert custom actions) the moment CA installation is ported. -->

    <InstallExecuteSequence>
      <Custom Action="WriteEnrollJson" After="InstallFiles">TOKEN</Custom>
    </InstallExecuteSequence>
  </Product>
</Wix>
"@

$WxsPath = "$BuildDir\aavishield-rust.wxs"
Set-Content -Path $WxsPath -Value $Wxs -Encoding UTF8

# ─── 4. Build the MSI ─────────────────────────────────────────────────────────
Write-Host "==> candle / light"
& candle.exe -nologo -ext WixUtilExtension -out "$BuildDir\aavishield-rust.wixobj" $WxsPath
if ($LASTEXITCODE -ne 0) { throw "candle.exe failed with exit code $LASTEXITCODE" }
$MsiOut = Join-Path $OutDir "aavishield-agent-rust-$Version.msi"
& light.exe -nologo -sval -ext WixUtilExtension -out $MsiOut "$BuildDir\aavishield-rust.wixobj"
if ($LASTEXITCODE -ne 0) { throw "light.exe failed with exit code $LASTEXITCODE" }

Invoke-Sign $MsiOut

Write-Host ""
Write-Host "Built: $MsiOut"
(Get-FileHash -Algorithm SHA256 $MsiOut).Hash.ToLower()
