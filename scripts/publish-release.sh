#!/usr/bin/env bash
set -euo pipefail

version=$(node -p 'require("./package.json").version')
tag="v$version"
image="ghcr.io/${GH_REPO,,}:$version"
assets=(
  dist/linux/install.sh
  dist/linux/beluga-linux-x64.tar.gz
  dist/linux/beluga-linux-x64.tar.gz.sha256
  dist/windows/beluga-windows-x64-portable.zip
  dist/windows/beluga-windows-x64-portable.zip.sha256
  "dist/windows/Beluga_${version}_x64-setup.exe"
  "dist/windows/Beluga_${version}_x64-setup.exe.sha256"
)

for asset in "${assets[@]}"; do test -s "$asset"; done
for asset in "${assets[@]}"; do
  if [[ "$asset" = *.sha256 ]]; then
    expected=$(tr -d '\r' < "$asset")
    actual=$(cd "$(dirname "$asset")" && sha256sum "$(basename "${asset%.sha256}")")
    test "$actual" = "$expected"
  fi
done
test "$(tar -xOf dist/linux/beluga-linux-x64.tar.gz beluga/VERSION)" = "$version"
awk -v title="## $version" '$0==title {found=1; next} found && /^## / {exit} found {print}' CHANGELOG.md > dist/notes.md
grep -q '[^[:space:]]' dist/notes.md
printf '\nDocker: `%s`\n' "$image" >> dist/notes.md

if existing=$(gh release view "$tag" --json isDraft --jq .isDraft 2>&1); then
  test "$existing" = true
else
  grep -qi 'release not found' <<< "$existing"
fi
remote=$(git ls-remote origin "refs/tags/$tag" "refs/tags/$tag^{}")
if [[ -n "$remote" ]]; then
  target=$(awk 'END {print $1}' <<< "$remote")
  test "$target" = "$RELEASE_SHA"
fi

docker load --input dist/container/beluga-image.tar
local_image=beluga:release-candidate
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$local_image")" = "$RELEASE_SHA"
test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$local_image")" = linux/amd64
image_id=$(docker image inspect --format '{{.Id}}' "$local_image")
export DOCKER_CONFIG
DOCKER_CONFIG=$(mktemp -d)
anonymous_config=$(mktemp -d)
trap 'rm -rf -- "$DOCKER_CONFIG" "$anonymous_config"' EXIT
printf '%s' "$GH_TOKEN" | docker login ghcr.io --username "$GITHUB_ACTOR" --password-stdin
if inspect=$(docker buildx imagetools inspect --raw "$image" 2>&1); then
  test "$(jq -er .config.digest <<< "$inspect")" = "$image_id"
elif grep -Eiq 'not found|manifest unknown' <<< "$inspect"; then
  docker tag "$local_image" "$image"
  docker push "$image"
else
  printf '%s\n' "$inspect" >&2
  exit 1
fi
if ! DOCKER_CONFIG="$anonymous_config" docker pull "$image"; then
  echo 'Anonymous pull failed. Check package visibility and rerun this job.'
  exit 1
fi
test "$(docker image inspect --format '{{.Id}}' "$image")" = "$image_id"
docker image inspect --format '{{join .RepoDigests ", "}}' "$image"

if [[ -z "$remote" ]]; then
  git tag "$tag" "$RELEASE_SHA"
  git push origin "refs/tags/$tag"
fi
if [[ "${existing:-}" = true ]]; then
  gh release upload "$tag" "${assets[@]}" --clobber
else
  flags=(--draft --verify-tag --title "Beluga $tag" --notes-file dist/notes.md)
  if [[ "$version" = *-* ]]; then flags+=(--prerelease); fi
  gh release create "$tag" "${assets[@]}" "${flags[@]}"
fi
gh release edit "$tag" --draft=false
