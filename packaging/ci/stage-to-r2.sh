#!/usr/bin/env bash
#
# Uploads built packages to this run's R2 staging folder, each with a
# `<file>.sha256` sidecar the publish job re-verifies after downloading.
# Called by the build job of agent-macos.yml / agent-windows.yml /
# agent-linux.yml; nothing reaches production from here — that workflow's
# publish job does that (publish-release.sh), only once the build passed.
#
#   STAGE_URI=s3://bucket/prefix/staging/<platform>/<version>/<run id> \
#     packaging/ci/stage-to-r2.sh dist/aavishield-agent-*.pkg
#
# Needs R2_ENDPOINT_URL and the AWS_* credentials in the environment.
set -euo pipefail

: "${STAGE_URI:?STAGE_URI is required}"
: "${R2_ENDPOINT_URL:?R2_ENDPOINT_URL is required}"
[[ $# -gt 0 ]] || { echo "!! no files to stage" >&2; exit 1; }

# macOS ships shasum but not sha256sum; both print "<hash>  <name>".
sha256() {
    if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi
}

for path in "$@"; do
    [[ -f "$path" ]] || { echo "!! $path does not exist — did the build produce it?" >&2; exit 1; }
    dir="$(dirname "$path")"
    name="$(basename "$path")"
    (cd "$dir" && sha256 "$name" > "$name.sha256")
    echo "==> Staging $name ($(cut -d' ' -f1 "$dir/$name.sha256"))"
    aws --endpoint-url "$R2_ENDPOINT_URL" s3 cp --only-show-errors "$path" "$STAGE_URI/$name"
    aws --endpoint-url "$R2_ENDPOINT_URL" s3 cp --only-show-errors "$dir/$name.sha256" "$STAGE_URI/$name.sha256"
done
