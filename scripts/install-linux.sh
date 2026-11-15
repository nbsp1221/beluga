#!/bin/sh
set -eu

fail() { printf '%s\n' "$*" >&2; exit 1; }

version=${1:?Usage: sh install.sh VERSION [--boot|--no-boot]}
boot=${2:-}
[ "$#" -le 2 ] || fail 'Usage: sh install.sh VERSION [--boot|--no-boot]'
case "$version" in
  ''|*[!0-9A-Za-z.-]*|.|..) fail 'Invalid release version.' ;;
esac
case "$boot" in
  ''|--boot|--no-boot) ;;
  *) fail 'Choose --boot or --no-boot.' ;;
esac
[ "$(id -u)" -ne 0 ] || fail 'Run the installer as your regular user.'
[ "$(uname -sm)" = 'Linux x86_64' ] || fail 'This package supports Linux x64.'
for command in cmp curl sha256sum tar flock systemctl systemd-notify loginctl; do
  command -v "$command" >/dev/null || fail "Install $command before continuing."
done
systemctl --user show-environment >/dev/null || fail 'A systemd user session is required.'

umask 077
install_dir="$HOME/.local/lib/beluga"
data_dir="$HOME/.local/share/beluga"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unit=beluga.service
mkdir -p "$install_dir/releases" "$units"
exec 9>"$install_dir/install.lock"
flock -n 9 || fail 'Another Beluga installation is running.'
scratch=$(mktemp -d "$install_dir/.install.XXXXXX")
trap 'rm -rf -- "$scratch"' EXIT

archive=beluga-linux-x64.tar.gz
release="https://github.com/nbsp1221/beluga/releases/download/v$version"
curl -fsSL "$release/$archive" -o "$scratch/$archive"
curl -fsSL "$release/$archive.sha256" -o "$scratch/$archive.sha256"
(cd "$scratch" && test "$(sha256sum "$archive")" = "$(cat "$archive.sha256")")
tar -xzf "$scratch/$archive" -C "$scratch"
[ "$(cat "$scratch/beluga/VERSION")" = "$version" ] || fail 'The archive version does not match.'
target="$install_dir/releases/$version"
if [ ! -d "$target" ]; then
  mv "$scratch/beluga" "$target"
fi
if [ ! -f "$data_dir/access-code.json" ]; then
  "$target/runtime/bin/node" "$target/host/dist/main.js" auth init --data-dir "$data_dir"
fi

unit_path="$units/$unit"
# Fingerprint of the original generated Type=exec unit, including its default origin.
original_unit_sha256=8c8de56a7daec348a3923b268ad2ab30235cd15ad979e2756df12c2ceb77ad17
if [ ! -L "$unit_path" ] && [ -f "$unit_path" ] &&
  [ "$(sha256sum < "$unit_path")" = "$original_unit_sha256  -" ]; then
  cp -p "$unit_path" "$scratch/previous.service"
fi
if { [ ! -e "$unit_path" ] && [ ! -L "$unit_path" ]; } || [ -f "$scratch/previous.service" ]; then
  cat > "$scratch/new.service" <<'UNIT'
[Unit]
Description=Beluga Host

[Service]
Type=notify
NotifyAccess=all
TimeoutStartSec=30s
WorkingDirectory=%h
ExecStart="%h/.local/lib/beluga/current/runtime/bin/node" "%h/.local/lib/beluga/current/host/dist/main.js" serve --data-dir "%h/.local/share/beluga" --web-dir "%h/.local/lib/beluga/current/web"
Restart=on-failure
RestartSec=5s
UMask=0077

[Install]
WantedBy=default.target
UNIT
  if [ -f "$scratch/previous.service" ]; then
    cmp -s "$scratch/previous.service" "$unit_path" || fail 'The Beluga unit changed during installation.'
  fi
  mv -fT "$scratch/new.service" "$unit_path"
fi

restore_unit() {
  if [ -f "$scratch/previous.service" ]; then
    mv -fT "$scratch/previous.service" "$unit_path"
    systemctl --user daemon-reload
  fi
}

if ! systemctl --user daemon-reload ||
  [ "$(systemctl --user show --property=Type --value "$unit")" != notify ] ||
  [ "$(systemctl --user show --property=NotifyAccess --value "$unit")" != all ]; then
  restore_unit
  fail 'Set Type=notify and NotifyAccess=all in your Beluga service before installing.'
fi
previous=$(readlink "$install_dir/current" || true)
switch_release() {
  ln -s "$1" "$scratch/current" &&
  mv -Tf "$scratch/current" "$install_dir/current"
}
if ! switch_release "$target"; then
  restore_unit
  fail 'Could not switch to the new Beluga build.'
fi
if ! systemctl --user restart "$unit"; then
  if [ -n "$previous" ]; then
    switch_release "$previous"
    restore_unit
    if ! systemctl --user restart "$unit"; then
      fail 'The previous build did not become ready. Check the service logs.'
    fi
  else
    systemctl --user stop "$unit"
    restore_unit
    rm -f -- "$install_dir/current"
  fi
  fail 'Beluga did not become ready. Check: journalctl --user -u beluga.service'
fi

if [ -z "$boot" ] && [ -r /dev/tty ] && [ -w /dev/tty ] && ( : </dev/tty ) 2>/dev/null; then
  printf 'Start Beluga at boot and keep it running after logout? [y/N] ' >/dev/tty
  read -r answer </dev/tty || answer=
  case "$answer" in y|Y|yes|YES) boot=--boot ;; esac
fi
if [ "$boot" = --boot ]; then
  loginctl enable-linger "$(id -un)"
  systemctl --user enable "$unit"
fi
printf '%s\n' "Beluga $version is running." \
  'Local address for a new installation: http://127.0.0.1:8917' \
  'Service status: systemctl --user status beluga.service'
