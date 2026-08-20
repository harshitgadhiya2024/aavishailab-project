# ─────────────────────────────────────────────────────────────────────────────
# Aavishield Agent Installer — Windows (PowerShell 5.1+)
#
# Usage (run as Administrator in PowerShell):
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   .\install-windows.ps1 -EnrollmentToken "<TOKEN>"
#
# Environment overrides via env vars:
#   AAVISHIELD_ADMIN_URL, AAVISHIELD_SWG_HOST, AAVISHIELD_SWG_PORT
# ─────────────────────────────────────────────────────────────────────────────
param(
    [Parameter(Mandatory=$true)]
    [string]$EnrollmentToken,

    [string]$AdminUrl  = $(if ($env:AAVISHIELD_ADMIN_URL) { $env:AAVISHIELD_ADMIN_URL } else { "http://localhost:6000" }),
    [string]$SwgHost   = $(if ($env:AAVISHIELD_SWG_HOST) { $env:AAVISHIELD_SWG_HOST } else { "localhost" }),
    [int]   $SwgPort   = (if ($env:AAVISHIELD_SWG_PORT) { [int]$env:AAVISHIELD_SWG_PORT } else { 6080 })
)

$ErrorActionPreference = "Stop"
$LocalProxyPort = 6118
$InstallDir     = "$env:USERPROFILE\.aavishield"
$ConfigFile     = "$InstallDir\config.json"
$AgentScript    = "$InstallDir\aavishield-agent.py"
$LogFile        = "$InstallDir\agent.log"
$ServiceName    = "AavishieldAgent"
$TaskName       = "AavishieldAgent"

