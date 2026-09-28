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

# Screen Recording and Input Monitoring are keyed to the app's signing
# identity, which for ad-hoc signing (no Developer ID) is the cdhash — a
# different one on every build. Without this, the next install's grant
# request lands as a second, unrelated Settings row next to this one
# rather than replacing it, and the list slowly fills with stale entries
# that read "granted" beside an agent that can't use any of them. Run as
# the real user, not sudo: tccutil acts on the invoking user's own TCC
# context, and root's is not that — the same reason nothing else in this
# section that touches this user's own files runs under sudo either.
echo "==> Resetting Screen Recording / Input Monitoring grants"
tccutil reset ScreenCapture com.aavishield.agent 2>/dev/null || true
tccutil reset ListenEvent com.aavishield.agent 2>/dev/null || true

# The MITM CA (see ca_trust.rs) is installed into this user's own login
# keychain, not the System one — no root needed to trust it, since it
# only ever needs to cover this user's own traffic. Removed from both
# keychains regardless: the login one for every real install, the System
# one only matters for a machine carrying a leftover cert from an earlier
# build that tried that approach — harmless to also attempt and skip
# silently where there's nothing to remove. The name must match
# mitm/ca.go's actual Subject.CommonName ("...SSL Inspection CA") — this
# used to say "Aavishield Root CA", a name the server has never actually
# issued a certificate under, so this step deleted nothing, ever, on any
# machine, until now.
echo "==> Removing the trusted CA certificate (if present)"
security delete-certificate -c "Aavishield SSL Inspection CA" "$HOME/Library/Keychains/login.keychain-db" 2>/dev/null || true
sudo security delete-certificate -c "Aavishield SSL Inspection CA" /Library/Keychains/System.keychain 2>/dev/null || true

# Every enabled service, not just Wi-Fi/Ethernet — system_proxy.rs's own
# macos_network_services() enumerates all of them the same way (skipping
# the header line and anything networksetup marks disabled with a
# leading "*"), because a Thunderbolt Bridge, a USB adapter or a VPN
# service can just as easily be carrying the proxy setting this needs to
# clear, and a hardcoded two-name list would silently miss it.
echo "==> Resetting the system proxy on every enabled network service"
# `|| true` on the grep matters under `set -o pipefail` above: if every
# service happens to be disabled, `grep -v` legitimately matches nothing
# and exits 1, which would otherwise abort the whole script right here
# rather than just skipping a loop with nothing to iterate.
networksetup -listallnetworkservices 2>/dev/null | tail -n +2 | { grep -v '^\*' || true; } | while IFS= read -r svc; do
    [ -z "$svc" ] && continue
    sudo networksetup -setwebproxystate "$svc" off 2>/dev/null || true
    sudo networksetup -setsecurewebproxystate "$svc" off 2>/dev/null || true
done

echo ""
echo "Done. Aavishield has been removed from this Mac."
echo "Note: the server was not told — the device's dashboard row will only"
echo "go offline once it stops receiving heartbeats from this machine."
