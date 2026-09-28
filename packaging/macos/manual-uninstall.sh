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

# The agent has to be *gone* before anything below runs, not merely
# unloaded from one plist path. A running agent puts back what this script
# removes — its proxy watchdog re-applies the system proxy within seconds
# and its CA loop reinstalls the certificate — which is exactly what
# happened on a real Mac: this used to boot out only the
# /Library/LaunchAgents copy, the agent there had been loaded from
# ~/Library/LaunchAgents, and it kept running and restored both. So: boot
# out by label (whichever plist loaded it), then make sure no process is
# left, and wait for it.
echo "==> Stopping the connector"
sudo launchctl bootout system /Library/LaunchDaemons/com.aavishield.catrust.plist 2>/dev/null || true
launchctl bootout "gui/$(id -u)/com.aavishield.agent" 2>/dev/null || true
launchctl bootout "gui/$(id -u)" /Library/LaunchAgents/com.aavishield.agent.plist 2>/dev/null || true
pkill -x aavishield-agent 2>/dev/null || true
for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -x aavishield-agent >/dev/null || break
    sleep 1
done
if pgrep -x aavishield-agent >/dev/null; then
    sudo pkill -9 -x aavishield-agent 2>/dev/null || true
fi

echo "==> Removing LaunchAgent/LaunchDaemon"
sudo rm -f /Library/LaunchDaemons/com.aavishield.catrust.plist
sudo rm -f /Library/LaunchAgents/com.aavishield.agent.plist
rm -f "$HOME/Library/LaunchAgents/com.aavishield.agent.plist"

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
rm -rf "$HOME/Library/Application Support/Aavishield"   # window state only

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
#
# Deleted by SHA-1, every copy: `delete-certificate -c <name>` refuses
# outright when more than one certificate matches ("Unable to delete
# certificate matching …"), and a Mac that has had the agent reinstalled
# can carry several — one had three, and none of them went.
CA_NAME="Aavishield SSL Inspection CA"
remove_ca_copies() {  # $1 = keychain, $2 = "sudo" or ""
    local hashes
    hashes=$(security find-certificate -a -c "$CA_NAME" -Z "$1" 2>/dev/null | awk '/SHA-1 hash:/{print $3}' | sort -u) || true
    for h in $hashes; do
        $2 security delete-certificate -Z "$h" "$1" >/dev/null 2>&1 || true
    done
}
echo "==> Removing the trusted CA certificate (every copy, if present)"
remove_ca_copies "$HOME/Library/Keychains/login.keychain-db" ""
remove_ca_copies /Library/Keychains/System.keychain sudo

# Every enabled service, not just Wi-Fi/Ethernet — system_proxy.rs's own
# macos_network_services() enumerates all of them the same way (skipping
# the header line and anything networksetup marks disabled with a
# leading "*"), because a Thunderbolt Bridge, a USB adapter or a VPN
# service can just as easily be carrying the proxy setting this needs to
# clear, and a hardcoded two-name list would silently miss it.
#
# Disabled services (listed with a leading "*") too: the agent now sets
# the proxy on those as well, so an adapter switched on later doesn't come
# up unfiltered — and so it has to be cleared there too, or that same
# adapter would come up pointing at a proxy that no longer exists.
echo "==> Resetting the system proxy on every network service"
networksetup -listallnetworkservices 2>/dev/null | tail -n +2 | sed 's/^\*//' | while IFS= read -r svc; do
    [ -z "$svc" ] && continue
    sudo networksetup -setwebproxystate "$svc" off 2>/dev/null || true
    sudo networksetup -setsecurewebproxystate "$svc" off 2>/dev/null || true
done

echo ""
echo "Done. Aavishield has been removed from this Mac."
echo "Note: the server was not told — the device's dashboard row will only"
echo "go offline once it stops receiving heartbeats from this machine."
