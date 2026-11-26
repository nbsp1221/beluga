---
status: current
owner: maintainers
last_reviewed: 2026-11-26
---

# Host a Beluga server

Beluga runs tools and stores conversations on the machine running the Host. A browser or a connected desktop app controls that Host. A workspace path always refers to the Host's filesystem.

## Linux user service

Run these commands as the account that will use Beluga. Linux x64, Node.js 24 LTS, a writable npm global prefix, and a systemd user session are required.

```sh
npm install -g @retn0/beluga@preview
beluga service install
```

The service starts immediately. Open `http://127.0.0.1:8917` on the Host and sign in with the first access code printed by the command. Save that code privately. A repeat install keeps the existing access code and systemd unit. Use `beluga service install --boot` to start at boot and keep running after logout. This enables lingering for the entire user account. [systemd login manager reference](https://www.freedesktop.org/software/systemd/man/257/loginctl.html)

If enabling lingering requires administrator approval, have an administrator run `sudo loginctl enable-linger USER` for the service account, then rerun `beluga service install --boot` as that account.

Use `systemctl --user status beluga.service` and `journalctl --user -u beluga.service` to check the service. Configure the [browser address](#access-the-host) for remote access. To run without systemd, use `beluga auth init` once and then `beluga serve`.

### Update or remove

Back up the Host data before updating. Reinstall the preview package within the same npm prefix, then restart the service:

```sh
npm install -g @retn0/beluga@preview
systemctl --user restart beluga.service
```

To recover a previous release, substitute its exact npm version for `preview` and restart again. If you move Node.js or change the npm prefix, update the two executable paths in the unit with `systemctl --user edit --full beluga.service` before restarting. Keep the data directory and any drop-ins.

To remove the service, stop and disable it with `systemctl --user disable --now beluga.service`, remove `beluga.service` from your systemd user configuration, and run `systemctl --user daemon-reload`. Remove the CLI with `npm uninstall -g @retn0/beluga`. The Host data directory is managed separately.

## Windows desktop

Download the Windows x64 portable ZIP from the [current Beluga release](https://github.com/nbsp1221/beluga/releases), extract the whole folder and open `Beluga.exe`. The app starts a Host on your PC. Closing the window keeps that Host running in the notification area. Select **Exit** in the tray menu to stop it.

The preview executable is unsigned. Compare the ZIP's SHA-256 hash with the checksum from the same release (`beluga-windows-x64-portable.zip.sha256`) before extracting it.

```powershell
Get-FileHash .\beluga-windows-x64-portable.zip -Algorithm SHA256
```

The desktop app requires Microsoft Edge WebView2 Runtime. Use the optional installer (`Beluga_*_x64-setup.exe`) and its matching `.sha256` file from that release if you prefer an installed app or need it to provision WebView2. Windows SmartScreen may warn about unsigned executables. Smart App Control or a managed device policy can block them. You can also open your Linux Host in a browser.

The portable app stores local Host data at `%LOCALAPPDATA%\io.github.nbsp1221.beluga\host`. Replacing the extracted folder keeps that data. Exit the app before replacing its files.

To use a server, open **Settings → Connections**, enter the server's HTTP or HTTPS address and sign in with its access code. Use plain HTTP on a trusted private network because it carries access codes and session data without application-layer encryption. Select **This computer → Open** to return to the local Host. Closing the app leaves work on a remote Host running.

## Docker

The official image contains Beluga and its runtime dependencies. It does not include the Codex CLI or any account credentials. Supply model authentication at runtime.

Replace `VERSION` with the image tag from the release notes. Persist the Host data directory in a Docker volume and mount the project folders you want to open. Keep the same volume and container-side project paths when replacing the container so saved conversations and workspace paths stay usable.

```sh
image=ghcr.io/nbsp1221/beluga:VERSION
docker volume create beluga-data
docker run --rm -v beluga-data:/data "$image" auth init --data-dir /data
docker run -d --name beluga --restart unless-stopped \
  -p 127.0.0.1:8917:8917 \
  -v beluga-data:/data \
  --mount "type=bind,src=$PWD,dst=/workspace" \
  "$image"
```

Run the initialization command once and save the printed access code. Run the example from the project directory, then open `http://127.0.0.1:8917` on the Docker host. Check that the container user has the intended read or write permissions on the mounted project.

For remote access, point your existing HTTPS reverse proxy at `127.0.0.1:8917` on the Docker host. Keep the same mounts and local port mapping, and append the following arguments after the image name when creating the container:

```sh
serve --bind 0.0.0.0 --data-dir /data --web-dir /opt/beluga/web --origin https://beluga.example.com
```

Open workspaces using the paths inside the container. Full access runs commands with the container user's permissions and the tools installed in the container. A writable project mount lets those commands change the corresponding files on the Docker host. See [Docker volumes](https://docs.docker.com/engine/storage/volumes/) and [bind mounts](https://docs.docker.com/engine/storage/bind-mounts/).

### Connect a model provider

Choose a provider in **Settings → Providers**. An OpenAI-compatible endpoint uses its own connection settings and needs no Codex mount.

For Codex, make the CLI's file-based login available as `auth.json` in the container's `$CODEX_HOME`, or in `~/.codex` for the account running Beluga. Two ways to supply it are:

- **Reuse a login from the Docker host.** Bind-mount the directory containing its `auth.json` read-only and set `CODEX_HOME` to the absolute mount path inside the container. The host's Codex CLI continues to manage and renew that login.
- **Use a separate login.** Run Codex CLI in an environment you manage, such as a separate container, with a persistent writable Codex home. Sign in there and make the same directory available to Beluga. Renew the login from the environment where you ran Codex CLI.

Keep the login separate from the image. A read-only mount prevents writes to the login from Beluga's container. Its contents are still readable by processes that have access to the mount.

## Choose the Host account

Run Beluga under the account that owns the projects and tools you want to use. Commands in Full access run with that account's permissions and environment. Install your project runtimes and development tools on the Host.

For Codex, sign in with Codex CLI as that same account. Beluga uses the account's existing login under `$CODEX_HOME` or `~/.codex`. Manage and renew that login through Codex CLI. To use a different provider, connect an OpenAI-compatible Chat Completions endpoint in **Settings → Providers**. The Host uses the URL and optional API key you provide. Use plain HTTP only on a trusted private network because the API key and model requests travel without application-layer encryption.

## Access the Host

On the Host machine, open `http://127.0.0.1:8917` when using the default port. For direct browser access over a trusted private network, edit the installed user service with `systemctl --user edit beluga.service`. Set both the private listening address and the address that the browser will open.

```ini
[Service]
Environment=BELUGA_BIND=192.168.1.20
Environment=BELUGA_ORIGIN=http://192.168.1.20:8917
```

Replace the example IP with the Host's private address, then run `systemctl --user restart beluga.service`. Use `--bind 0.0.0.0` to listen on all IPv4 interfaces. Keep `--origin` set to the address people actually open. Plain HTTP does not encrypt the access code, session cookie, or chat traffic at the application layer, and browsers can restrict clipboard access. Chat messages and code blocks can also copy on plain HTTP where the browser supports copying from a user gesture. For public access, use an HTTPS reverse proxy in front of the loopback listener and configure network access in your deployment.

Set the Host's `--origin` to the exact browser address, including any nondefault port, with no path or trailing slash. For example, pair `--origin https://beluga.example.com` with a proxy that forwards that hostname to `http://127.0.0.1:8917`. Forward the site and API on the same hostname and preserve streaming responses. Use a dedicated hostname for Beluga.

For the installed Linux service behind an HTTPS proxy on the same Host, keep the default loopback listener and set the public origin with `systemctl --user edit beluga.service`. Restart the service after editing.

```ini
[Service]
Environment=BELUGA_ORIGIN=https://beluga.example.com
```

For direct loopback access, leave `BELUGA_ORIGIN` unset. If you change `PORT`, the default local browser address follows it. An explicit `--origin` takes precedence over the environment value.

The access code signs you in to Beluga. Model credentials are configured separately. To verify a remote connection, sign in, send a message, then send a second message after the first finishes. Check that both appear in **Trajectory**.

## Manage access

For a manual Host setup, generate the first access code with `auth init`. Run `auth rotate` with the same data directory to replace an existing code. Rotation invalidates existing sign-ins on their next request. Restart the Host if you also need to close open streams.

Browser sessions expire 24 hours after login or the last authenticated site visit. A Host restart preserves the session when the data directory and site address stay the same.

## Keep a copy of Host data

The Linux service and foreground Host default to `$XDG_DATA_HOME/beluga` or `~/.local/share/beluga`. On Windows the default is `%LOCALAPPDATA%\beluga`. If you supply `--data-dir`, use the same path for serving, access-code initialization and code rotation.

Stop the Host before copying the complete data directory. To restore, stop the Host, restore the copy and start with the same data directory and site address. Store the copy privately because it can contain conversation contents, tool results and provider credentials. Back up project folders and credentials managed by external tools separately.

## Project instructions

Put shared instructions in the project's `AGENTS.md` and select **Workspace instructions** in the agent preset. New installations include it in Standard. Beluga loads rules from the project root to the workspace before the first model request. Outside a Git checkout it starts at the workspace folder. A successful file read, write, or edit can add applicable subfolder rules before the next model request. A closer rule takes precedence for files in its scope. Use `AGENTS.override.md` in the same folder to replace that folder's `AGENTS.md`.

For instructions across projects, place `AGENTS.md` in the Host's data directory. For the standard Docker setup this is `/data` inside the container. A browser uses the rules on its connected Host. Files are reconciled on file activity, session resume and when compaction removes earlier instruction context. The default budgets are 64 KiB for each of the Host-wide and project chains, with a 1 MiB limit per source file. Instructions guide the model within the session's access mode. Chat shows the contributing files in a collapsible row. In Trajectory, search for the filename or open a Context row to inspect the changes and their model request.

## Agent skills

Put an [Agent Skill](https://agentskills.io/specification) in a folder named after the skill, with a `SKILL.md` that declares its `name` and `description`. Select **Agent skills** in the preset. New installations include it in Standard. Existing presets and conversations keep their saved capabilities.

Beluga looks for the skill in this order:

1. `.agents/skills/<name>/SKILL.md` at the nearest Git root, or in the workspace folder outside a Git checkout.
2. `skills/<name>/SKILL.md` under the Host's Beluga data directory.
3. `.agents/skills/<name>/SKILL.md` in the Host account's home directory.

The first valid definition in that order wins. Skill folders and files reached through links must resolve inside their project or global search root. Host logs identify invalid metadata, links that cross a search boundary, and which definition wins when two skills share a name. All paths are on the Host, including when you connect from another computer.

Type `/` at the start of the composer to find a skill, or type `/<name>` as a word in your message. Both use the definition available when the Host handles the message. An unknown name stays ordinary text. Reopen suggestions to refresh the list or type an exact name omitted from a partial list. Set `disable-model-invocation: true` for manual use only or `user-invocable: false` to hide a skill from direct selection. A skill supplies instructions within the conversation's existing file and shell permissions.

Beluga loads the full `SKILL.md` body on invocation. The source file can be up to 1 MiB, and the full request is subject to the model's context window. Keep longer reference material in separate files. After compaction, the current catalog is available for another invocation. Earlier skill bodies follow the conversation's normal compaction behavior.

Expand a skill in Chat to read the loaded instructions. In Trajectory, **System Prompt** shows the list offered to the model. A manual invocation appears in a **Context** row, and a model invocation appears in the **skill** tool result. You can search Trajectory by skill name.

## Diagnose connection problems

- **The site opens but messages do not finish.** Check that the proxy's browser address exactly matches `--origin` and that it forwards streaming API responses.
- **Beluga opens but a Codex model is unavailable.** Check the Codex login on the Host under the service account, then check **Settings → Providers**.
- **A workspace is missing.** Check the path and permissions on the Host. Paths on your browser's computer are available only when that computer is running the Host.
