# Repository guide

## Structure

- `apps/web/src/main.ts` launches the DSH web profile.
- `apps/web/src/profile.ts` discovers bundled plugins from direct runtime dependencies and prepares the profile through DSH's public APIs and CLI.
- `apps/web/scripts/package.ts` uses `pnpm deploy --prod` to assemble a Linux x64 archive with pinned runtimes. Build on the target platform for native dependencies.
- `apps/web/packaging/` contains the Ubuntu installer and systemd service template. Keep OS installation separate from the application launcher and user data.
- Root `install.sh` downloads and verifies release assets, then delegates to the packaged installer. `BELUGA_RELEASE_URL` selects a release asset base URL for mirrors or pinned releases.
- `scripts/test-install.sh` verifies the built release through the public installer, systemd, and authenticated web APIs.
- `packages/` contains shared lint, formatting, TypeScript, and Vitest configuration.

## Changes

- Use TypeScript for application code. Prefer existing DSH plugins and public extension points; do not patch installed dependencies.
- Keep one definition for each product setting. Reuse it across startup and tests.
- Remove replaced code and update its callers. Add compatibility behavior only for a concrete requirement; preserve user data.
- Keep abstractions proportional to current use. Investigate the cause of a failure before adding a workaround.
- Group code by purpose, with a blank line when the purpose changes. Keep closely related statements together; do not space every statement mechanically.
- Keep text files in UTF-8 with LF and a final newline. `.gitattributes` controls Git normalization; `.editorconfig` controls editor defaults and must agree with the shared formatter.
- Review the whole changed function for readable flow and unnecessary structure. Passing lint and formatting checks does not establish readability.
- Manage bundled plugin versions through package manifests and the lockfile. Keep credentials and machine-specific configuration out of the repository.
- `.node-version` pins the packaged Node.js runtime; `packageManager` pins pnpm. Verify official download checksums and keep packaging output in ignored `dist/` directories.
- Confirm startup through DSH's documented ready-URL announcement for the current systemd invocation. Do not couple installation to an optional plugin or a fixed web port.
- Keep recovery failures explicit and retain installer state when recovery cannot complete. Preserve user-managed service drop-ins and application data.
- The launcher forwards termination to DSH. Keep systemd's initial stop signal directed at the launcher only, while retaining group cleanup for processes that do not exit.
- Direct runtime dependencies declaring `dsh.bundle.patch` are product plugins. Only profile links into this application's `node_modules` are product-owned; preserve other plugins and user activation choices.

## Verification

- Use the pnpm version in `package.json` and run `pnpm check` after changes.
- Run `pnpm --filter @repo/web test` for focused integration tests, or `pnpm test` for all packages.
- Root lint and format commands check the repository; package scripts own type checks and tests. Share configuration through `packages/`.
- Keep checks read-only. Run automatic fixes separately, then review the diff.
- Test observable contracts and important failure paths. Avoid tests that repeat implementation details or add coverage without meaningful risk.
- Initialize DSH integration fixtures through its public CLI in unique OS temporary directories. Clean up owned files and subprocesses.
- Routine tests must not use real credentials, call model APIs, modify user profiles, or change the repository lockfile.
- Validate installer changes in a disposable Ubuntu VM using real systemd. A service restart or container restart does not prove machine-reboot behavior. Check shell scripts with ShellCheck.
- Run `pnpm test:install` only on a disposable Ubuntu 24.04 machine after `pnpm package`. It refuses an existing installation, profile, or service. Keep it separate from routine `pnpm check` and `pnpm test`.
- Check for active verification runs before starting a whole suite. Preserve running development servers and unrelated processes.

## Documentation

- Keep public documentation in English. README covers product installation and usage, not development status or experiment results; this file covers repository work.
- Keep private research, experiment logs, and personal context outside the repository.
- Record non-obvious decisions and evidence in the relevant review. Prefer established conventions when no project constraint justifies an exception.

## CI and releases

- CI runs `pnpm check` on Linux and Windows; Linux also builds and installs the release in its disposable runner. Keep Node and pnpm versions in `.node-version` and `packageManager`, not workflow inputs.
- Releases call the same CI workflow. Set `apps/web/package.json`'s version before pushing the matching `vVERSION` tag. Tags with a prerelease suffix create prereleases and do not replace the stable installer.
- Publish only the verified Linux archive, checksum, and installer to GitHub Releases. Keep repository write permission confined to the publishing job and pin external actions to immutable revisions.
