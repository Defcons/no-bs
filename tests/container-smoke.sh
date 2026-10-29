#!/usr/bin/env bash
# The production container in its real shape (docker-compose.yml and the Dockerfile, as the box runs them): the built
# app and its OTA files are served by nginx as uid 101 on a read-only filesystem, on 3060 (the published host port).
# A directory URL without its trailing slash redirects with a relative Location (no host, no ":3060"), no process in
# the container runs as root, all capabilities are dropped, and the image cannot be written.
# Needs Docker with compose v2 and curl, as on CI's runner:
#   bash tests/container-smoke.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=3060
D="$(mktemp -d)"
chmod 755 "$D"
# docker-compose.yml mounts the host's /opt/nobs-dl at dl/ (the downloadable APK); the test mounts a folder of its own.
mkdir "$D/dl"
echo apk > "$D/dl/t.apk"
chmod 755 "$D/dl"
chmod 644 "$D/dl/t.apk"
cat > "$D/override.yml" <<EOF
services:
  nobs:
    volumes:
      - $D/dl:/usr/share/nginx/html/dl
EOF
export APP_VERSION=smoke
C="docker compose -p nobs-smoke -f docker-compose.yml -f $D/override.yml"
fail() { echo "FAIL: $*" >&2; exit 1; }
trap 'rc=$?; [ "$rc" -eq 0 ] || $C logs --tail 80 >&2 || true; $C down -v >/dev/null 2>&1 || true; rm -rf "$D"' EXIT

$C up -d --build
base="http://127.0.0.1:$PORT"
curl -s -o /dev/null --retry 30 --retry-delay 1 --retry-all-errors "$base/" || fail "nothing answers on $base"

status() { curl -s -o /dev/null -w '%{http_code}' "$base$1"; }
location() { curl -s -o /dev/null -D - "$base$1" | tr -d '\r' | sed -n 's/^[Ll]ocation: //p'; }
redirects_to() { # path expected-Location
  [ "$(status "$1")" = 301 ] || fail "$base$1 does not answer 301"
  loc="$(location "$1")"
  [ "$loc" = "$2" ] || fail "$base$1 redirects to '$loc', not '$2' (a Location with a host or ':$PORT' breaks behind the proxy)"
}

for path in / /version.json /bundle-smoke.zip /some/deep/route /dl/t.apk; do
  s="$(status "$path")"
  [ "$s" = 200 ] || fail "$base$path answers $s, not 200"
done
curl -s "$base/version.json" | grep -q '+smoke"' || fail "version.json does not report the build's APP_VERSION"
# The app hands this checksum to Capgo, which refuses a bundle that does not match it.
sum="$(curl -s "$base/bundle-smoke.zip" | sha256sum | cut -d' ' -f1)"
curl -s "$base/version.json" | grep -q "\"checksum\":\"$sum\"" || fail "version.json's checksum is not the SHA-256 of the served bundle ($sum)"

# Directory URLs without the slash: relative Location, never the host or the port.
redirects_to /assets /assets/
redirects_to /dl /dl/

uids="$(docker top nobs -o pid,uid | awk 'NR>1{print $2}' | sort -u | tr '\n' ' ')"
[ "$uids" = "101 " ] || fail "the container's processes run as uid(s) $uids, not 101 alone"
$C exec -T nobs grep -q '^CapBnd:[[:space:]]*0000000000000000$' /proc/1/status || fail "capabilities are not all dropped"
$C exec -T nobs grep -q '^NoNewPrivs:[[:space:]]*1$' /proc/1/status || fail "no-new-privileges is not set"
if $C exec -T nobs sh -c 'touch /usr/share/nginx/html/written' 2>/dev/null; then fail "the files in the image are writable"; fi
$C exec -T nobs sh -c 'touch /tmp/ok' || fail "/tmp is not writable"
echo "container smoke: PASS (uid 101, read-only, caps dropped, app and OTA files served, redirects stay relative)"
