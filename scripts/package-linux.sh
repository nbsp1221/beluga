#!/bin/sh
set -eu

version=${1:?Usage: sh scripts/package-linux.sh VERSION OUTPUT_DIRECTORY}
output=${2:?Specify an output directory}
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
case "$(uname -sm)" in
  'Linux x86_64') ;;
  *) echo 'Build the Linux package on Linux x64.' >&2; exit 1 ;;
esac
case "$version" in
  ''|*[!0-9A-Za-z.-]*) echo 'Invalid release version.' >&2; exit 1 ;;
esac
mkdir -p "$output"
output=$(cd "$output" && pwd)
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
bundle="$scratch/beluga"
mkdir -p "$bundle/runtime"
node_version=24.22.2
node_archive="node-v$node_version-linux-x64.tar.xz"
curl -fsSL "https://nodejs.org/dist/v$node_version/$node_archive" -o "$scratch/$node_archive"
(
  cd "$scratch"
  printf '%s  %s\n' '48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75' "$node_archive" | sha256sum -c
  tar -xJf "$node_archive" -C "$bundle/runtime" --strip-components=1
)
cd "$root"
pnpm exec turbo run build --filter=@workspace/host --filter=web
pnpm --filter @workspace/host --config.node-linker=hoisted --config.inject-workspace-packages=true deploy --prod "$bundle/host"
cp -R apps/web/dist "$bundle/web"
cp LICENSE THIRD_PARTY_NOTICES.md "$bundle/"
cp packages/client/node_modules/@flue/sdk/LICENSE "$bundle/FLUE-SDK-LICENSE.txt"
printf '%s\n' "$version" > "$bundle/VERSION"
"$bundle/runtime/bin/node" "$bundle/host/dist/main.js" --help
name=beluga-linux-x64.tar.gz
tar -czf "$output/$name" -C "$scratch" beluga
(
  cd "$output"
  sha256sum "$name" > "$name.sha256"
)
cp "$root/scripts/install-linux.sh" "$output/install.sh"
