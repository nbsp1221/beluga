import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { initializeAccessCode, resolveDataDir } from '@workspace/host-server';

const exec = promisify(execFile);
const unit = 'beluga.service';

export async function notifyServiceReady(env: NodeJS.ProcessEnv) {
  if (process.platform === 'linux' && env.NOTIFY_SOCKET) {
    await exec('systemd-notify', ['--ready']);
  }
}

export async function installService(entry: string, boot: boolean, env: NodeJS.ProcessEnv) {
  if (process.platform !== 'linux' || process.getuid?.() === 0) {
    throw new Error('Install the Beluga service as a regular Linux user.');
  }

  await exec('systemctl', ['--user', 'show-environment']).catch(() => {
    throw new Error('A systemd user session is required. Sign in as the user running Beluga.');
  });
  const dataDir = resolveDataDir();
  const configHome = env.XDG_CONFIG_HOME;
  const units = join(
    configHome && isAbsolute(configHome) ? configHome : join(homedir(), '.config'),
    'systemd',
    'user',
  );
  await mkdir(units, { recursive: true });
  try {
    const code = await initializeAccessCode(dataDir, false);
    console.log(`Beluga access code: ${code}`);
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) {
      throw error;
    }
  }

  const command = [process.execPath, entry, 'serve', '--data-dir', dataDir]
    .map(quoteArgument)
    .join(' ');
  await writeFile(
    join(units, unit),
    `[Unit]
Description=Beluga Host

[Service]
Type=notify
NotifyAccess=all
TimeoutStartSec=30s
WorkingDirectory=%h
ExecStart=:${command}
Restart=on-failure
RestartSec=5s
UMask=0077

[Install]
WantedBy=default.target
`,
    { flag: 'wx' },
  ).catch((error: unknown) => {
    if (!hasCode(error, 'EEXIST')) {
      throw error;
    }
  });

  await exec('systemctl', ['--user', 'daemon-reload']);
  await exec('systemctl', ['--user', 'restart', unit]);
  if (boot) {
    const username = userInfo().username;
    const { stdout } = await exec('loginctl', [
      'show-user',
      username,
      '--property=Linger',
      '--value',
    ]);
    if (stdout.trim() !== 'yes') {
      await exec('loginctl', ['enable-linger', username]).catch(() => {
        throw new Error(
          `Beluga is running. Ask an administrator to run sudo loginctl enable-linger ${username}, then rerun beluga service install --boot.`,
        );
      });
    }
    await exec('systemctl', ['--user', 'enable', unit]);
  }
  console.log('Beluga is running. Check status with: systemctl --user status beluga.service');
}

function quoteArgument(arg: string) {
  return `"${arg.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('\n', '\\n').replaceAll('\r', '\\r')}"`;
}

function hasCode(error: unknown, code: string) {
  return error instanceof Error && 'code' in error && error.code === code;
}
