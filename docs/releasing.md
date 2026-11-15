---
status: current
owner: maintainers
last_reviewed: 2026-11-15
---

# Release verification

Add a Changesets entry for user-facing changes with `pnpm exec changeset` and select the root `beluga` package. Merge product changes through a pull request. [Prepare release](../.github/workflows/release-prepare.yml) prepares a separate PR for the next version and changelog. The root package owns the product release version. Internal private packages follow the repository source revision. Give an SDK or plugin its own release sequence when it is distributed independently. `pnpm release:check` verifies the desktop metadata and installation references.

The release PR is the approval to publish. Use the checks below to verify the affected install paths before merging it. The Linux installer and Windows x64 portable ZIP and installer go into the same GitHub Release. The corresponding Docker image is published to GitHub Container Registry with the same version.

When the product version changes on `main`, [CI](../.github/workflows/ci.yml) runs
its Windows and Linux checks. If they pass, [Build release candidate](../.github/workflows/release-build.yml)
packages the same commit and uploads the Linux archive and installer script,
Windows bundles, and Docker image archive. Once packaging succeeds, [Publish release](../.github/workflows/release-publish.yml)
uses the artifacts from that run and publishes automatically.

To build the current `main` version again, select **Run workflow** in **CI** and
enable **Build release candidate after CI**. This manual build creates a fresh set of artifacts for verification.

Mark preview releases as **Pre-release** on GitHub. Use an explicit version in installation commands and on the container image so users can install the same build again.

Ship the unsigned Windows portable ZIP and optional NSIS installer with their SHA-256 checksums. Keep the download guide explicit about the signing status and Windows restrictions.

## Verify the Host

- Start with a clean account and the documented prerequisites. Check that installation prints the first access code and starts the service under that account. Inspect what the installation changed and confirm that project files and unrelated services are untouched.
- Sign in with the access code, connect a provider, add a project and send two messages without reloading. Repeat through HTTPS from a different computer. Check that each response finishes and appears in **Trajectory**.
- In a disposable project, exercise Read only, Workspace write and Full access with the Standard preset. Check tool calls, command cancellation and the corresponding Trajectory records.
- Restart the Host and check that the same browser session, workspace, provider and chat are available. Test both installer choices for boot startup. With it enabled, verify that the service survives logout and starts after reboot without an interactive login. With it skipped, verify that installation still starts the service and leaves the account's lingering setting intact.
- Test a repeat install, an update and a failed update against a populated data directory. Verify that the access code and user data are preserved. Verify the documented recovery procedure with a copy of that data. Test program removal separately from data deletion.

## Verify desktop assets

Extract the portable ZIP and run the optional installer on separate clean systems. For each bundle, open the local Host, connect to a private HTTP Host and an HTTPS Host, send a message on each, and return to **This computer**. Check that closing the window leaves local work running in the tray and **Exit** stops it. Check that exiting the desktop app leaves independent remote work running.

## Verify the Docker image

- Pull the versioned image on a clean Docker host. Follow the published steps for the data volume, project mount and model credentials. Verify that the documented proxy can reach the container and that the Host is reachable only through the intended network path.
- Confirm that the official image includes Beluga's runtime dependencies and contains neither the Codex CLI nor account credentials. Verify an OpenAI-compatible connection with no Codex mount. For the Codex examples, verify that Beluga can use the supplied login and pick up an externally renewed login without replacing the Beluga container.
- Sign in through the documented HTTPS connection. Open the mounted project and check a file edit, a shell command and the corresponding Trajectory records.
- Replace the container with the same volume and project mount. Check that the access code, provider settings, workspace and conversations still work. Test the documented update and recovery procedure with a copy of the volume.

## Verify the published instructions

- CI verifies the Linux and Windows bundles and checks the Docker runtime. For manual install checks, download the artifacts from the CI run and verify their checksums before use. The public Linux one-command installer uses the versioned GitHub Release URL.
- Check that each artifact includes the Beluga license and the applicable third-party notices and license files.
- Keep release notes focused on supported installs, changes users will see, and any action required before updating.
- After publishing, verify the public download links, run the documented Linux one-command installer, and confirm that the published Docker tag resolves to the tested image.

## Recover a publication

The publish job verifies the checksums and publishes the image to GHCR. After an anonymous pull succeeds, it tags the candidate commit, uploads the Linux and Windows assets with their checksums, and publishes the GitHub Release with the changelog and image reference.

The first GHCR push creates a private package. Set the package visibility to public once, then use **Re-run failed jobs** on the same CI run to retry publication. For other publishing failures, fix the reported cause and retry the failed job on the same run.

To publish a verified candidate built before automatic publication or from a manual CI build, run **Publish release** on `main` with the successful CI run ID containing that candidate. This uses the candidate's original commit and artifacts.
