#!/bin/bash
# No clamdscan in this image (it ships in the separate `clamav` package,
# not `clamav-daemon`) — speak clamd's own PING protocol directly instead
# of pulling in a whole extra package just for a healthcheck probe.
set -euo pipefail

exec 3<>/dev/tcp/127.0.0.1/3310
printf 'zPING\0' >&3
response=$(timeout 5 head -c 4 <&3)
exec 3<&-
exec 3>&-

[ "$response" = "PONG" ]
