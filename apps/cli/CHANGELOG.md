# Beluga

## 0.1.0-preview.2

### Patch Changes

- ea0e53c: Add Agent Skills to new Standard presets. Find project and global skills from the composer, load them on demand, and inspect the applied instructions in Trajectory.
- 6640acd: Improve the Chats sidebar with workspace-level shortcuts for new sessions and conversation action menus.
  Activity shows running sessions, unread completions, and up to 20 recent sessions you can reopen across workspaces.
- a1b0796: When a new message would cross the model's context threshold, compact the earlier conversation first. The new message stays visible and you can stop the response during compaction. Keep earlier context across successive compactions and preserve the previous history if the model returns an empty or truncated summary.
- d9e2b8f: Select workspace instructions in an agent preset to load `AGENTS.md` or `AGENTS.override.md`. See when each file contributed to a model request in Chat and Trajectory.
- 1b619db: Keep the Activity section steady when groups expand or collapse and prevent scrollbar flicker. Align session status and action menus at the right edge of the sidebar, with both visible on touch.
- 04a3cdc: Refresh the ChatGPT / Codex model list with GPT-6.1 Terra, GPT-6.2 Astra, and GPT-6.2 Sol.
  Conversations using GPT-5.5 or GPT-5.3 Codex Spark need a new model selection because those models are no longer offered for this connection.

## 0.1.0-preview.1

- Run a coding agent in a project on your computer or Linux server and inspect model requests and tool calls in Trajectory.
- Compose agent presets, connect Codex or an OpenAI-compatible provider, and choose how the agent can access your workspace.
- Install the Linux x64 CLI with npm and run the Host as a systemd user service. Use the portable app or installer on Windows, or run the Linux x64 Docker image.

See the [installation guide](https://github.com/nbsp1221/beluga/tree/v0.1.0-preview.1#install) to start a conversation. The Windows preview is unsigned and requires Microsoft Edge WebView2. If Windows blocks the desktop app, you can connect to the Linux Host in a browser.
