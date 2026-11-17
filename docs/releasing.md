---
status: current
owner: maintainers
last_reviewed: 2026-11-17
---

# Release verification

Add a Changeset for user-facing changes with `pnpm exec changeset` and select `@retn0/beluga`, including for changes that affect Windows or Docker. [Version](../.github/workflows/version.yml) prepares a separate PR for the next version and [changelog](../apps/cli/CHANGELOG.md). The [CLI manifest](../apps/cli/package.json) owns the version shared by npm, Windows and Docker. Internal packages follow the repository source revision. `pnpm release:check` checks the packaged Node and pnpm versions against the repository pins.

The release PR is the approval to publish. If its checks await workflow approval, select **Approve workflows to run** on the PR. Use the checks below to verify the affected install paths before merging it.

Windows CI prepares the Desktop Host sidecar and checks the Rust shell. The release workflow builds and checks the installer and portable bundle.

When the product version changes on `main`, [CI](../.github/workflows/ci.yml) runs
its Windows and Linux checks. If they pass, [Release](../.github/workflows/release.yml)
packages the same commit. The workflow publishes `@retn0/beluga` to npm,
the image to GitHub Container Registry, and the Windows bundles and checksums
to GitHub Releases.

To build the current `main` version again, select **Run workflow** in **CI** and
enable **Build release candidate after CI**. This manual build creates a fresh set of artifacts for verification.

Preview builds use the npm `preview` dist-tag and GitHub's **Pre-release** flag. Keep container references versioned.

To prepare a stable release, confirm the Git tag is available and update the stable install instructions. Run `pnpm exec changeset pre exit` and merge the prerelease state change. Changesets uses the archived and pending product changes to prepare the stable release PR. If there are no product Changesets yet, include one describing the stable release in the same PR as the state change.

## First publication

Build and review the candidate from `main` using the manual CI option above. Publish the verified npm tarball with `npm publish <tarball> --tag preview` using the npm account authorized for `@retn0`. On the package's npm settings, authorize `nbsp1221/beluga`, caller workflow `ci.yml`, for direct publication through [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/). Verify that the exact package installs from npm. Push the candidate image by its version, set the GHCR package visibility to public and verify anonymous pull. Tag that same commit and create the GitHub prerelease with the verified Windows assets and checksums.

Ship the unsigned Windows portable ZIP and optional NSIS installer with their SHA-256 checksums. Keep the download guide explicit about the signing status and Windows restrictions.

## Verify the Host

- Start with a clean account and the documented prerequisites. Install the npm tarball into that account's npm prefix. Check that `beluga service install` prints the first access code and starts the service under that account. Check that project files and unrelated services are untouched.
- Sign in with the access code, connect a provider, add a project and send two messages without reloading. Repeat through HTTPS from a different computer. Check that each response finishes and appears in **Trajectory**.
- In a disposable project, exercise Read only, Workspace write and Full access with the Standard preset. Check tool calls, command cancellation and the corresponding Trajectory records.
- Restart the Host and check that the same browser session, workspace, provider and chat are available. With `--boot`, verify that the service survives logout and starts after reboot without an interactive login. Without `--boot`, verify that the service starts and leaves the account's lingering setting intact.
- Test a repeat install, an update and a failed update against a populated data directory. Verify that the access code and user data are preserved. Verify the documented recovery procedure with a copy of that data. Test program removal separately from data deletion.

## Verify desktop assets

Extract the portable ZIP and run the optional installer on separate clean systems. For each bundle, open the local Host, connect to a private HTTP Host and an HTTPS Host, send a message on each, and return to **This computer**. Check that closing the window leaves local work running in the tray and **Exit** stops it. Check that exiting the desktop app leaves independent remote work running.

## Verify the Docker image

- Pull the versioned image on a clean Docker host. Follow the published steps for the data volume, project mount and model credentials. Verify that the documented proxy can reach the container and that the Host is reachable only through the intended network path.
- Confirm that the official image includes Beluga's runtime dependencies and contains neither the Codex CLI nor account credentials. Verify an OpenAI-compatible connection with no Codex mount. For the Codex examples, verify that Beluga can use the supplied login and pick up an externally renewed login without replacing the Beluga container.
- Sign in through the documented HTTPS connection. Open the mounted project and check a file edit, a shell command and the corresponding Trajectory records.
- Replace the container with the same volume and project mount. Check that the access code, provider settings, workspace and conversations still work. Test the documented update and recovery procedure with a copy of the volume.

## Verify the published instructions

- CI installs and runs the npm CLI from its tarball, checks the Windows bundles and verifies the Docker runtime. For manual install checks, use artifacts from the same CI run and verify the Windows checksums before use.
- Check that each artifact includes the Beluga license and the applicable third-party notices and license files.
- Keep release notes focused on supported installs, changes users will see, and any action required before updating.
- After publishing, verify the Windows download links, install via the npm `preview` dist-tag, and confirm that the published Docker tag resolves to the tested image.

## Recover a publication

The npm publish job runs before publishing the GitHub Release. The GitHub publish job verifies the Windows checksums and publishes the image to GHCR. After an anonymous pull succeeds, it tags the candidate commit and publishes the GitHub Release with the Windows assets and changelog.

Use **Re-run failed jobs** for transient failures and external configuration changes. This reuses the original workflow revision and skips publishing the npm tarball a second time when that job already passed.

If the publishing code needs a fix, merge the fix with a Changesets entry, then merge the release PR for the next version. CI builds the new version with the fixed publisher. Leave any image or tag already pushed under the failed version in place.
