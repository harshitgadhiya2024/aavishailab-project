# VPN Control

VPN and anonymizer software is blocked **by default on every device**,
without an admin having to configure anything — the same reasoning as the
automatic default DLP policy: an employee's first move to get around web
filtering is a VPN, so it's on from day one.

## What's covered

- **Desktop VPN clients** — 19 built-in matchers (NordVPN, ExpressVPN,
  ProtonVPN, Surfshark, CyberGhost, TunnelBear, Windscribe, Hotspot Shield,
  Private Internet Access, Mullvad, IPVanish, PureVPN, hide.me, Hola,
  HideMyAss, WireGuard, OpenVPN Connect, AWS VPN Client, Tor Browser) —
  killed the same way any blocked application is (see
  [application-control.md](application-control.md)).
- **VPN downloads** — a VPN installer is blocked at download time, by file
  name, before it ever finishes landing on disk — independent of the
  domain block, so it's caught even from a mirror.
- **VPN browser extensions** — a known VPN/proxy Chrome-family extension
  installed in any browser profile is detected and reported (the dashboard
  and the employee both see it); it cannot be force-uninstalled on an
  unmanaged device without MDM, so this is visibility, not a hard block.
- **An admin's own rule always wins** — if a company explicitly allows,
  alert-only's, or disables the block for one of these apps (e.g. it runs
  its own AWS Client VPN), that decision is never overridden by the
  default.

## Bugs fixed this cycle

See [../bug-fixes.md](../bug-fixes.md). Summary:

1. **AWS VPN Client was missing from the default block list.** Found live
   on a real device: it opened and connected freely. Added to the catalog
   (macOS app + bundled OpenVPN process, Windows/Linux clients) so it's
   blocked by default like every other VPN.
