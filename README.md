# Beluga

Run a coding agent on your computer or Linux server. Open a project, give the agent a task, and inspect its model requests and tool calls in **Trajectory**.

## Install

Beluga is in public preview.

### Linux server

On Linux x64, use Node.js 24 LTS, a systemd user session, and a [writable npm global prefix](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally/). Run as your regular user:

```sh
npm install -g @retn0/beluga@preview
beluga service install
```

Open `http://127.0.0.1:8917` on the Host and sign in with the printed access code. [Linux setup and remote access](docs/hosting.md#linux-user-service)

### Windows and Docker

- **Windows desktop** · Extract the x64 portable ZIP to run Beluga on your PC or connect to a Linux Host. [Windows setup](docs/hosting.md#windows-desktop)
- **Docker** · Run the image listed in the release notes with persistent data and your project folders. [Docker setup](docs/hosting.md#docker)

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

## License

Beluga is released under the [MIT License](LICENSE).
