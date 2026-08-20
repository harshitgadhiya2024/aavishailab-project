# ═══════════════════════════════════════════════════════════════
#  Aavishield Agent Uninstaller — Windows
#
#  HOW TO USE:
#  Right-click this file → "Run with PowerShell"
#  OR in PowerShell (Admin):
#    Set-ExecutionPolicy -Scope Process Bypass
#    .\aavishield-uninstall.ps1
# ═══════════════════════════════════════════════════════════════
$ErrorActionPreference = "SilentlyContinue"

$TaskName   = "AavishieldAgent"
$InstallDir = "$env:USERPROFILE\.aavishield"
$ConfigFile = "$InstallDir\config.json"
$RegPath    = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"

Write-Host ""
Write-Host "  =====================================" -ForegroundColor Blue
Write-Host "   AAVISHIELD - Agent Uninstaller" -ForegroundColor Blue
Write-Host "  =====================================" -ForegroundColor Blue
Write-Host ""

# ── Notify server ──────────────────────────────────────────────────────────────
if (Test-Path $ConfigFile) {
    $Config   = Get-Content $ConfigFile | ConvertFrom-Json
    $DeviceId = $Config.device_id
    $AgentKey = $Config.agent_key
    $AdminUrl = $Config.admin_url
    if ($DeviceId -and $AgentKey -and $AdminUrl) {
        Write-Host "  → Notifying Aavishield server..." -ForegroundColor Cyan
        try {
            Invoke-RestMethod `
                -Uri     "$AdminUrl/internal/agent/offline" `
                -Method  POST `
                -Headers @{ Authorization = "Bearer ${DeviceId}:${AgentKey}"; "Content-Type" = "application/json" } `
                -Body    "{}" | Out-Null
            Write-Host "  ✓ Server notified" -ForegroundColor Green
        } catch {
            Write-Host "  ! Could not reach server (offline already)" -ForegroundColor Yellow
        }
    }
}

# ── Stop and remove Scheduled Task ────────────────────────────────────────────
Write-Host "  → Stopping agent process..." -ForegroundColor Cyan
Stop-ScheduledTask  -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# Kill any python process on port 6118
$portProcess = netstat -ano | Select-String ":6118" | ForEach-Object {
    ($_ -split '\s+')[-1]
} | Select-Object -First 1
if ($portProcess) {
    Stop-Process -Id $portProcess -Force -ErrorAction SilentlyContinue
}
Write-Host "  ✓ Agent process stopped" -ForegroundColor Green

# ── Disable and clear system proxy ────────────────────────────────────────────
Write-Host "  → Removing system proxy settings..." -ForegroundColor Cyan
Set-ItemProperty  -Path $RegPath -Name ProxyEnable -Value 0
Remove-ItemProperty -Path $RegPath -Name ProxyServer   -ErrorAction SilentlyContinue
Remove-ItemProperty -Path $RegPath -Name ProxyOverride -ErrorAction SilentlyContinue

# Notify Windows that proxy settings changed
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinINet {
    [DllImport("wininet.dll")] public static extern bool InternetSetOption(IntPtr h, int o, IntPtr b, int l);
    public static void Refresh() {
        InternetSetOption(IntPtr.Zero, 39, IntPtr.Zero, 0);
        InternetSetOption(IntPtr.Zero, 37, IntPtr.Zero, 0);
    }
}
"@
[WinINet]::Refresh()
Write-Host "  ✓ System proxy cleared" -ForegroundColor Green

# ── Remove install directory ───────────────────────────────────────────────────
Write-Host "  → Removing install files..." -ForegroundColor Cyan
Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "  ✓ Install directory removed" -ForegroundColor Green

Write-Host ""
Write-Host "  =====================================" -ForegroundColor Green
Write-Host "   ✅  Aavishield Agent removed!" -ForegroundColor Green
Write-Host "  =====================================" -ForegroundColor Green
Write-Host ""
Write-Host "  System proxy has been cleared." -ForegroundColor White
Write-Host "  Your browser traffic is now direct." -ForegroundColor White
Write-Host ""
Read-Host "  Press Enter to close"