function Write-Step([string]$msg) { Write-Host "→ $msg" -ForegroundColor Cyan }
function Write-OK([string]$msg)   { Write-Host "✓ $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "! $msg" -ForegroundColor Yellow }
function Write-Fail([string]$msg) { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "🛡️  Aavishield Agent Installer — Windows" -ForegroundColor Blue -NoNewline
Write-Host ""
Write-Host "────────────────────────────────────────"

# ── Pre-flight ────────────────────────────────────────────────────────────────
try {
    $pythonBin = (Get-Command python -ErrorAction Stop).Source
} catch {
    Write-Fail "Python 3 is required. Download from https://www.python.org/downloads/windows/"
}

$pythonVersion = & $pythonBin --version 2>&1
Write-Step "Found Python: $pythonVersion"

# ── Create install directory ──────────────────────────────────────────────────
Write-Step "Creating install directory: $InstallDir"
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

# ── Gather device info ────────────────────────────────────────────────────────
$Hostname   = $env:COMPUTERNAME
$OsVersion  = (Get-WmiObject -Class Win32_OperatingSystem).Caption
$MacAddr    = (Get-NetAdapter | Where-Object {$_.Status -eq 'Up'} | Select-Object -First 1).MacAddress
$AgentVer   = "1.0.0"

Write-Step "Device: $Hostname  OS: $OsVersion"

# ── Enroll with admin API ─────────────────────────────────────────────────────
Write-Step "Enrolling device with Aavishield admin API…"

$EnrollBody = @{
    token         = $EnrollmentToken
    hostname      = $Hostname
    os_type       = "windows"
    os_version    = $OsVersion
    mac_address   = $MacAddr
    agent_version = $AgentVer
} | ConvertTo-Json -Compress

try {
    $Response = Invoke-RestMethod `
        -Uri    "$AdminUrl/internal/agent/enroll" `
        -Method POST `
        -Body   $EnrollBody `
        -ContentType "application/json"
} catch {
    Write-Fail "Enrollment failed: $($_.Exception.Message)"
}

$DeviceId   = $Response.device_id
$AgentKey   = $Response.agent_key
$OrgId      = $Response.org_id
$EmployeeId = $Response.employee_id
$SwgPortSrv = if ($Response.swg_port) { $Response.swg_port } else { $SwgPort }
$SwgPort    = $SwgPortSrv
# Server-provided SWG host wins unless the operator overrode it on the command line.
if (-not $env:AAVISHIELD_SWG_HOST -and $Response.swg_host) { $SwgHost = $Response.swg_host }
if ($SwgHost -eq "localhost" -or $SwgHost -eq "127.0.0.1") {
    Write-Warning "SWG host is '$SwgHost' — this points at THIS device, not your SWG server. Employees on other machines will not reach the SWG. Set SWG_PUBLIC_HOST on the admin server (or pass AAVISHIELD_SWG_HOST=<lan-ip>)."
}

if (-not $DeviceId -or -not $AgentKey) {
    Write-Fail "Enrollment response missing device_id or agent_key"
}
Write-OK "Device enrolled: $DeviceId"

# ── Save config ───────────────────────────────────────────────────────────────
Write-Step "Saving configuration…"
$Config = @{
    device_id     = $DeviceId
    agent_key     = $AgentKey
    org_id        = $OrgId
    employee_id   = $EmployeeId
    swg_host      = $SwgHost
    swg_port      = $SwgPort
    admin_url     = $AdminUrl
    local_port    = $LocalProxyPort
    hostname      = $Hostname
    os_type       = "windows"
    os_version    = $OsVersion
    agent_version = $AgentVer
    mitm_ca_installed = $false
}
$Config | ConvertTo-Json -Depth 3 | Set-Content -Path $ConfigFile -Encoding UTF8
Write-OK "Config saved to $ConfigFile"

# ── Install agent script ──────────────────────────────────────────────────────
Write-Step "Installing agent daemon script…"
$ScriptSource = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Definition) "aavishield-agent.py"
if (Test-Path $ScriptSource) {
    Copy-Item $ScriptSource $AgentScript -Force
} else {
    try {
        Invoke-WebRequest "$AdminUrl/agent/aavishield-agent.py" -OutFile $AgentScript
    } catch {
        Write-Fail "Cannot find aavishield-agent.py. Run the installer from the scripts/agent/ directory."
    }
}
Write-OK "Agent script installed at $AgentScript"

# ── SSL Inspection CA trust ───────────────────────────────────────────────────
# Do this before enabling the system proxy. If the org already has SSL
# Inspection enabled and the CA is not trusted, HTTPS would otherwise break.
Write-Step "Installing SSL Inspection certificate…"
$MitmCaInstalled = $false
$CaFile = Join-Path $InstallDir "ca.pem"
try {
    Invoke-WebRequest `
        -Uri "$AdminUrl/internal/agent/ca-cert" `
        -Headers @{ Authorization = "Bearer ${DeviceId}:${AgentKey}" } `
        -OutFile $CaFile `
        -UseBasicParsing

    Import-Certificate -FilePath $CaFile -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
    New-Item -Path "HKLM:\SOFTWARE\Policies\Mozilla\Firefox\Certificates" -Force | Out-Null
    New-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Mozilla\Firefox\Certificates" -Name ImportEnterpriseRoots -Value 1 -PropertyType DWord -Force | Out-Null
    $MitmCaInstalled = $true
    Write-OK "SSL Inspection certificate installed"
} catch {
    Write-Warn "Could not install SSL Inspection certificate; HTTPS will be blind-tunneled until this is fixed. $($_.Exception.Message)"
}

$Config.mitm_ca_installed = $MitmCaInstalled
$Config | ConvertTo-Json -Depth 3 | Set-Content -Path $ConfigFile -Encoding UTF8

# ── Create Windows Scheduled Task (run at login, keep alive) ─────────────────
Write-Step "Creating Scheduled Task: $TaskName…"

# Remove existing task if present
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$Action  = New-ScheduledTaskAction `
    -Execute $pythonBin `
    -Argument "`"$AgentScript`"" `
    -WorkingDirectory $InstallDir

$Trigger = New-ScheduledTaskTrigger -AtLogOn

$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Days 3650) `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName    $TaskName `
    -Action      $Action `
    -Trigger     $Trigger `
    -Settings    $Settings `
    -RunLevel    Limited `
    -Description "Aavishield security agent — enforces company web policy" `
    | Out-Null

Write-OK "Scheduled Task created"

# Start it now
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2

$TaskState = (Get-ScheduledTask -TaskName $TaskName).State
if ($TaskState -eq "Running") {
    Write-OK "Agent daemon is running"
} else {
    Write-Warn "Task state: $TaskState — check logs at $LogFile"
}

# ── Configure system proxy ────────────────────────────────────────────────────
Write-Step "Configuring system HTTP/HTTPS proxy…"

$ProxyServer = "http=127.0.0.1:$LocalProxyPort;https=127.0.0.1:$LocalProxyPort"
$RegPath     = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
Set-ItemProperty -Path $RegPath -Name ProxyEnable -Value 1
Set-ItemProperty -Path $RegPath -Name ProxyServer -Value "127.0.0.1:$LocalProxyPort"
Set-ItemProperty -Path $RegPath -Name ProxyOverride -Value "localhost;127.0.0.1;<local>"

# Notify WinINet so Chrome/Edge pick it up immediately
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinINet {
    [DllImport("wininet.dll", SetLastError=true)]
    public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
    public const int INTERNET_OPTION_SETTINGS_CHANGED = 39;
    public const int INTERNET_OPTION_REFRESH = 37;
    public static void Refresh() {
        InternetSetOption(IntPtr.Zero, INTERNET_OPTION_SETTINGS_CHANGED, IntPtr.Zero, 0);
        InternetSetOption(IntPtr.Zero, INTERNET_OPTION_REFRESH, IntPtr.Zero, 0);
    }
}
"@
[WinINet]::Refresh()

Write-OK "System proxy set to 127.0.0.1:$LocalProxyPort"

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "🛡️  Aavishield Agent installed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "  Device ID   : $DeviceId"
Write-Host "  Org ID      : $OrgId"
Write-Host "  Agent proxy : 127.0.0.1:$LocalProxyPort"
Write-Host "  SWG Engine  : ${SwgHost}:${SwgPort}"
Write-Host ""
Write-Host "  All browser traffic is now monitored and filtered by your company policy."
Write-Host "  Blocked websites will show the Aavishield block page."
Write-Host ""
Write-Host "  Useful commands:"
Write-Host "    Check status : Get-ScheduledTask -TaskName '$TaskName'"
Write-Host "    View logs    : Get-Content '$LogFile' -Tail 50 -Wait"
Write-Host "    Test proxy   : Invoke-WebRequest http://example.com -Proxy http://127.0.0.1:$LocalProxyPort"
Write-Host "    Uninstall    : .\uninstall-windows.ps1"
Write-Host ""
