import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));

async function readRepositoryFile(path: string): Promise<string> {
  return await readFile(new URL(path, `file://${repositoryRoot}/`), "utf8");
}

describe("host portability", () => {
  it("keeps versioned policy defaults separate from local host values", async () => {
    const [pluginSource, hostExample, gitignore] = await Promise.all([
      readRepositoryFile("packages/plugins/dsh-auth/src/index.ts"),
      readRepositoryFile("config/host.patch.example.yml"),
      readRepositoryFile(".gitignore"),
    ]);

    expect(pluginSource).toContain("loginLockSeconds: z.number().min(1).default(300)");
    expect(pluginSource).toContain("maxLoginAttempts: z.number().min(1).default(10)");
    expect(pluginSource).toContain("sessionTtlSeconds: z.number().min(60).default(604_800)");
    expect(hostExample).toContain("https://dsh.example.com");
    expect(hostExample).toContain("host: '127.0.0.1'");
    expect(gitignore).toContain("/config/host.patch.yml");
  });

  it("renders a user service without source-host assumptions", async () => {
    const [unitTemplate, installer] = await Promise.all([
      readRepositoryFile("deploy/systemd/dsh.service.in"),
      readRepositoryFile("scripts/install"),
    ]);

    expect(unitTemplate).toContain("Type=exec");
    expect(unitTemplate).toContain("@REPO_ROOT@");
    expect(unitTemplate).toContain("@NODE_BIN@");
    expect(unitTemplate).toContain("@DSH_HOME@");
    expect(unitTemplate).toContain("WorkingDirectory=@REPO_ROOT@");
    expect(unitTemplate).not.toContain('WorkingDirectory="@REPO_ROOT@"');
    expect(unitTemplate).not.toContain("/home/");
    expect(installer).toContain("process.execPath");
    expect(installer).not.toContain("/home/");
    expect(installer).toContain("id -un");
  });

  it("applies the local host overlay", async () => {
    const packageManifest = await readRepositoryFile("package.json");

    expect(packageManifest).toContain("--patch ./config/host.patch.yml");
    expect(packageManifest).not.toContain("deployment.patch.yml");
  });

  it("reports help and rejects unknown installer arguments without side effects", () => {
    const installer = fileURLToPath(new URL("scripts/install", `file://${repositoryRoot}/`));
    const environment = { ...process.env, XDG_CONFIG_HOME: "relative-test-path" };
    const help = spawnSync(installer, ["--help"], { encoding: "utf8", env: environment });
    const invalid = spawnSync(installer, ["--invalid"], { encoding: "utf8", env: environment });

    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage: scripts/install");
    expect(invalid.status).toBe(2);
    expect(invalid.stderr).toContain("Usage: scripts/install");
  });
});
