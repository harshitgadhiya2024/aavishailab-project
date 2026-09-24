#!/usr/bin/env bash
#
# Manually removes the Aavishield Rust connector from THIS Mac.
#
# This is a local/testing shortcut, not the product's uninstall flow: the
# real flow (services/endpoint-agent/src/uninstall.rs) requires a company
# administrator to authorize removal server-side first (AuthorizeUninstall
# in admin-api) before anything on disk is touched. Running this script
# skips that check entirely — nothing on the server is told this device
# was removed, so its row stays "enrolled" until it simply stops sending
# heartbeats. Use it for your own dev-machine cleanup, not for a real
# employee device.
#
#   ./packaging/macos/manual-uninstall.sh
#
set -euo pipefail

echo "==> Stopping the connector"
sudo launchctl bootout system /Library/LaunchDaemons/com.aavishield.catrust.plist 2>/dev/null || true
launchctl bootout "gui/$(id -u)" /Library/LaunchAgents/com.aavishield.agent.plist 2>/dev/null || true

echo "==> Removing LaunchAgent/LaunchDaemon"
sudo rm -f /Library/LaunchDaemons/com.aavishield.catrust.plist
sudo rm -f /Library/LaunchAgents/com.aavishield.agent.plist

echo "==> Removing the app and data directories"
sudo rm -rf /Applications/Aavishield.app
sudo rm -rf /etc/aavishield
sudo rm -rf /usr/local/aavishield

# ~/.aavishield holds config.json (the saved device enrollment) AND
# enroll.json (a dropped token — see config::enroll_drop_paths). Neither
# gets touched by anything above: config.json only gets removed by a
# real Disconnect (background.rs's handle_disconnect), and nothing
# removes enroll.json at all outside a *successful* enrollment
# consuming it. Leaving this directory behind is exactly why a
# reinstall "automatically connects" again — config::load() (or
# find_enroll_token(), if only enroll.json survived) finds it before
# the GUI ever shows a Connect button.
echo "==> Removing the per-user state directory (config, enrollment token, certs)"
rm -rf "$HOME/.aavishield"

echo "==> Forgetting the pkg receipt"
sudo pkgutil --forget com.aavishield.agent 2>/dev/null || true

echo "==> Removing the trusted CA certificate (if present)"
sudo security delete-certificate -c "Aavishield Root CA" /Library/Keychains/System.keychain 2>/dev/null || true

echo "==> Resetting the system proxy (Wi-Fi + Ethernet)"
for svc in "Wi-Fi" "Ethernet"; do
    if networksetup -listallnetworkservices 2>/dev/null | grep -qx "$svc"; then
        sudo networksetup -setwebproxystate "$svc" off 2>/dev/null || true
        sudo networksetup -setsecurewebproxystate "$svc" off 2>/dev/null || true
    fi
done

echo ""
echo "Done. Aavishield has been removed from this Mac."
echo "Note: the server was not told — the device's dashboard row will only"
echo "go offline once it stops receiving heartbeats from this machine."
