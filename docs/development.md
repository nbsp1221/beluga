---
status: current
owner: maintainers
last_reviewed: 2026-11-13
---

# Development

## Run the development preview

Use Node.js 24 or newer for development and the Host, and the pnpm version in
[package.json](../package.json).

```sh
pnpm install --frozen-lockfile
pnpm dev:all
```

Root commands ending in `:all` delegate to Turbo. Turbo runs package tasks and the explicitly registered root checks. It builds shared packages, starts their watchers and runs both apps in development. Open
the URL printed by Vite. The Host defaults to `http://127.0.0.1:8917`; Vite proxies
`/api` to it. Set `PORT` for the Host and a matching `HOST_URL` for Vite when
changing that address.

`GET /api/status` returns `{"status":"ready"}` for Host availability. It does
not report a model connection, and the frontend shell does not require this
request to display sample data. The theme is under **Settings → General**.

## Run connected mode from source

```sh
pnpm exec turbo build --filter=@workspace/host --filter=web
pnpm --filter @workspace/host start auth init --data-dir ../../.local/development-host
pnpm --filter @workspace/host start serve --data-dir ../../.local/development-host
```

These commands keep the local Host's data in `.local/development-host` at the repository root. Open `http://127.0.0.1:8917` and sign in with the code printed by `auth init`. Use an absolute `--data-dir` to put the data elsewhere.

## Build the Windows desktop bundles

On Windows x64, install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#windows) and run:

```sh
pnpm --filter @workspace/desktop run package:windows
```

The portable ZIP and SHA-256 checksum are under `apps/desktop/src-tauri/target/release/bundle/portable/`. The optional NSIS installer is under the adjacent `nsis/` directory. Both include Node, the Host and the web build. The installer can also provision WebView2.

## Checks

Desktop authentication and Connections regression tests use isolated Vitest
fixtures. Check the installed Windows app, tray interactions, and performance
in a dedicated QA session. Keep installer evidence and measurements as release
artifacts.

Run the full local check before handing off changes:

```sh
pnpm check
```

Use `pnpm format:check` to check formatting and `pnpm format` to apply Oxfmt.
`pnpm lint` runs Oxlint and ESLint. Shared presets extend the published
`@retn0` configs in [packages/tooling-config](../packages/tooling-config).
Both linters exclude `packages/ui/src/components` and `packages/ui/src/hooks`.
Oxfmt, TypeScript, and the production build still cover those directories.
Both linters use the shared rule severities. Errors fail the check and
advisory warnings are reported in the same run.

[packages/typescript-config](../packages/typescript-config) shares Node and React
settings. The Host build emits JavaScript, and browser packages keep bundler
resolution. Type checks and tests build the workspace declarations they consume.
Check for another verification run before running the whole suite.

Run `pnpm test:all` for the package suites, workspace boundary tests, and the connected
Host and web integration test. To run an individual suite, use
`pnpm --filter <package> test:watch` after the first build for local feedback.
Runtime and Host integration tests use the Node environment. Host tests
exercise real temporary SQLite databases and filesystem operations with a
deterministic model provider. Web tests live beside the behavior they cover
and use Testing Library in jsdom. Use Chromium for layout and browser
behavior that jsdom cannot simulate. The TypeScript checks include the test
sources separately from the application build.

Keep registry dependencies on exact versions and use `catalog:` for versions
shared across packages. Define those versions in
[pnpm-workspace.yaml](../pnpm-workspace.yaml) and use `workspace:*` for internal
dependencies. CI or clean checkouts should use `pnpm install --frozen-lockfile`.

Git checks out text files with LF on every platform. Editors that support
[EditorConfig](../.editorconfig) use LF, UTF-8, and two-space indentation.

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
