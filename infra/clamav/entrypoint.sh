#!/bin/bash
set -euo pipefail

# The named volume may be freshly created (root-owned, empty) on first run.
chown -R clamav:clamav /var/lib/clamav /var/log/clamav /run/clamav

# clamd refuses to start without a signature database, and the image
# deliberately doesn't bundle one (freshclam's own advice: always pull the
# database at runtime rather than bake in one that's stale the day the
# image is built). Block on the first sync so clamd never starts against
# an empty database; the compose healthcheck's start_period covers this
# initial ~1-3 minute download.
if [ -z "$(ls -A /var/lib/clamav 2>/dev/null)" ]; then
  echo "[entrypoint] no signature database present — running initial freshclam sync"
  freshclam --stdout || echo "[entrypoint] initial freshclam sync failed — clamd will retry via the background updater"
fi

# Background daemon for periodic signature updates (freshclam.conf's
# Checks=24 default = hourly), independent of clamd's own lifecycle.
freshclam -d --stdout &

echo "[entrypoint] starting clamd"
exec clamd --config-file=/etc/clamav/clamd.conf --foreground
