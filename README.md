<img src="apps/desktop/icon.svg" alt="" width="64" height="64">

# Beluga

**A self-hosted coding agent that works where your code lives.**

Open a project folder, connect a model, and ask Beluga to explore your code or make a change. See which files it read and what tools it ran.

[![Beluga preview version](https://img.shields.io/github/v/release/nbsp1221/beluga?include_prereleases&label=preview&style=flat-square)](https://github.com/nbsp1221/beluga/releases)
[![MIT license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

[Windows download](https://github.com/nbsp1221/beluga/releases) · [Linux setup](#linux-server) · [Docker setup](#docker)

![Beluga answers a question about a server's port and shows the file it read](.github/assets/beluga-workspace.webp)

_An example conversation in a sample workspace._

## What you can do

- **Keep chats with your projects.** Open a folder and pick up earlier conversations from the same workspace.
- **Choose what the agent can do.** Start in Read only and grant write or shell access when the task calls for it.
- **Review what happened.** Open Trajectory to see the tool calls and model requests behind a response.

## Install

Beluga is in public preview. Connect an existing Codex CLI login or an OpenAI-compatible provider to start a conversation.

### Windows

Download the Windows x64 portable ZIP from [Releases](https://github.com/nbsp1221/beluga/releases), verify its SHA-256 checksum, and extract the whole folder before opening `Beluga.exe`. It starts a Host on your computer and can also connect to a remote Host. [Windows setup](docs/hosting.md#windows-desktop)

### Linux server

On Linux x64, use Node.js 24 LTS, a systemd user session, and a [writable npm global prefix](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally/). Run as your regular user:

```sh
npm install -g @retn0/beluga@preview
beluga service install
```

Open `http://127.0.0.1:8917` on the Host and sign in with the printed access code. [Linux setup and remote access](docs/hosting.md#linux-user-service)

### Docker

Use the versioned image listed in the [release notes](https://github.com/nbsp1221/beluga/releases). The [Docker setup guide](docs/hosting.md#docker) shows how to keep your data and mount your project folders.

## Start a conversation

1. Open your Beluga Host and sign in with its access code. A desktop app running its own Host opens directly.
2. Open **Settings → Providers**, connect a model provider, and choose a model. The Codex connection uses the Codex CLI login on the machine and account running the Host.
3. Select **Add workspace**, choose a project folder on the Host, and send your first message. **Standard** is ready to use.

New conversations start in **Read only**. Choose **Workspace write** to let the agent edit files in the workspace, or **Full access** to let it run commands with the Host account's permissions. Read and search tools can open explicitly named paths that the Host account can read, including paths outside the workspace.

Use chat to ask the agent to read or edit project files. Chat supports text messages.

## Work with a remote Host

The Host runs the agent and stores its conversations. For example, when you connect from Windows to your Linux Host, workspace paths and shell commands refer to Linux. Use the [Host guide](docs/hosting.md) to configure network access, choose the execution account, and back up Host data.

## Documentation

- [Host setup and operations](docs/hosting.md)
- [Build from source and contribute](docs/development.md)
- [Architecture](docs/architecture.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

Beluga's interface and plugin architecture were inspired by [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

## License

Beluga is released under the [MIT License](LICENSE).
