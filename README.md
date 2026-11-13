# Beluga

Run a coding agent on your computer or Linux server. Open a project, give the agent a task, and inspect its model requests and tool calls in **Trajectory**.

## Install

Beluga is in public preview. [Download v0.1.0-preview.1](https://github.com/nbsp1221/beluga/releases/tag/v0.1.0-preview.1).

- **Linux server** · Install the native Host as a `systemd` user service and open it in your browser. [Linux setup](docs/hosting.md#linux-user-service)
- **Windows desktop** · Extract the x64 portable ZIP to run Beluga on your PC or connect to a Linux Host. [Windows setup](docs/hosting.md#windows-desktop)
- **Docker** · Run `ghcr.io/nbsp1221/beluga:0.1.0-preview.1` with persistent data and the project folders you want to use. [Docker setup](docs/hosting.md#docker)

## Start a conversation

1. Open your Beluga Host and sign in with its access code. A desktop app running its own Host opens directly.
2. Open **Settings → Providers**, connect a model provider, and choose a model. The Codex connection uses the Codex CLI login on the machine and account running the Host.
3. Select **Add workspace**, choose a project folder on the Host, and send your first message. **Standard** is ready to use.

New conversations start in **Read only**. Choose **Workspace write** to let the agent edit files in the workspace, or **Full access** to let it run commands with the Host account's permissions. Read and search tools can open explicitly named paths that the Host account can read, including paths outside the workspace.

Use chat for file work. The **Files** panel shows sample content, and chat supports text messages.

## Work with a remote Host

The Host runs the agent and stores its conversations. For example, when you connect from Windows to your Linux Host, workspace paths and shell commands refer to Linux. Use the [Host guide](docs/hosting.md) to set up HTTPS access, choose the execution account, and back up Host data.

## Documentation

- [Host setup and operations](docs/hosting.md)
- [Build from source and contribute](docs/development.md)
- [Architecture](docs/architecture.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

Beluga is released under the [MIT License](LICENSE).
