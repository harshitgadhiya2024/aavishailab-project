# syntax=docker/dockerfile:1
#
# Native arm64 ClamAV. The upstream `clamav/clamav` Docker Hub image is
# amd64-only (verified via `docker manifest inspect` against every tag —
# stable, latest, 1.4, *_base — none publish an arm64 variant), which is
# why this host was running it under qemu emulation. Debian's own
# clamav-daemon package (1.4.3, the same version the official image ships)
# IS built natively for arm64 and is what this host's docker build actually
# runs on — so build from the distro package instead of the single-arch
# upstream image.
FROM debian:12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      clamav-daemon clamav-freshclam ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/log/clamav /var/lib/clamav /run/clamav \
    && chown clamav:clamav /var/log/clamav /var/lib/clamav /run/clamav

COPY entrypoint.sh /entrypoint.sh
COPY healthcheck.sh /healthcheck.sh
RUN chmod +x /entrypoint.sh /healthcheck.sh

EXPOSE 3310
VOLUME ["/var/lib/clamav"]

HEALTHCHECK --interval=30s --timeout=10s --retries=5 --start-period=180s \
  CMD ["/healthcheck.sh"]

ENTRYPOINT ["/entrypoint.sh"]
