# Beluga

An agent workspace built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
Use Codex models, access your workspace remotely, and organize conversations by Git worktree.

## Getting started

On Ubuntu 24.04 LTS x64 with systemd, curl, and Git, run as your non-root account:

```sh
curl -fsSL https://github.com/nbsp1221/beluga/releases/latest/download/install.sh | sh
```

The installer downloads and verifies the latest stable release, installs its
bundled Node.js and pnpm, and starts a service under your account. It uses sudo
for service installation. Beluga starts at boot and restarts after a failure.

Open the browser authentication URL printed when installation finishes. In
**GPT Auth** settings, sign in with ChatGPT or reuse an existing Codex CLI login,
then select a Codex model. The default URL is local to the machine running Beluga;
see [Workspaces and remote access](#workspaces-and-remote-access) for remote use.

For manual installation or running without a service, see the
[installation notes](apps/web/packaging/README.md).

## Workspaces and remote access

Open a project to start a conversation. Select **Worktree** in the sidebar to create
or import Git worktrees and keep their conversations together.

Configure authenticated remote access in **Settings → Reverse proxy**. Installation
keeps the loopback defaults and does not configure a firewall, TLS, or tunnels.

These features use bundled community plugins:

- [dsh-codex-auth](https://www.npmjs.com/package/dsh-codex-auth): Codex account integration.
- [dsh-full-remote](https://github.com/JUANWANG-BUAA/dsh-full-remote): authenticated remote access.
- [Clutch Worktree](https://github.com/Cerbur/clutch-dsh/tree/main/packages/clutch-dsh-worktree):
  project, worktree, and conversation navigation.

## Data and service management

Conversations and settings are stored in `~/.beluga` under the account running
Beluga. Set `DSH_HOME` to use another directory. Git and any tools used by your
projects must be available on the host.

Service installation puts program files in `/usr/local/lib/beluga`. To upgrade,
run the same installation command. It replaces program files and preserves
your account's conversations and settings. Stop other active Beluga service
instances before upgrading the shared installation.

Use `sudo systemctl status "beluga@$USER.service"` to check the service.
Apply custom service settings with `sudo systemctl edit "beluga@$USER.service"`.
See the [installation notes](apps/web/packaging/README.md) for recovery guidance.

## Development

Requires Node.js 24.12 or later and the pnpm version declared in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Run `pnpm check` for lint, formatting, types, and tests. Run `pnpm format:fix` to
format files. See [AGENTS.md](AGENTS.md) for repository conventions.

### Build a Linux package

Build on Linux x64 with the Node.js version in `.node-version` and the pinned pnpm
version so native dependencies match the target:

```sh
pnpm install --frozen-lockfile
pnpm package
```

The archive, SHA-256 checksum, and installation script are written to `apps/web/dist/`.

## License

[MIT](LICENSE).
