#!/usr/bin/env bash
#
# Refuses a release before any build time is spent on it: the version must
# be MAJOR.MINOR.PATCH, not already published for this platform, and newer
# than this platform's latest release. Called by the resolve job of
# agent-macos.yml / agent-windows.yml / agent-linux.yml.
#
#   packaging/ci/check-release.sh <macos|windows|linux> <version>
#
# R2 layout (under $R2_ROOT):
#   releases/<platform>/<version>/manifest.json   a published release
#   releases/<version>/manifest.json              a release from before
#                                                 per-platform versions,
#                                                 which covered all three
#
# Needs R2_ENDPOINT_URL, R2_BUCKET, R2_ROOT and the AWS_* credentials.
set -euo pipefail

PLATFORM="${1:?platform is required}"
VERSION="${2:?version is required}"
: "${R2_ENDPOINT_URL:?}" "${R2_BUCKET:?}" "${R2_ROOT:?}"

case "$PLATFORM" in
    macos|windows|linux) ;;
    *) echo "::error::platform '$PLATFORM' must be macos, windows or linux"; exit 1 ;;
esac
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "::error::version '$VERSION' is not MAJOR.MINOR.PATCH"
    exit 1
fi

r2() { aws --endpoint-url "$R2_ENDPOINT_URL" "$@"; }

published() {
    local out
    if out=$(r2 s3api head-object --bucket "$R2_BUCKET" --key "$1" 2>&1); then
        return 0
    elif grep -qE "Not Found|404" <<<"$out"; then
        return 1
    fi
    echo "::error::could not check R2 for an existing release: $out"
    exit 1
}

semver_dirs() {
    r2 s3 ls "s3://$R2_BUCKET/$1" | awk '$1=="PRE"{sub("/$","",$2); print $2}' \
        | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' || true
}

if published "$R2_ROOT/releases/$PLATFORM/$VERSION/manifest.json" || published "$R2_ROOT/releases/$VERSION/manifest.json"; then
    echo "::error::$PLATFORM $VERSION is already published — bump the version"
    exit 1
fi

latest=$( { semver_dirs "$R2_ROOT/releases/"; semver_dirs "$R2_ROOT/releases/$PLATFORM/"; } | sort -V | tail -1)
if [[ -n "$latest" ]] && [[ "$(printf '%s\n%s\n' "$latest" "$VERSION" | sort -V | tail -1)" != "$VERSION" ]]; then
    echo "::error::$VERSION is older than the latest $PLATFORM release $latest"
    exit 1
fi
echo "$PLATFORM: latest release ${latest:-none}; building $VERSION"
