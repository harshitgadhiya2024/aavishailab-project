#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Aavishield Agent Installer — macOS
#
# Usage:
#   curl -fsSL https://<your-admin-host>/agent/install-macos.sh | bash -s -- <ENROLLMENT_TOKEN>
#   or locally:
#   bash install-macos.sh <ENROLLMENT_TOKEN>
#
# Environment overrides (optional):
#   AAVISHIELD_ADMIN_URL  — admin API base URL  (default: http://localhost:6000)
#   AAVISHIELD_SWG_HOST   — SWG engine hostname (default: localhost)
#   AAVISHIELD_SWG_PORT   — SWG engine port     (default: 6080)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ENROLLMENT_TOKEN="${1:-}"
ADMIN_URL="${AAVISHIELD_ADMIN_URL:-http://localhost:6000}"
SWG_HOST="${AAVISHIELD_SWG_HOST:-localhost}"
SWG_PORT="${AAVISHIELD_SWG_PORT:-6080}"

INSTALL_DIR="$HOME/.aavishield"
CONFIG_FILE="$INSTALL_DIR/config.json"
AGENT_SCRIPT="$INSTALL_DIR/aavishield-agent.py"
LOG_FILE="$INSTALL_DIR/agent.log"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_FILE="$PLIST_DIR/com.aavishield.agent.plist"
AGENT_LABEL="com.aavishield.agent"
LOCAL_PROXY_PORT=6118

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${BLUE}→${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}!${NC} $*"; }
die()   { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

# ─────────────────────────────────────────────────────────────────────────────
echo
echo -e "${BOLD}${BLUE}🛡️  Aavishield Agent Installer — macOS${NC}"
echo "────────────────────────────────────────"

# ── Pre-flight checks ─────────────────────────────────────────────────────────
[[ -z "$ENROLLMENT_TOKEN" ]] && die \
  "Usage: $0 <enrollment_token>\nGet your token from Company Dashboard → Employees → <Employee> → Generate Enrollment Token"

command -v python3 &>/dev/null || die "Python 3 is required. Install from https://www.python.org"
command -v curl    &>/dev/null || die "curl is required"

# ── Create directories ────────────────────────────────────────────────────────
info "Creating install directory at $INSTALL_DIR"
mkdir -p "$INSTALL_DIR" "$PLIST_DIR"
touch "$LOG_FILE"
chmod 700 "$INSTALL_DIR"

# ── Gather device info ────────────────────────────────────────────────────────
HOSTNAME=$(hostname -s 2>/dev/null || hostname)
OS_VERSION=$(sw_vers -productVersion 2>/dev/null || echo "unknown")
MAC_ADDR=$(ifconfig en0 2>/dev/null | awk '/ether/{print $2}' | head -1 || echo "")
ARCH=$(uname -m)
AGENT_VERSION="1.0.0"

info "Device: $HOSTNAME  macOS: $OS_VERSION  Arch: $ARCH"

# ── Enroll with admin API ─────────────────────────────────────────────────────
info "Enrolling device with Aavishield admin…"

ENROLL_PAYLOAD=$(python3 -c "
import json, sys
print(json.dumps({
    'token':         '$ENROLLMENT_TOKEN',
    'hostname':      '$HOSTNAME',
    'os_type':       'darwin',
    'os_version':    '$OS_VERSION',
    'mac_address':   '$MAC_ADDR',
    'agent_version': '$AGENT_VERSION',
}))
")

HTTP_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "$ADMIN_URL/internal/agent/enroll" \
    -H "Content-Type: application/json" \
    -d "$ENROLL_PAYLOAD" 2>&1) || die "Failed to reach admin API at $ADMIN_URL"

HTTP_BODY=$(echo "$HTTP_RESPONSE" | sed '$d')
HTTP_CODE=$(echo "$HTTP_RESPONSE" | tail -n1)

if [[ "$HTTP_CODE" != "200" ]]; then
    die "Enrollment failed (HTTP $HTTP_CODE):\n$HTTP_BODY"
fi

# Parse response
DEVICE_ID=$(echo "$HTTP_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['device_id'])" 2>/dev/null) || die "Failed to parse device_id"
AGENT_KEY=$(echo "$HTTP_BODY"  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['agent_key'])"  2>/dev/null) || die "Failed to parse agent_key"
ORG_ID=$(echo "$HTTP_BODY"    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['org_id'])"    2>/dev/null) || die "Failed to parse org_id"
EMPLOYEE_ID=$(echo "$HTTP_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('employee_id') or '')" 2>/dev/null || echo "")
SWG_PORT_SERVER=$(echo "$HTTP_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('swg_port', $SWG_PORT))" 2>/dev/null || echo "$SWG_PORT")
SWG_HOST_SERVER=$(echo "$HTTP_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('swg_host') or '')" 2>/dev/null || echo "")

SWG_PORT="$SWG_PORT_SERVER"
# The server-provided SWG host wins, unless the operator explicitly overrode it
# via AAVISHIELD_SWG_HOST on the install command line. Kept only for backward
# compatibility with older config files — the agent enforces policy locally
# from rules it fetches over HTTPS from ADMIN_URL, so it works on any network
# without needing this to be reachable.
if [[ -z "${AAVISHIELD_SWG_HOST:-}" && -n "$SWG_HOST_SERVER" ]]; then
    SWG_HOST="$SWG_HOST_SERVER"
fi

ok "Device enrolled: $DEVICE_ID"

# ── Save config ───────────────────────────────────────────────────────────────
info "Saving agent configuration…"

python3 -c "
import json
cfg = {
    'device_id':   '$DEVICE_ID',
    'agent_key':   '$AGENT_KEY',
    'org_id':      '$ORG_ID',
    'employee_id': '$EMPLOYEE_ID',
    'swg_host':    '$SWG_HOST',
    'swg_port':    $SWG_PORT,
    'admin_url':   '$ADMIN_URL',
    'local_port':  $LOCAL_PROXY_PORT,
    'hostname':    '$HOSTNAME',
    'os_type':     'darwin',
    'os_version':  '$OS_VERSION',
    'agent_version': '$AGENT_VERSION',
    'mitm_ca_installed': False,
}
with open('$CONFIG_FILE', 'w') as f:
    json.dump(cfg, f, indent=2)
"
chmod 600 "$CONFIG_FILE"
ok "Config saved to $CONFIG_FILE"

# ── Install agent script ──────────────────────────────────────────────────────
info "Installing agent daemon…"
SCRIPT_SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/aavishield-agent.py"
if [[ -f "$SCRIPT_SOURCE" ]]; then
    cp "$SCRIPT_SOURCE" "$AGENT_SCRIPT"
else
    # Download from admin API
    curl -fsSL "$ADMIN_URL/agent/aavishield-agent.py" -o "$AGENT_SCRIPT" || \
        die "Cannot find aavishield-agent.py. Run the installer from the scripts/agent/ directory."
fi
chmod +x "$AGENT_SCRIPT"
ok "Agent script installed at $AGENT_SCRIPT"

# ── SSL Inspection CA trust ───────────────────────────────────────────────────
# Do this before enabling the system proxy. If the org already has SSL
# Inspection enabled and the CA is not trusted, HTTPS would otherwise break.
MITM_CA_INSTALLED=false
info "Installing SSL Inspection certificate (needed for DLP over HTTPS)…"
if curl -fsSL "$ADMIN_URL/internal/agent/ca-cert" \
    -H "Authorization: Bearer $DEVICE_ID:$AGENT_KEY" -o "$INSTALL_DIR/ca.pem" 2>/dev/null \
    && [[ -s "$INSTALL_DIR/ca.pem" ]]; then
    if sudo -v 2>/dev/null && sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$INSTALL_DIR/ca.pem" 2>/dev/null; then
        MITM_CA_INSTALLED=true
        ok "SSL Inspection certificate installed"
    else
        warn "Could not install SSL Inspection certificate — HTTPS will be blind-tunneled until this is fixed."
    fi
else
    warn "Could not download SSL Inspection certificate — HTTPS will be blind-tunneled until this is fixed."
fi

python3 -c "
import json
p = '$CONFIG_FILE'
with open(p) as f:
    cfg = json.load(f)
cfg['mitm_ca_installed'] = '$MITM_CA_INSTALLED' == 'true'
with open(p, 'w') as f:
    json.dump(cfg, f, indent=2)
"

# ── Create macOS LaunchAgent plist ────────────────────────────────────────────
info "Creating LaunchAgent…"
# Prefer the stable Apple-provided python3 over whatever's first on PATH.
# A conda/homebrew python3 (e.g. an active conda "base" env) can be a newer
# release with unrelated interpreter-level threading bugs that surface under
# this agent's per-connection daemon threads — pinning to the system install
# avoids depending on whatever happens to be active in the installing shell.
if [[ -x /usr/bin/python3 ]]; then
    PYTHON_BIN=/usr/bin/python3
else
    PYTHON_BIN=$(command -v python3)
fi

cat > "$PLIST_FILE" << PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${AGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${PYTHON_BIN}</string>
        <string>${AGENT_SCRIPT}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>${LOG_FILE}</string>
    <key>StandardErrorPath</key>
    <string>${LOG_FILE}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
PLIST_EOF

ok "LaunchAgent plist created"

# ── Start agent ───────────────────────────────────────────────────────────────
info "Starting agent daemon…"
launchctl unload "$PLIST_FILE" 2>/dev/null || true
launchctl load   "$PLIST_FILE"

info "Waiting for agent proxy to become ready…"
# Startup does a few sequential 10s-timeout calls to the admin API (rules,
# MITM config, enforcement state) before the proxy socket opens, so on a slow
# network this can legitimately take close to 30s — not just an instant bind.
AGENT_READY=false
for _ in $(seq 1 40); do
    if python3 -c "import socket; s=socket.create_connection(('127.0.0.1',$LOCAL_PROXY_PORT),timeout=1); s.close()" 2>/dev/null; then
        AGENT_READY=true
        break
    fi
    sleep 1
done

if [[ "$AGENT_READY" == "true" ]]; then
    ok "Agent daemon started"
else
    die "Agent failed to start after 40s. Check: tail -20 $LOG_FILE"
fi

# ── Configure system proxy ────────────────────────────────────────────────────
info "Configuring system-wide HTTP proxy…"

# Get all enabled network services (skip ones marked with *)
while IFS= read -r SERVICE; do
    [[ -z "$SERVICE" ]] && continue
    [[ "$SERVICE" == "An asterisk"* ]] && continue

    networksetup -setwebproxy          "$SERVICE" "127.0.0.1" "$LOCAL_PROXY_PORT" 2>/dev/null && \
    networksetup -setwebproxystate     "$SERVICE" on                                2>/dev/null || true

    networksetup -setsecurewebproxy    "$SERVICE" "127.0.0.1" "$LOCAL_PROXY_PORT" 2>/dev/null && \
    networksetup -setsecurewebproxystate "$SERVICE" on                              2>/dev/null || true

    networksetup -setproxybypassdomains "$SERVICE" \
        "localhost" "127.0.0.1" "*.local" "169.254/16" "fe80::/10" 2>/dev/null || true

    ok "Proxy configured for network: $SERVICE"
done < <(networksetup -listallnetworkservices 2>/dev/null | tail -n +2)

# ── Lock browser proxy settings (blocks VPN/proxy browser extensions) ───────
# A browser extension with the "proxy" permission (VeePN, Hola, etc.) can
# silently route that browser's traffic through its own proxy, overriding the
# OS-level proxy above for that browser specifically — every other app stays
# filtered, but that one browser's traffic escapes us entirely. This affects
# every Chromium-based browser (Chrome, Edge, Brave — same extension API), so
# each gets its own managed policy locking its proxy config. Firefox uses a
# different mechanism (distribution/policies.json) and gets handled
# separately below. Safari has no such extension proxy API, so it always
# honours the OS-level proxy and needs no extra hardening.
info "Locking installed browsers' proxy configs against browser-extension VPNs (admin password needed)…"
if sudo -v 2>/dev/null; then
    CHROMIUM_JSON=$(cat << CHROMIUM_POLICY_EOF
{
  "ProxySettings": {
    "ProxyMode": "fixed_servers",
    "ProxyServer": "127.0.0.1:$LOCAL_PROXY_PORT",
    "ProxyBypassList": "<local>"
  }
}
CHROMIUM_POLICY_EOF
)
    # Chrome
    sudo mkdir -p "/Library/Application Support/Google/Chrome/policies/managed"
    echo "$CHROMIUM_JSON" | sudo tee "/Library/Application Support/Google/Chrome/policies/managed/aavishield-proxy-lock.json" > /dev/null
    ok "Chrome proxy locked"

    # Microsoft Edge (only if installed)
    if [[ -d "/Applications/Microsoft Edge.app" ]]; then
        sudo mkdir -p "/Library/Application Support/Microsoft Edge/policies/managed"
        echo "$CHROMIUM_JSON" | sudo tee "/Library/Application Support/Microsoft Edge/policies/managed/aavishield-proxy-lock.json" > /dev/null
        ok "Edge proxy locked"
    fi

    # Brave (only if installed)
    if [[ -d "/Applications/Brave Browser.app" ]]; then
        sudo mkdir -p "/Library/Application Support/BraveSoftware/Brave-Browser/policies/managed"
        echo "$CHROMIUM_JSON" | sudo tee "/Library/Application Support/BraveSoftware/Brave-Browser/policies/managed/aavishield-proxy-lock.json" > /dev/null
        ok "Brave proxy locked"
    fi

    # Firefox (only if installed) — different policy file/schema than Chromium.
    # NOTE: this file lives inside Firefox.app, so a Firefox update can wipe it;
    # re-running this installer re-applies it.
    if [[ -d "/Applications/Firefox.app" ]]; then
        sudo mkdir -p "/Applications/Firefox.app/Contents/Resources/distribution"
        sudo tee "/Applications/Firefox.app/Contents/Resources/distribution/policies.json" > /dev/null << FIREFOX_POLICY_EOF
{
  "policies": {
    "Proxy": {
      "Mode": "manual",
      "Locked": true,
      "HTTPProxy": "127.0.0.1:$LOCAL_PROXY_PORT",
      "SSLProxy": "127.0.0.1:$LOCAL_PROXY_PORT",
      "UseHTTPProxyForAllProtocols": true,
      "Passthrough": "<local>, 127.0.0.1, localhost"
    },
    "Certificates": { "ImportEnterpriseRoots": true }
  }
}
FIREFOX_POLICY_EOF
        ok "Firefox proxy locked"
    fi

    ok "Browser proxy locks applied — restart any open browsers for this to take effect"

else
    warn "Skipped browser hardening (no admin password given) — a VPN/proxy browser extension could still bypass filtering. Re-run this installer and enter your Mac password to enable this protection."
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo
echo -e "${BOLD}${GREEN}🛡️  Aavishield Agent installed successfully!${NC}"
echo
echo -e "  ${BOLD}Device ID:${NC}     $DEVICE_ID"
echo -e "  ${BOLD}Org ID:${NC}        $ORG_ID"
echo -e "  ${BOLD}Agent proxy:${NC}   127.0.0.1:$LOCAL_PROXY_PORT"
echo -e "  ${BOLD}SWG Engine:${NC}    $SWG_HOST:$SWG_PORT"
echo
echo "  All browser traffic is now monitored and filtered by your company policy."
echo "  Blocked websites will show the Aavishield block page."
echo
echo -e "  ${BOLD}Useful commands:${NC}"
echo "    Check agent status : launchctl list $AGENT_LABEL"
echo "    View agent logs    : tail -f $LOG_FILE"
echo "    Test a blocked site: curl -x 127.0.0.1:$LOCAL_PROXY_PORT http://example.com"
echo "    Uninstall          : bash uninstall-macos.sh"
echo
