#!/bin/bash
set -euo pipefail

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

trap 'printf "FAIL: Unexpected failure at line %s (exit %s).\n" "$LINENO" "$?" >&2' ERR

for command in curl sha256sum python3 jq systemctl systemd-escape sudo; do
  command -v "$command" > /dev/null || fail "Missing test prerequisite: $command."
done
[[ -d /run/systemd/system ]] || fail 'Installation tests require a disposable Linux machine with running systemd.'

unit=$(systemd-escape --template=beluga@.service -- "$(id -un)")

for path in /usr/local/lib/beluga "$HOME/.beluga"; do
  if [[ -e "$path" || -L "$path" ]]; then
    fail "Refusing to use an existing installation or profile: $path."
  fi
done

if [[ "$(systemctl show "$unit" --property=LoadState --value)" != not-found ]]; then
  fail "Refusing to use an existing service: $unit."
fi

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
dist="$root/apps/web/dist"
archive=beluga-linux-x64.tar.gz
for file in "$archive" "$archive.sha256" install.sh; do
  [[ -r "$dist/$file" ]] || fail "Missing release file: $dist/$file. Run pnpm package first."
done

temporary=$(mktemp -d)
server=
cleanup() {
  status=$?
  trap - EXIT ERR
  if [[ -f /usr/local/lib/systemd/system/beluga@.service ]]; then
    if [[ "$status" -ne 0 ]]; then
      { sudo journalctl -u "$unit" -n 30 --no-pager; } > "$temporary/service.log" 2>&1 || true
    fi
    if ! { sudo systemctl disable --now "$unit"; } > "$temporary/cleanup.log" 2>&1; then
      printf 'FAIL: Could not stop and disable the test service %s.\n' "$unit" >&2
      status=1
    fi
  fi
  if [[ -n "$server" ]]; then
    kill "$server" 2>/dev/null || true
    wait "$server" 2>/dev/null || true
  fi
  if [[ "$status" -ne 0 ]]; then
    for log in "$temporary"/*.log; do
      if [[ -s "$log" ]]; then
        printf '\n--- %s ---\n' "${log##*/}" >&2
        sed -E 's/token=[^[:space:]]+/token=[REDACTED]/g' "$log" >&2
      fi
    done
  fi
  rm -rf -- "$temporary"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

invalid_cases=(wrong-target wrong-digest)
mkdir -p "$temporary/server" "$temporary/downloads"
ln -s "$dist" "$temporary/server/release"
ln -s "$dist/install.sh" "$temporary/server/install.sh"
for invalid in "${invalid_cases[@]}"; do
  mkdir "$temporary/server/$invalid"
  ln -s "$dist/$archive" "$temporary/server/$invalid/$archive"
done
sha256sum /dev/null > "$temporary/server/wrong-target/$archive.sha256"
printf '%064d  %s\n' 0 "$archive" > "$temporary/server/wrong-digest/$archive.sha256"

python3 - "$temporary/server" <<'PY' > "$temporary/port" 2> "$temporary/server.log" &
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

os.chdir(sys.argv[1])
with ThreadingHTTPServer(("127.0.0.1", 0), SimpleHTTPRequestHandler) as server:
    print(server.server_address[1], flush=True)
    server.serve_forever()
PY
server=$!
for _ in {1..50}; do
  [[ -s "$temporary/port" ]] && break
  sleep 0.1
done
read -r port < "$temporary/port" || fail 'The release fixture HTTP server did not report a port within 5 seconds.'
base="http://127.0.0.1:$port"

for invalid in "${invalid_cases[@]}"; do
  printf 'Checking checksum rejection: %s...\n' "$invalid"
  if curl -fsSL "$base/install.sh" |
    BELUGA_RELEASE_URL="$base/$invalid" TMPDIR="$temporary/downloads" sh > "$temporary/$invalid.log" 2>&1; then
    fail "The installer accepted the $invalid checksum fixture."
  fi
  [[ ! -e /usr/local/lib/beluga ]] || fail "The rejected $invalid release created an installation."
done

printf 'Checking one-command installation and service startup...\n'
curl -fsSL "$base/install.sh" |
  BELUGA_RELEASE_URL="$base/release" TMPDIR="$temporary/downloads" sh > "$temporary/install.log" 2>&1 ||
  fail 'One-command installation failed; see install.log below.'

[[ "$(systemctl is-enabled "$unit")" == enabled ]] || fail "$unit is not enabled for startup at boot."
[[ "$(systemctl is-active "$unit")" == active ]] || fail "$unit is not running after installation."
[[ "$(systemctl show "$unit" --property=User --value)" == "$(id -un)" ]] ||
  fail "$unit does not run as the invoking account."

url=$(grep -Eo 'https?://[^[:space:]]+' "$temporary/install.log" | tail -n 1) ||
  fail 'The installer did not print a browser authentication URL.'
printf 'Checking web authentication and the Codex model catalog...\n'
request='{"type":"client-request","rpcId":"installation-test","method":"session/modelCatalog","payload":{"args":{}}}'
api="${url%%\?*}api/session/modelCatalog"
status=$(curl -sS --max-time 30 -H 'Content-Type: application/json' --data "$request" -o /dev/null -w '%{http_code}' "$api") ||
  fail 'The API could not be reached before authentication.'
[[ "$status" == 401 || "$status" == 403 ]] ||
  fail "Unauthenticated API access returned HTTP $status instead of 401 or 403."

content_type=$(curl -fsSL --max-time 30 -c "$temporary/cookies" -b "$temporary/cookies" \
  -o "$temporary/index.html" -w '%{content_type}' "$url") ||
  fail 'The printed browser authentication URL did not open successfully.'
[[ "$content_type" == text/html* ]] || fail "Authenticated web access returned $content_type instead of HTML."
[[ -s "$temporary/index.html" ]] || fail 'Authenticated web access returned an empty page.'
curl -fsS --max-time 30 -b "$temporary/cookies" -H 'Content-Type: application/json' --data "$request" "$api" > "$temporary/catalog.log" ||
  fail 'The authenticated model-catalog request failed.'
jq -e '.result.ok == true and any(.result.value.groups[]; .id == "openai-codex")' "$temporary/catalog.log" > /dev/null ||
  fail 'The model catalog did not return a successful result containing the Codex provider.'
[[ -z "$(find "$temporary/downloads" -mindepth 1 -print -quit)" ]] ||
  fail 'The installer left temporary downloads behind.'

echo 'Checksum rejection, one-command installation, service startup, and authenticated web/API access passed.'
