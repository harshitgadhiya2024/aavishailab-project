#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Aavishield Agent Uninstaller — macOS
#
#  HOW TO USE:
#  1. Open Terminal (Spotlight → Terminal)
#  2. Run: chmod +x ~/Downloads/aavishield-uninstall.command
#  3. Run: xattr -d com.apple.quarantine ~/Downloads/aavishield-uninstall.command
#  4. Run: bash ~/Downloads/aavishield-uninstall.command
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

INSTALL_DIR="$HOME/.aavishield"
PLIST_FILE="$HOME/Library/LaunchAgents/com.aavishield.agent.plist"
AGENT_LABEL="com.aavishield.agent"
CONFIG_FILE="$INSTALL_DIR/config.json"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
info() { echo -e "${BLUE}→${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${RED}!${NC} $*"; }

echo
echo -e "${BOLD}${BLUE}🛡️  Aavishield Agent Uninstaller — macOS${NC}"
echo "────────────────────────────────────────"
echo

# ── Notify server before stopping ────────────────────────────────────────────
if [[ -f "$CONFIG_FILE" ]]; then
    DEVICE_ID=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('device_id',''))" 2>/dev/null || echo "")
    AGENT_KEY=$(python3  -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('agent_key',''))"  2>/dev/null || echo "")
    ADMIN_URL=$(python3  -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('admin_url',''))"  2>/dev/null || echo "")
    if [[ -n "$DEVICE_ID" && -n "$AGENT_KEY" && -n "$ADMIN_URL" ]]; then
        info "Notifying Aavishield server…"
        curl -s -X POST "$ADMIN_URL/internal/agent/offline" \
            -H "Authorization: Bearer $DEVICE_ID:$AGENT_KEY" \
            -H "Content-Type: application/json" \
            -d '{}' 2>/dev/null || true
        ok "Server notified"
    fi
fi

# ── Stop LaunchAgent ──────────────────────────────────────────────────────────
info "Stopping agent daemon…"
launchctl unload "$PLIST_FILE" 2>/dev/null || true
# Kill any remaining process listening on 6118
lsof -ti :6118 2>/dev/null | xargs kill -9 2>/dev/null || true
if [[ -f "$PLIST_FILE" ]]; then
    rm -f "$PLIST_FILE"
    ok "LaunchAgent removed"
else
    ok "LaunchAgent was not installed"
fi

# ── Remove system proxy settings ──────────────────────────────────────────────
info "Removing system proxy settings…"
while IFS= read -r SERVICE; do
    [[ -z "$SERVICE" || "$SERVICE" == "An asterisk"* ]] && continue
    networksetup -setwebproxystate       "$SERVICE" off 2>/dev/null || true
    networksetup -setsecurewebproxystate "$SERVICE" off 2>/dev/null || true
    networksetup -setproxybypassdomains  "$SERVICE" "" 2>/dev/null || true
    ok "Proxy cleared for: $SERVICE"
done < <(networksetup -listallnetworkservices 2>/dev/null | tail -n +2)

# ── Remove install files ──────────────────────────────────────────────────────
info "Removing install directory…"
rm -rf "$INSTALL_DIR"
ok "Removed $INSTALL_DIR"

# ── Remove SSL Inspection certificate ────────────────────────────────────────
info "Removing SSL Inspection certificate…"
if sudo -v 2>/dev/null; then
    sudo security delete-certificate -c "Aavishield SSL Inspection CA" /Library/Keychains/System.keychain 2>/dev/null \
        && ok "SSL Inspection certificate removed" \
        || ok "No SSL Inspection certificate found (nothing to remove)"
else
    warn "Could not remove SSL Inspection certificate (no admin password given). Remove manually via Keychain Access if present."
fi

# ── Remove browser proxy locks (if the installer set any) ───────────────────
BROWSER_POLICY_FILES=(
    "/Library/Application Support/Google/Chrome/policies/managed/aavishield-proxy-lock.json"
    "/Library/Application Support/Microsoft Edge/policies/managed/aavishield-proxy-lock.json"
    "/Library/Application Support/BraveSoftware/Brave-Browser/policies/managed/aavishield-proxy-lock.json"
)
FIREFOX_POLICY_FILE="/Applications/Firefox.app/Contents/Resources/distribution/policies.json"

NEED_CLEANUP=false
for f in "${BROWSER_POLICY_FILES[@]}"; do
    [[ -f "$f" ]] && NEED_CLEANUP=true
done
[[ -f "$FIREFOX_POLICY_FILE" ]] && NEED_CLEANUP=true

if [[ "$NEED_CLEANUP" == "true" ]]; then
    info "Removing browser proxy locks…"
    if sudo -v 2>/dev/null; then
        for f in "${BROWSER_POLICY_FILES[@]}"; do
            [[ -f "$f" ]] && sudo rm -f "$f"
        done
        [[ -f "$FIREFOX_POLICY_FILE" ]] && sudo rm -f "$FIREFOX_POLICY_FILE"
        ok "Browser proxy locks removed — restart any open browsers for this to take effect"
    else
        warn "Could not remove browser proxy locks (no admin password given). Remove manually with: sudo rm <file>"
    fi
fi

echo
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${GREEN}  ✅  Aavishield Agent removed successfully!${NC}"
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo "  System proxy has been cleared."
echo "  Your browser traffic is now direct (no proxy)."
echo
read -p "  Press Enter to close…"
