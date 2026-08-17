# dotdsh

Personal DeepSeek Harness host setup with first-run owner authentication.

The repository tracks how DSH is built, authenticated, and supervised. Values
that identify one server stay in an ignored host patch, so the same checkout
can be configured independently on another machine.

## Architecture

```text
public origin
  -> external reverse proxy
  -> configured auth proxy host:port
  -> DSH 127.0.0.1:<ephemeral>
```

The built-in DSH webserver remains on loopback. Only `@dotdsh/dsh-auth`
accepts external HTTP, API, and WebSocket traffic.

## Host configuration

Create the ignored host patch:

```bash
cp config/host.patch.example.yml config/host.patch.yml
$EDITOR config/host.patch.yml
```

Configure:

- `publicOrigin`: the exact HTTPS origin used in the browser;
- `host`: `127.0.0.1` for a reverse proxy on the host, or `0.0.0.0` when a
  containerized reverse proxy must reach the host;
- `port`: the host port owned by the auth proxy.

Authentication policy such as session lifetime and login throttling remains
versioned in the plugin defaults. Password state and host values are not
tracked.

## Install

Requirements:

- Linux with a user systemd manager;
- `node` and `pnpm` available to the current shell;
- user lingering enabled when the service must start before login.

If lingering is disabled, enable it once:

```bash
sudo loginctl enable-linger "$USER"
```

Install from any working directory:

```bash
/path/to/dotdsh/scripts/install
```

The installer:

1. derives the checkout, user, Node, DSH home, and XDG config paths;
2. installs the locked dependency tree and builds the auth plugin;
3. links the plugin into the current DSH Web profile;
4. validates `config/host.patch.yml`;
5. renders and verifies the user systemd unit;
6. enables and restarts `dsh.service`.

Re-run the installer after moving the checkout or changing the Node
installation so the rendered unit receives the new paths.

## First-run authentication

Open the configured `publicOrigin`. With no owner state, the auth proxy exposes
only the password setup form. The password is persisted only as a scrypt hash
under `${DSH_HOME:-$HOME/.dsh}/auth/state.json`.

After setup, every page, API request, and WebSocket upgrade requires the secure
session cookie. Restarting the service clears sessions but preserves the owner
password.

## Verify

```bash
pnpm check:config
systemctl --user status dsh.service
journalctl --user -u dsh.service
```

To inspect the unauthenticated HTTP boundary directly, substitute the host and
port from `config/host.patch.yml`:

```bash
curl -I -H 'Host: dsh.example.com' http://127.0.0.1:3080/
```

The response should be the setup or login surface, never the unprotected DSH
application.

## Reverse proxy

For a reverse proxy running directly on the same host:

```caddyfile
dsh.example.com {
    reverse_proxy 127.0.0.1:3080
}
```

For Caddy in a Linux container, bind the auth proxy to `0.0.0.0`, restrict the
port at the firewall, and route through the host gateway:

```caddyfile
dsh.example.com {
    reverse_proxy host.docker.internal:3080
}
```

The container may also need:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

Reverse-proxy configuration remains outside this repository.

## Operate

```bash
systemctl --user restart dsh.service
systemctl --user stop dsh.service
systemctl --user start dsh.service
```

## Move to another host

1. clone the repository;
2. create that host's ignored `config/host.patch.yml`;
3. enable lingering if needed;
4. run `scripts/install`;
5. complete first-run password setup on the new host.

The authentication state is intentionally host-local. Copy it separately only
when preserving the same owner password is required.

## Remove

```bash
systemctl --user disable --now dsh.service
rm "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/dsh.service"
systemctl --user daemon-reload
```

Removal leaves the DSH profile and owner-password state intact.
