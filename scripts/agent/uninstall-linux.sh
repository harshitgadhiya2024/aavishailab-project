#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Aavishield Agent Uninstaller — Linux
#
#  HOW TO USE:
#  chmod +x aavishield-uninstall.sh && bash aavishield-uninstall.sh
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

INSTALL_DIR="$HOME/.aavishield"
CONFIG_FILE="$INSTALL_DIR/config.json"
SERVICE_FILE="$HOME/.config/systemd/user/aavishield-agent.service"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
info() { echo -e "${BLUE}→${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }

echo
echo -e "${BOLD}${BLUE}🛡️  Aavishield Agent Uninstaller — Linux${NC}"
echo "────────────────────────────────────────"
echo

# ── Notify server ─────────────────────────────────────────────────────────────
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

# ── Stop systemd service ──────────────────────────────────────────────────────
info "Stopping agent service…"
systemctl --user stop  aavishield-agent 2>/dev/null || true
systemctl --user disable aavishield-agent 2>/dev/null || true
# Kill any remaining process on port 6118
lsof -ti :6118 2>/dev/null | xargs kill -9 2>/dev/null || true
if [[ -f "$SERVICE_FILE" ]]; then
    rm -f "$SERVICE_FILE"
    systemctl --user daemon-reload 2>/dev/null || true
    ok "systemd service removed"
else
    ok "Service was not installed"
fi

# ── Remove GNOME proxy settings ────────────────────────────────────────────────
info "Removing proxy settings…"
gsettings set org.gnome.system.proxy mode 'none' 2>/dev/null || true
ok "GNOME proxy cleared (if applicable)"

# ── Remove environment proxy from shell configs ───────────────────────────────
for RC in ~/.bashrc ~/.bash_profile ~/.zshrc ~/.profile; do
    if [[ -f "$RC" ]]; then
        sed -i '/aavishield\|6118/Id' "$RC" 2>/dev/null || \
        sed -i '' '/aavishield\|6118/Id' "$RC" 2>/dev/null || true
        ok "Cleaned $RC"
    fi
done

# ── Remove install files ──────────────────────────────────────────────────────
info "Removing install directory…"
rm -rf "$INSTALL_DIR"
ok "Removed $INSTALL_DIR"

echo
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}${GREEN}  ✅  Aavishield Agent removed successfully!${NC}"
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo "  Proxy settings have been cleared."
echo "  Restart your terminal for shell proxy vars to take effect."
echo
