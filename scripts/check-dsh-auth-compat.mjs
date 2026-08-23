import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const rootRequire = createRequire(import.meta.url);
const dshPackagePath = rootRequire.resolve("@deepseek-ai/dsh/package.json");
const dshPackage = JSON.parse(await readFile(dshPackagePath, "utf8"));
const dshRequire = createRequire(dshPackagePath);
const webAppPackagePath = dshRequire.resolve("@deepseek-ai/dsh-web-app/package.json");
const webAppPackage = JSON.parse(await readFile(webAppPackagePath, "utf8"));
const webAppRequire = createRequire(webAppPackagePath);

const expectedConsumers = new Map([
  ["@deepseek-ai/dsh-client-connection", ["__DSH_REMOTE_ADMIN__", "isHostTrusted"]],
  ["@deepseek-ai/dsh-client-ui-deliverables", ["connection.isHostTrusted"]],
  ["@deepseek-ai/dsh-client-ui-settings-general", ["connection.isHostTrusted"]],
  ["@deepseek-ai/dsh-client-ui-settings", ["connection.isHostTrusted"]],
]);

for (const [packageName, expectedFragments] of expectedConsumers) {
  const packagePath = webAppRequire.resolve(`${packageName}/package.json`);
  const packageManifest = JSON.parse(await readFile(packagePath, "utf8"));
  if (packageManifest.version !== dshPackage.version) {
    throw new Error(`${packageName} ${packageManifest.version} does not match DSH ${dshPackage.version}`);
  }
  const clientBundle = await readFile(join(dirname(packagePath), "lib/client.js"), "utf8");
  for (const fragment of expectedFragments) {
    if (!clientBundle.includes(fragment)) {
      throw new Error(`${packageName} is missing the authenticated-host compatibility fragment: ${fragment}`);
    }
  }
}

const staleConsumers = [];
for (const packageName of Object.keys(webAppPackage.dependencies ?? {})) {
  if (!packageName.startsWith("@deepseek-ai/dsh-client")) continue;
  const packagePath = webAppRequire.resolve(`${packageName}/package.json`);
  try {
    const clientBundle = await readFile(join(dirname(packagePath), "lib/client.js"), "utf8");
    if (clientBundle.includes("connection.isLoopback")) staleConsumers.push(packageName);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

if (staleConsumers.length > 0) {
  throw new Error(`DSH ${dshPackage.version} has unaudited loopback-only UI consumers: ${staleConsumers.join(", ")}`);
}

console.log(`DSH ${dshPackage.version} authenticated-host compatibility is complete.`);
