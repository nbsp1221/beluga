# Beluga

This Linux x64 package includes Node.js, pnpm, and the application dependencies.
Install Git for worktree operations and any other tools used by your projects on the host.

## Download manually

Download `beluga-linux-x64.tar.gz` and its `.sha256` file from the release assets:

```sh
sha256sum -c beluga-linux-x64.tar.gz.sha256
tar -xzf beluga-linux-x64.tar.gz
cd beluga
```

## Run manually

Run `./bin/beluga --no-open` and open the authentication URL printed by DSH.
Conversations and settings use `~/.beluga`; set `DSH_HOME` for another directory.
Keep the extracted directory in place while a manually launched profile uses it.

## Install a boot service

On GNU/Linux x64 with systemd:

```sh
sudo sh ./install.sh --user "$USER"
```

Open the browser authentication URL printed after installation. It is local to
the machine running Beluga. To inspect the service or retrieve its startup URL:

```sh
unit=$(systemd-escape --template=beluga@.service "$USER")
sudo systemctl status "$unit"
sudo journalctl -u "$unit" -n 30 --no-pager
```

Program files are installed in `/usr/local/lib/beluga`. The service runs as the
selected existing account, independently of interactive logins. Running as root
gives agents full system privileges. Conversations and settings remain in that
account's `~/.beluga`. The extracted download can be
removed after installation.

The installer confirms DSH's startup URL announcement for the new service run.
Keep startup URL logging and systemd journal output enabled. Service customizations
belong in systemd drop-ins. Stop other Beluga instances before reinstalling shared
program files.

If recovery is reported as incomplete, inspect the reported installer state and
service journal before removing anything. Repair service configuration before
retrying installation.

Configure authenticated remote access in **Settings > Reverse proxy**. Network
listeners, firewall rules, TLS, tunnels, and automatic updates are not configured
by the installer.
