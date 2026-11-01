#!/bin/sh
set -eu

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

if [ "${1:-}" = --help ]; then
  printf '%s\n' 'Usage: sudo sh ./beluga/install.sh --user USER'
  exit 0
fi

if [ "$#" -ne 2 ] || [ "$1" != --user ]; then
  fail 'Specify the service account with --user USER.'
fi

user=$2
[ "$(id -u)" -eq 0 ] || fail 'Run the installer with sudo.'
service_uid=$(id -u -- "$user") || fail "Service account $user does not exist."
if [ "$service_uid" -eq 0 ]; then
  printf '%s\n' 'Warning: Beluga will run as root; agents will have full system privileges.' >&2
fi

[ "$(uname -m)" = x86_64 ] || fail 'This package supports Linux x64 only.'

[ -d /run/systemd/system ] || fail 'A running systemd system manager is required.'
for command in systemctl systemd-escape journalctl flock; do
  command -v "$command" >/dev/null || fail "Install the prerequisite: $command."
done

exec 9>/run/beluga-install.lock
flock --nonblock 9 || fail 'Another Beluga installation is running.'

source=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
destination=/usr/local/lib/beluga
unit=$(systemd-escape --template=beluga@.service -- "$user")
unit_file=/usr/local/lib/systemd/system/beluga@.service

if [ ! -x "$source/bin/beluga" ] ||
  [ ! -x "$source/runtime/bin/node" ] ||
  [ ! -f "$source/systemd/beluga@.service" ]; then
  fail 'The extracted release is incomplete.'
fi
if [ -e "$destination" ] || [ -L "$destination" ]; then
  if [ ! -d "$destination" ] ||
    [ -L "$destination" ] ||
    [ ! -f "$destination/app/package.json" ]; then
    fail 'The installation path is not a Beluga installation.'
  fi
fi

instances=$(systemctl list-units 'beluga@*.service' --state=active,activating,deactivating,reloading --plain --no-legend)
printf '%s\n' "$instances" | while read -r instance _rest; do
  if [ -n "$instance" ] && [ "$instance" != "$unit" ]; then
    fail "Stop $instance before replacing shared Beluga program files."
  fi
done

was_active=false
was_enabled=false
if systemctl is-enabled --quiet "$unit"; then
  was_enabled=true
fi
if systemctl is-active --quiet "$unit"; then
  was_active=true
fi

wait_ready() {
  invocation=$(systemctl show "$unit" --property=InvocationID --value) || return 1
  [ -n "$invocation" ] || return 1

  deadline=$(( $(date +%s) + 120 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    systemctl is-active --quiet "$unit" || return 1
    # DSH publishes this signal after its required startup audit has passed.
    browser_url=$(journalctl "_SYSTEMD_INVOCATION_ID=$invocation" --output=cat --no-pager |
      awk '/^dsh web: https?:\/\// { print $3; exit }')
    if [ -n "$browser_url" ]; then
      return 0
    fi
    sleep 2
  done

  return 1
}

restore_previous() {
  if [ "$(systemctl show "$unit" --property=LoadState --value)" != not-found ]; then
    systemctl stop "$unit" || return 1
  fi

  if [ -d "$staging/previous" ]; then
    rm -rf -- "$destination" && mv -- "$staging/previous" "$destination" || return 1
  elif [ ! -d "$staging/package" ]; then
    rm -rf -- "$destination" || return 1
  fi

  if [ "$was_enabled" = false ] && [ -f "$unit_file" ]; then
    systemctl disable "$unit" || return 1
  fi
  if [ -f "$staging/previous.service" ]; then
    cp -- "$staging/previous.service" "$unit_file" || return 1
  else
    rm -f -- "$unit_file" || return 1
  fi

  systemctl daemon-reload || return 1
  if [ "$was_active" = true ]; then
    systemctl start "$unit" && wait_ready || return 1
  fi
}

mkdir -p /usr/local/lib
staging=$(mktemp -d /usr/local/lib/.beluga-install.XXXXXX)
updating=false
complete=false

cleanup() {
  status=$?
  trap - EXIT
  if [ "$complete" = false ] && [ "$updating" = true ]; then
    if restore_previous; then
      printf '%s\n' 'Installation failed; program changes were reverted. User data was preserved.' >&2
    else
      printf '%s\n' "Recovery is incomplete. Installer state was retained at $staging; inspect the service journal." >&2
      exit 1
    fi
  fi

  rm -rf -- "$staging"
  exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir "$staging/package"
cp -R -- "$source/." "$staging/package/"
if [ -f "$unit_file" ]; then
  cp -- "$unit_file" "$staging/previous.service"
fi

updating=true
if [ "$was_active" = true ]; then
  systemctl stop "$unit"
fi
if [ -e "$destination" ]; then
  mv -- "$destination" "$staging/previous"
fi
mv -- "$staging/package" "$destination"

install -D -m 644 "$destination/systemd/beluga@.service" "$unit_file"
systemctl daemon-reload
systemctl enable --now "$unit"

if ! wait_ready; then
  journalctl -u "$unit" -n 30 --no-pager >&2
  fail 'Beluga did not become ready.'
fi
systemctl is-active --quiet "$unit" || fail 'Beluga stopped during startup.'
complete=true

printf '\nInstalled %s. It starts at boot without an interactive login.\n' "$unit"
printf '\nOpen in your browser:\n  %s\n\n' "$browser_url"
printf '%s\n' "Status: sudo systemctl status '$unit'" "Logs: sudo journalctl -u '$unit' -n 30 --no-pager"
printf '%s\n' 'Data stays in the service account home under ~/.beluga.' 'Remote access remains configured through Settings > Reverse proxy.'
