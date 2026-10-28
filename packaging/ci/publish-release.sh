#!/usr/bin/env bash
#
# Releases one platform's staged package: verifies it, copies it to
# releases/<platform>/<version>/, publishes it to the running admin-api
# (which moves only that platform's version — see agent_packages.go), then
# writes the release marker and clears staging. Called by the publish job
# of agent-macos.yml / agent-windows.yml / agent-linux.yml, only after that
# workflow's build succeeded.
#
#   packaging/ci/publish-release.sh <macos|windows|linux> <version> <run id>
#
# Needs R2_ENDPOINT_URL, R2_BUCKET, R2_ROOT, the AWS_* credentials,
# AAVISHIELD_ADMIN_URL and AGENT_PACKAGE_UPLOAD_TOKEN.
set -euo pipefail

PLATFORM="${1:?platform is required}"
VERSION="${2:?version is required}"
RUN_ID="${3:?run id is required}"
: "${R2_ENDPOINT_URL:?}" "${R2_BUCKET:?}" "${R2_ROOT:?}" "${AAVISHIELD_ADMIN_URL:?}" "${AGENT_PACKAGE_UPLOAD_TOKEN:?}"

case "$PLATFORM" in
    macos) EXT=pkg ;;
    windows) EXT=msi ;;
    linux) EXT=deb ;;
    *) echo "::error::platform '$PLATFORM' must be macos, windows or linux"; exit 1 ;;
esac

r2() { aws --endpoint-url "$R2_ENDPOINT_URL" "$@"; }
STAGING="s3://$R2_BUCKET/$R2_ROOT/staging/$PLATFORM/$VERSION/$RUN_ID"
RELEASE="s3://$R2_BUCKET/$R2_ROOT/releases/$PLATFORM/$VERSION"

rm -rf dist && mkdir dist
r2 s3 cp --recursive --only-show-errors "$STAGING/" dist/
cd dist
ls -l
n=$(ls *."$EXT" 2>/dev/null | wc -l)
[[ "$n" -eq 1 ]] || { echo "::error::expected exactly one .$EXT staged, found $n"; exit 1; }
ARTIFACT=$(ls *."$EXT")
# Proves the bytes about to go live are the bytes the build job produced,
# not something truncated or swapped in R2 in between.
cat *.sha256 | sha256sum --check --strict

# Files first, marker last: a release folder without manifest.json is a
# publish that didn't finish, and check-release.sh lets that version be
# built again.
for f in *; do
    r2 s3 cp --only-show-errors "$f" "$RELEASE/$f"
done

echo "==> Publishing $ARTIFACT as $PLATFORM $VERSION"
curl -fsSL --retry 3 --retry-all-errors -X POST "$AAVISHIELD_ADMIN_URL/internal/admin/agent-packages" \
    -H "Authorization: Bearer $AGENT_PACKAGE_UPLOAD_TOKEN" \
    -F "platform=$PLATFORM" \
    -F "version=$VERSION" \
    -F "file=@$ARTIFACT"
echo

jq -n --arg p "$PLATFORM" --arg v "$VERSION" --arg a "$ARTIFACT" '{platform: $p, version: $v, artifact: $a}' > ../manifest.json
cat ../manifest.json
r2 s3 cp --only-show-errors ../manifest.json "$RELEASE/manifest.json"
r2 s3 rm --recursive --only-show-errors "$STAGING/"
