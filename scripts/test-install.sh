#!/bin/bash
set -euo pipefail

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

trap 'printf "FAIL: Unexpected failure at line %s (exit %s).\n" "$LINENO" "$?" >&2' ERR

for command in curl sha256sum python3 jq systemctl loginctl; do
  command -v "$command" > /dev/null || fail "Missing test prerequisite: $command."
done
[[ -d /run/systemd/system ]] || fail 'Installation tests require a disposable Linux machine with running systemd.'

unit=beluga.service
destination="$HOME/.local/lib/beluga"
unit_file="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$unit"

for path in "$destination" "$HOME/.beluga"; do
  if [[ -e "$path" || -L "$path" ]]; then
    fail "Refusing to use an existing installation or profile: $path."
  fi
done

if [[ "$(systemctl --user show "$unit" --property=LoadState --value)" != not-found ]]; then
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
  if [[ -f "$unit_file" ]]; then
    if [[ "$status" -ne 0 ]]; then
      { journalctl --user -u "$unit" -n 30 --no-pager; } > "$temporary/service.log" 2>&1 || true
    fi
    if ! { systemctl --user disable --now "$unit"; } > "$temporary/cleanup.log" 2>&1; then
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
  [[ ! -e "$destination" ]] || fail "The rejected $invalid release created an installation."
done

if [[ "$(loginctl show-user "$(id -un)" --property=Linger --value)" == yes ]]; then
  mkdir "$temporary/bin"
  cat > "$temporary/bin/sudo" <<'SH'
#!/bin/sh
echo 'Unexpected administrator request: lingering is already enabled.' >&2
exit 1
SH
  chmod +x "$temporary/bin/sudo"
  export PATH="$temporary/bin:$PATH"
fi

printf 'Checking one-command installation and service startup...\n'
curl -fsSL "$base/install.sh" |
  BELUGA_RELEASE_URL="$base/release" TMPDIR="$temporary/downloads" sh > "$temporary/install.log" 2>&1 ||
  fail 'One-command installation failed; see install.log below.'

[[ "$(systemctl --user is-enabled "$unit")" == enabled ]] || fail "$unit is not enabled for startup at boot."
[[ "$(systemctl --user is-active "$unit")" == active ]] || fail "$unit is not running after installation."
pid=$(systemctl --user show "$unit" --property=MainPID --value)
[[ "$(ps -p "$pid" -o uid= | tr -d '[:space:]')" == "$(id -u)" ]] ||
  fail "$unit does not run as the invoking account."
[[ "$(loginctl show-user "$(id -un)" --property=Linger --value)" == yes ]] ||
  fail 'User services are not configured to survive logout and start at boot.'

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

rpc() {
  local method=$1 args=$2 body
  body=$(jq -cn --arg method "$method" --argjson args "$args" \
    '{type:"client-request",rpcId:"installation-test",method:$method,payload:{args:$args}}')
  curl -fsS --max-time 30 -b "$temporary/cookies" -H 'Content-Type: application/json' \
    --data "$body" "${url%%\?*}api/$method"
}

printf 'Checking reinstallation preserves a saved conversation...\n'
mkdir "$temporary/project"
args=$(jq -cn --arg cwd "$temporary/project" '{request:{cwd:$cwd}}')
session=$(rpc session/create "$args" | jq -er 'select(.result.ok == true).result.value.sessionId') ||
  fail 'Could not create the conversation preservation fixture.'
args=$(jq -cn --arg id "$session" '{request:{sessionId:$id,title:"Keep this conversation"}}')
rpc session/rename "$args" | jq -e '.result.ok == true' > /dev/null ||
  fail 'Could not save the conversation title.'
export_url="${url%%\?*}api/session.export?sessionId=$session&includeDescendants=false"
curl -fsS --max-time 30 -b "$temporary/cookies" "$export_url" -o "$temporary/before.zip" ||
  fail 'Could not export the original conversation.'

curl -fsSL "$base/install.sh" |
  BELUGA_RELEASE_URL="$base/release" TMPDIR="$temporary/downloads" sh > "$temporary/reinstall.log" 2>&1 ||
  fail 'Reinstallation failed; see reinstall.log below.'
curl -fsS --max-time 30 -b "$temporary/cookies" "$export_url" -o "$temporary/after.zip" ||
  fail 'The original browser authentication or conversation was lost after reinstallation.'
python3 - "$temporary/before.zip" "$temporary/after.zip" <<'PY' || fail 'The saved conversation changed during reinstallation.'
import json
import sys
from zipfile import ZipFile

def events(path):
    with ZipFile(path) as archive:
        logs = [name for name in archive.namelist() if name.endswith(".jsonl")]
        assert len(logs) == 1, f"Expected one conversation log, got {logs}"
        return [json.loads(line) for line in archive.read(logs[0]).splitlines()]

before, after = map(events, sys.argv[1:])
assert after[:len(before)] == before, "Original conversation events were lost or modified"
PY
[[ -z "$(find "$temporary/downloads" -mindepth 1 -print -quit)" ]] ||
  fail 'The installer left temporary downloads behind.'

echo 'Checksums, user-service startup, web authentication, and conversation preservation through reinstallation passed.'
