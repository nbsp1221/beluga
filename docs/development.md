---
status: current
owner: maintainers
last_reviewed: 2026-11-25
---

# Development

## Run the development preview

Use Node.js 24 or newer for development and the Host, and the pnpm version in
[package.json](../package.json). CI uses the exact Node version in
[.node-version](../.node-version).

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Turbo builds shared packages and starts the CLI status server and web preview. Open
the URL printed by Vite. The Host defaults to `http://127.0.0.1:8917`; Vite proxies
`/api` to it. Set `PORT` for the Host and a matching `HOST_URL` for Vite when
changing that address.

`GET /api/status` returns `{"status":"ready"}` for Host availability. It does
not report a model connection, and the frontend shell does not require this
request to display sample data. The theme is under **Settings → General**.

## Develop the product site

Run the public site on its own from the repository root:

```sh
pnpm dev --filter=@workspace/site
```

Open the loopback URL printed by Astro. Use `pnpm build --filter=@workspace/site`
to generate static files in `apps/site/dist`, and `pnpm --filter @workspace/site preview`
to check that build locally. Edit the site content in [index.astro](../apps/site/src/pages/index.astro).
The page uses AstroWind widgets with the existing Beluga brand assets and links to the Host setup guide.
The landing page embeds [the example conversation](../apps/site/src/pages/demo.astro), which uses the same
client plugins and styles as the product. [The sample conversation](../apps/site/src/components/example-conversation.ts)
provides the completed messages and example usage values. The embed opens the desktop sidebar when the
product layout can place it alongside the chat. Astro uses the full-height loading placeholder to start
React when the embedded area is visible. Turbo builds the shared packages before starting or building the site.
The landing page and demo honor the saved Light, Dark, or System preference before first paint.
See the [AstroWind notice](../THIRD_PARTY_NOTICES.md#astrowind) for the source revision and license.

### Deploy the product site

[Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
serves the Astro build using [the site's Wrangler config](../apps/site/wrangler.jsonc).
From the repository root, build the site and check the deployment package locally:

```sh
pnpm exec turbo run build --filter=@workspace/site
pnpm --filter @workspace/site exec wrangler deploy --dry-run
```

In [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), connect this
repository, use the repository root as the build root, and set `main` as the production
branch. Use the same build command for production and previews. Use
`pnpm --filter @workspace/site exec wrangler deploy` as the deploy command and
`pnpm --filter @workspace/site exec wrangler preview` as the preview command. Enable
preview builds to get a separate URL on pull requests. Cloudflare builds and deploys the
site independently of the product release workflow.
For the first release, verify the landing page and `/demo/` on a PR preview. Attach
`beluga.retn0.dev` as a [Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
after the Worker has a successful production deployment.

## Run connected mode from source

```sh
pnpm exec turbo build --filter=@retn0/beluga --filter=web
node apps/cli/dist/main.js auth init --data-dir .local/development-host
node apps/cli/dist/main.js serve --data-dir .local/development-host --web-dir apps/web/dist
```

These commands keep the local Host's data in `.local/development-host` at the repository root. Open `http://127.0.0.1:8917` and sign in with the code printed by `auth init`. Use an absolute `--data-dir` to put the data elsewhere.

## Develop and build the Windows desktop app

On Windows x64 with the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#windows),
open the desktop app from a clean checkout with:

```sh
pnpm --filter @workspace/desktop tauri dev
```

Tauri prepares the bundled Host and web assets before opening the app.

To build the installer and portable ZIP:

```sh
pnpm --filter @workspace/desktop run package:windows
```

The portable ZIP, optional NSIS installer and their SHA-256 checksums are under `apps/desktop/src-tauri/target/release/bundle/windows-x64/`. Both bundles include Node, the Host and the web build. The installer can also provision WebView2.

## Checks

[CI](../.github/workflows/ci.yml) runs `pnpm check` on Linux and Windows for
pull requests to `main`. [Release](../.github/workflows/release.yml) calls the
same checks on pushes to `main`. The Linux job also checks release metadata,
GitHub Actions workflows, and shell scripts under `scripts/`.
See [release verification](releasing.md) for native packaging.

Before running tests, CI installs fd and ripgrep with apt on Linux. On Windows,
CI downloads versioned ZIPs from the upstream GitHub releases and checks their
SHA-256 hashes before using the binaries. Both jobs print the tool versions.
Pi accepts Ubuntu's `fdfind` command directly. Local checks also use these tools.
Install `fd-find ripgrep` with apt,
`fd ripgrep` with Chocolatey on Windows, or `fd ripgrep` with Homebrew on macOS.

Desktop authentication and Connections regression tests use isolated Vitest
fixtures. Check the installed Windows app, tray interactions, and performance
in a dedicated QA session. Keep installer evidence and measurements as release
artifacts.

Run the full local check before handing off changes:

```sh
pnpm check
```

Use `pnpm format:check` to check formatting and `pnpm format` to apply Oxfmt.
`pnpm lint` runs Oxlint and ESLint. Use `pnpm lint:fix` to apply available fixes,
or `pnpm --filter web lint:fix` to limit fixes to one package.
Use `pnpm typecheck` and `pnpm build` to run those tasks on their own. Shared presets extend the published
`@retn0` configs in [packages/tooling-config](../packages/tooling-config).
Both linters exclude the installed registry files listed in
[the shared ignore config](../packages/tooling-config/src/ignores.mts).
Oxfmt, TypeScript, and the production build still cover those files.
Both linters use the shared rule severities. Errors fail the check and
advisory warnings are reported in the same run.

[packages/typescript-config](../packages/typescript-config) shares Node and React
settings. The Host build emits JavaScript, and browser packages keep bundler
resolution. Type checks and tests build the workspace declarations they consume.
Check for another verification run before running the whole suite.

Run `pnpm test` for the package suites, workspace boundary tests, and the connected
Host and web integration test. To run an individual suite, use
`pnpm --filter <package> test:watch` after the first build for local feedback.
Runtime and Host integration tests use the Node environment. Host tests
exercise real temporary SQLite databases and filesystem operations with a
deterministic model provider. Web tests live beside the behavior they cover
and use Testing Library in jsdom. Use Chromium for layout and browser
behavior that jsdom cannot simulate. The TypeScript checks include the test
sources separately from the application build.

Declare feature-specific dependencies with exact versions in the owning package.
Use `catalog:` for shared dependencies whose versions should move together and
define them in [pnpm-workspace.yaml](../pnpm-workspace.yaml). Use `workspace:*`
for internal dependencies. CI or clean checkouts should use
`pnpm install --frozen-lockfile`.

Git checks out text files with LF on every platform. Editors that support
[EditorConfig](../.editorconfig) use LF, UTF-8, and two-space indentation.

### Write and review tests

`pnpm test` runs the Host package tests before the product integration suite.
Windows CI runs up to two Host test files at a time to bound the number of
live Host fixtures on the runner.

To run just the product suite, build its workspace dependencies first.

```sh
pnpm exec turbo run build --filter=@workspace/host-plugins
pnpm test:integration
```

Start from a working example that exercises the same boundary. The
[workspace instructions suite](../packages/host-plugins/test/agent-instructions.test.ts)
uses the [Host fixture](../packages/host-plugins/test/fixtures/harness.ts) for a
fresh SQLite database, workspace, and deterministic model for each case.
The [Connections test](../apps/web/src/Connections.test.tsx) drives the UI by
role and verifies a state change with an in-flight request. The
[connected product suite](../test/connected-product.test.ts) covers the contracts
that need both the Host and the web client.

- Give each independently observable behavior its own test. Use multiple
  steps when the behavior depends on the sequence, such as restoring a record
  after restarting the Host. Add new inputs for the same behavior with
  `test.for`, as in the workspace instructions suite's external path cases.
  Each case gets its own workspace and session.
- Use the nearest public boundary that exercises the contract. Assert on
  results, persisted records, or rendered controls. Let each test own its
  data and cleanup through the fixture or the runner's lifecycle.
- Wait for a response, event, or observable state. Use local fixtures for
  dependencies such as model calls. Keep production credentials and fixed
  delays out of the setup.
- When a case times out, check which operation was slow and see whether
  unrelated behaviors share that case. Raising a timeout does not address
  those causes. Use a longer deadline only for an operation with a known
  reason to take longer.

Run the affected file with `pnpm --filter <package> exec vitest run <file> --reporter=verbose`
or `pnpm test:integration <file> --reporter=verbose` for a root integration test.
Then run `pnpm check`. For platform-sensitive changes, use both CI jobs and
record the failing case and runner when reporting a timeout.

## Agent presets API

Developer tools can send the same definition to `POST /api/agent-presets`:

```json
{
  "name": "Code reviewer",
  "description": "Review code using workspace files",
  "instructions": "Read the relevant code and report actionable findings.",
  "capabilities": ["file.read"]
}
```

`GET /api/agent-presets` lists the current presets, available capability IDs, and
the Host's `defaultPresetId`. Use `PUT /api/agent-presets/default` with
`{"presetId":"<id>"}` to change the default or `{"presetId":null}` to clear it.
To update a preset, send the full definition and its current
`version` to `PUT /api/agent-presets/{id}`. A stale version returns HTTP 409.
For an API-created chat, send `workspaceId` to `POST /api/conversations`.
You can also send `agentPresetId` and `agentPresetVersion`. The Host uses
the saved default when the request omits the preset. When supplied, the version
must match the latest one at creation. The API uses the session cookie from
`POST /api/auth/login` with `{"code":"…"}`. For write requests, send an
`Origin` header that matches the Host's configured browser origin.

## Adding UI components

Use the configured shadcn preset and review generated diffs before overwriting
existing files.

```sh
pnpm dlx shadcn@latest add button -c apps/web
```

The monorepo aliases place reusable UI in `packages/ui`. Import it through the
package, for example:

```tsx
import { Button } from '@workspace/ui/components/button';
```

Follow the [design system](design-system.md) for composition and approval
boundaries. See [architecture](architecture.md) for feature ownership and
plugin contracts, [roadmap](roadmap.md) for remaining work, and
[third-party notices](../THIRD_PARTY_NOTICES.md) for attribution.
