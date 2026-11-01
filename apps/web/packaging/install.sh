#!/bin/sh
set -eu

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

if [ "${1:-}" = --help ]; then
  printf '%s\n' 'Usage: sh ./install.sh'
  exit 0
fi

[ "$#" -eq 0 ] || fail 'Usage: sh ./install.sh'

user=$(id -un)
if [ "$(id -u)" -eq 0 ]; then
  printf '%s\n' 'Warning: Beluga will run as root; agents will have full system privileges.' >&2
fi

[ "$(uname -m)" = x86_64 ] || fail 'This package supports Linux x64 only.'

[ -d /run/systemd/system ] || fail 'A running systemd system manager is required.'
for command in systemctl loginctl journalctl flock; do
  command -v "$command" >/dev/null || fail "Install the prerequisite: $command."
done

source=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
destination="$HOME/.local/lib/beluga"
unit=beluga.service
unit_file="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$unit"

if [ ! -x "$source/bin/beluga" ] ||
  [ ! -x "$source/runtime/bin/node" ] ||
  [ ! -f "$source/systemd/$unit" ]; then
  fail 'The extracted release is incomplete.'
fi
if [ -e "$destination" ] || [ -L "$destination" ]; then
  if [ ! -d "$destination" ] ||
    [ -L "$destination" ] ||
    [ ! -f "$destination/app/package.json" ]; then
    fail 'The installation path is not a Beluga installation.'
  fi
fi

if [ "$(loginctl show-user "$user" --property=Linger --value)" != yes ]; then
  if ! loginctl enable-linger "$user"; then
    command -v sudo >/dev/null || fail "Enable boot startup with: loginctl enable-linger $user"
    sudo loginctl enable-linger "$user"
  fi
fi
systemctl --user show-environment >/dev/null || fail 'A running systemd user manager is required.'

mkdir -p "$HOME/.local/lib"
exec 9>"$HOME/.local/lib/beluga-install.lock"
flock --nonblock 9 || fail 'Another Beluga installation is running.'

was_active=false
was_enabled=false
if systemctl --user is-enabled --quiet "$unit"; then
  was_enabled=true
fi
if systemctl --user is-active --quiet "$unit"; then
  was_active=true
fi

wait_ready() {
  invocation=$(systemctl --user show "$unit" --property=InvocationID --value) || return 1
  [ -n "$invocation" ] || return 1

  deadline=$(( $(date +%s) + 120 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    systemctl --user is-active --quiet "$unit" || return 1
    # DSH publishes this signal after its required startup audit has passed.
    browser_url=$(journalctl --user "_SYSTEMD_INVOCATION_ID=$invocation" --output=cat --no-pager |
      awk '/^dsh web: https?:\/\// { print $3; exit }')
    if [ -n "$browser_url" ]; then
      return 0
    fi
    sleep 2
  done

  return 1
}

restore_previous() {
  if [ "$(systemctl --user show "$unit" --property=LoadState --value)" != not-found ]; then
    systemctl --user stop "$unit" || return 1
  fi

  if [ -d "$staging/previous" ]; then
    rm -rf -- "$destination" && mv -- "$staging/previous" "$destination" || return 1
  elif [ ! -d "$staging/package" ]; then
    rm -rf -- "$destination" || return 1
  fi

  if [ "$was_enabled" = false ] && [ -f "$unit_file" ]; then
    systemctl --user disable "$unit" || return 1
  fi
  if [ -f "$staging/previous.service" ]; then
    cp -- "$staging/previous.service" "$unit_file" || return 1
  else
    rm -f -- "$unit_file" || return 1
  fi

  systemctl --user daemon-reload || return 1
  if [ "$was_active" = true ]; then
    systemctl --user start "$unit" && wait_ready || return 1
  fi
}

staging=$(mktemp -d "$HOME/.local/lib/.beluga-install.XXXXXX")
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
  systemctl --user stop "$unit"
fi
if [ -e "$destination" ]; then
  mv -- "$destination" "$staging/previous"
fi
mv -- "$staging/package" "$destination"

install -D -m 644 "$destination/systemd/$unit" "$unit_file"
systemctl --user daemon-reload
systemctl --user enable --now "$unit"

if ! wait_ready; then
  journalctl --user -u "$unit" -n 30 --no-pager >&2
  fail 'Beluga did not become ready.'
fi
systemctl --user is-active --quiet "$unit" || fail 'Beluga stopped during startup.'
complete=true

printf '\nInstalled %s. It starts at boot without an interactive login.\n' "$unit"
printf '\nOpen in your browser:\n  %s\n\n' "$browser_url"
printf '%s\n' "Status: systemctl --user status $unit" "Logs: journalctl --user -u $unit -n 30 --no-pager"
printf '%s\n' 'Data stays in ~/.beluga.' 'Remote access remains configured through Settings > Reverse proxy.'
