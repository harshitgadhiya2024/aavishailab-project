<#
Builds a Windows .msi installer for the Aavishield agent.

    powershell -ExecutionPolicy Bypass -File packaging\windows\build.ps1 -Version 1.1.0

Requires WiX Toolset v3 (candle.exe / light.exe) on PATH.

Signing is opt-in. Without a certificate the build still produces a working
(unsigned) .msi for internal testing, but SmartScreen will warn every employee
who runs it, so release builds must set:

    $env:SIGNING_CERT_THUMBPRINT = "abc123..."   # cert in the machine store, or
    $env:SIGNING_CERT_PFX        = "C:\certs\aavishield.pfx"
    $env:SIGNING_CERT_PASSWORD   = "..."
#>
param(
    [string]$Version = "1.1.0"
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
$BuildDir = Join-Path $RepoRoot "build\windows"
$OutDir   = Join-Path $RepoRoot "dist"

# Which deployment this build belongs to. Baked into the binary because the
# package is generic — with no employee-specific token to carry an admin URL,
# the agent has to already know where to enrol and which portal to open.
$AdminUrl  = if ($env:AAVISHIELD_ADMIN_URL)  { $env:AAVISHIELD_ADMIN_URL }  else { "https://aavishield-api.aavishailab.com" }
$PortalUrl = if ($env:AAVISHIELD_PORTAL_URL) { $env:AAVISHIELD_PORTAL_URL } else { "https://aavishield-employee.aavishailab.com" }

Write-Host "==> Building Aavishield agent $Version for Windows"
Write-Host "    admin:  $AdminUrl"
Write-Host "    portal: $PortalUrl"

Remove-Item -Recurse -Force $BuildDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $BuildDir, $OutDir, "$BuildDir\src" | Out-Null

# ─── 1. Freeze the agent ──────────────────────────────────────────────────────
# The deployment URLs are stamped into a scratch copy rather than the tracked
# source, so a build never leaves the working tree modified.
$StampedSrc = "$BuildDir\src\aavishield-agent.py"
Copy-Item "$RepoRoot\scripts\agent\aavishield-agent.py" $StampedSrc

$Source = Get-Content $StampedSrc -Raw
# AGENT_VERSION is stamped too — see the macOS build script for why (it's what
# the app and the device record report, and was stuck at the source default).
foreach ($pair in @(@("DEFAULT_ADMIN_URL", $AdminUrl), @("DEFAULT_PORTAL_URL", $PortalUrl), @("AGENT_VERSION", $Version))) {
    # Anchored to the constant's own name at the start of a line, so exactly
    # one line can match and no occurrence count is needed. (The static
    # Regex.Replace has no count overload — a 4th argument would be read as
    # RegexOptions, quietly turning "replace once" into "ignore case".)
    $pattern = "(?m)^$($pair[0])\s*=\s*"".*""\r?$"
    if ($Source -notmatch $pattern) {
        throw "could not stamp $($pair[0]) — the agent's constants moved"
    }
    # MatchEvaluator rather than a replacement string: a literal URL is not a
    # substitution pattern, and '$' in one must not be reinterpreted.
    $replacement = "$($pair[0])  = ""$($pair[1])"""
    $Source = [regex]::Replace($Source, $pattern, { param($m) $replacement }.GetNewClosure())
}
Set-Content -Path $StampedSrc -Value $Source -Encoding UTF8 -NoNewline

Write-Host "==> Freezing agent with PyInstaller"
Push-Location $RepoRoot
$env:AAVISHIELD_AGENT_SRC = $StampedSrc
python -m PyInstaller --clean --noconfirm `
    --distpath "$BuildDir\dist" --workpath "$BuildDir\work" `
    packaging\aavishield-agent.spec
Remove-Item Env:\AAVISHIELD_AGENT_SRC
Pop-Location

$AgentExe = "$BuildDir\dist\aavishield-agent.exe"
if (-not (Test-Path $AgentExe)) { throw "PyInstaller did not produce $AgentExe" }

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
# silently:  msiexec /i aavishield-agent.msi /qn TOKEN=dse_... ADMINURL=https://...
# They are written to enroll.json, which the agent consumes on first run.
$Wxs = @"
<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi" xmlns:util="http://schemas.microsoft.com/wix/UtilExtension">
  <Product Id="*" Name="Aavishield Agent" Language="1033" Version="$Version"
           Manufacturer="Aavishield" UpgradeCode="6E9F3C2A-6F1B-4E52-9F1D-2C7A1B4D8E30">
    <Package InstallerVersion="500" Compressed="yes" InstallScope="perMachine"
             Description="Aavishield security agent" />
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
             so it belongs in the user session rather than as a SYSTEM service. -->
        <RegistryValue Root="HKLM"
                       Key="Software\Microsoft\Windows\CurrentVersion\Run"
                       Name="AavishieldAgent" Type="string"
                       Value="&quot;[INSTALLFOLDER]aavishield-agent.exe&quot;" />
      </Component>
    </DirectoryRef>

    <!-- Program Files is Administrators/SYSTEM-write by default, but the
         agent runs as the unprivileged logged-in user (see AgentExe's Run
         key above) and AutoUpdater._download_and_swap() replaces its own
         .exe in place — on a standard (non-admin) corporate account, the
         overwhelmingly common case, that write would fail silently and
         auto-update would never actually work. Grant the interactive Users
         group write access to just this folder so self-update can succeed
         without loosening anything else under Program Files. -->
    <DirectoryRef Id="INSTALLFOLDER">
      <!-- Explicit GUID, not "*": WiX won't auto-generate one for a component
           whose keypath is a Directory (this one has no File, just
           CreateFolder — LGHT0230 if left as "*"). -->
      <Component Id="AgentExePermissions" Guid="6EA3354E-DC3E-4F02-90D5-18DC4515BEAE">
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

    <Feature Id="Main" Title="Aavishield Agent" Level="1">
      <ComponentRef Id="AgentExe" />
      <ComponentRef Id="AgentExePermissions" />
      <ComponentRef Id="EnrollDrop" />
    </Feature>

    <!-- Writes the enrollment drop when TOKEN was supplied on the command line. -->
    <CustomAction Id="WriteEnrollJson" Directory="DATAFOLDER"
                  ExeCommand='cmd.exe /c echo {"token":"[TOKEN]","admin_url":"[ADMINURL]"} &gt; "[DATAFOLDER]enroll.json"'
                  Execute="deferred" Impersonate="no" Return="ignore" />

    <!-- CA trust helper. The agent itself runs from the HKLM Run key, i.e. as
         the logged-in user with no elevation, so it can neither write to the
         machine Root store nor honestly report whether the CA is trusted. A
         SYSTEM scheduled task is the counterpart to the LaunchDaemon on macOS
         and the systemd system unit on Linux.

         It cannot run its job at install time — nobody has enrolled yet, so
         there are no credentials to fetch the CA with — hence a task that
         starts with the machine and polls, rather than a one-shot action. -->
    <CustomAction Id="CreateCaTrustTask" Directory="INSTALLFOLDER"
                  ExeCommand='cmd.exe /c schtasks /Create /F /RU SYSTEM /RL HIGHEST /SC ONSTART /TN "AavishieldCaTrust" /TR "\"[INSTALLFOLDER]aavishield-agent.exe\" --ca-trust-daemon"'
                  Execute="deferred" Impersonate="no" Return="ignore" />
    <!-- Start it now too: waiting for the next reboot would leave HTTPS
         blind-tunnelled, and the block page unreachable, until then. -->
    <CustomAction Id="StartCaTrustTask" Directory="INSTALLFOLDER"
                  ExeCommand='cmd.exe /c schtasks /Run /TN "AavishieldCaTrust"'
                  Execute="deferred" Impersonate="no" Return="ignore" />
    <!-- Removed before the certificate is, or it would reinstall the CA it
         just watched disappear. -->
    <CustomAction Id="RemoveCaTrustTask" Directory="INSTALLFOLDER"
                  ExeCommand='cmd.exe /c schtasks /Delete /F /TN "AavishieldCaTrust"'
                  Execute="deferred" Impersonate="no" Return="ignore" />
    <CustomAction Id="RemoveCaCert" Directory="INSTALLFOLDER"
                  ExeCommand='cmd.exe /c certutil -delstore Root "Aavishield SSL Inspection CA" &amp; del /q "%ProgramData%\Aavishield\ca-trusted"'
                  Execute="deferred" Impersonate="no" Return="ignore" />

    <InstallExecuteSequence>
      <Custom Action="WriteEnrollJson"    After="InstallFiles">TOKEN</Custom>
      <Custom Action="CreateCaTrustTask"  After="InstallFiles">NOT Installed</Custom>
      <Custom Action="StartCaTrustTask"   After="CreateCaTrustTask">NOT Installed</Custom>
      <Custom Action="RemoveCaTrustTask"  Before="RemoveFiles">REMOVE~="ALL"</Custom>
      <Custom Action="RemoveCaCert"       After="RemoveCaTrustTask">REMOVE~="ALL"</Custom>
    </InstallExecuteSequence>
  </Product>
</Wix>
"@

$WxsPath = "$BuildDir\aavishield.wxs"
Set-Content -Path $WxsPath -Value $Wxs -Encoding UTF8

# ─── 4. Build the MSI ─────────────────────────────────────────────────────────
Write-Host "==> candle / light"
# -ext WixUtilExtension: needed for util:PermissionEx (the AgentExePermissions
# component above) — ships with the core WiX v3 toolset, no separate install.
# External .exe failures don't throw in PowerShell on their own (unlike
# cmdlets, even under $ErrorActionPreference = "Stop") — check $LASTEXITCODE
# explicitly so a WiX compile error fails here, not as a confusing
# Resolve-Path error three steps later when the .msi never got built.
& candle.exe -nologo -ext WixUtilExtension -out "$BuildDir\aavishield.wixobj" $WxsPath
if ($LASTEXITCODE -ne 0) { throw "candle.exe failed with exit code $LASTEXITCODE" }
$MsiOut = Join-Path $OutDir "aavishield-agent-$Version.msi"
& light.exe -nologo -sval -ext WixUtilExtension -out $MsiOut "$BuildDir\aavishield.wixobj"
if ($LASTEXITCODE -ne 0) { throw "light.exe failed with exit code $LASTEXITCODE" }

Invoke-Sign $MsiOut

Write-Host ""
Write-Host "Built: $MsiOut"
(Get-FileHash -Algorithm SHA256 $MsiOut).Hash.ToLower()
