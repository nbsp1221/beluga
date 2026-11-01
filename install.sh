#!/bin/sh
set -eu

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

main() {
  if [ "${1:-}" = --help ]; then
    printf '%s\n' 'Usage: sh install.sh'
    return
  fi

  [ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] ||
    fail 'This package supports Linux x64 only.'
  for command in curl sha256sum awk tar mktemp; do
    command -v "$command" >/dev/null || fail "Install the prerequisite: $command."
  done

  [ "$#" -eq 0 ] || fail 'Usage: sh install.sh'

  release_url=${BELUGA_RELEASE_URL:-https://github.com/nbsp1221/beluga/releases/latest/download}
  archive=beluga-linux-x64.tar.gz
  temporary=$(mktemp -d)
  trap 'rm -rf -- "$temporary"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  printf '%s\n' 'Downloading Beluga...'
  curl -fSL --retry 3 --connect-timeout 10 --max-time 600 \
    "$release_url/$archive" -o "$temporary/$archive"
  curl -fsSL --retry 3 --connect-timeout 10 --max-time 60 \
    "$release_url/$archive.sha256" -o "$temporary/$archive.sha256"

  printf '%s\n' 'Verifying the download...'
  # Verify this archive even if the manifest names other paths.
  digest=$(awk -v name="$archive" '$2 == name { print $1 }' "$temporary/$archive.sha256")
  (cd "$temporary" && printf '%s  %s\n' "$digest" "$archive" | sha256sum --check --strict -)
  tar -xzf "$temporary/$archive" -C "$temporary"

  sh "$temporary/beluga/install.sh"
}

main "$@"
