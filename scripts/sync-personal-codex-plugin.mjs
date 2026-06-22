#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_NAME = "v2api-infinite-canvas";
const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const homeDir = os.homedir();
const pluginDir = path.join(homeDir, "plugins", PLUGIN_NAME);
const marketplaceFile = path.join(homeDir, ".agents", "plugins", "marketplace.json");

await assertInsideHome(pluginDir);
await fs.rm(pluginDir, { recursive: true, force: true });
await copyFile(".codex-plugin/plugin.json");
await copyFile(".mcp.json");
await copyFile("scripts/start-canvas-agent.mjs");
await copyFile("scripts/start-canvas-mcp.mjs");
await copyFile("skills/v2api-canvas-open/SKILL.md");
await copyFile("skills/v2api-canvas-operate/SKILL.md");
await writeMarketplace();

console.log(`Synced ${PLUGIN_NAME} to ${pluginDir}`);
console.log(`Marketplace: ${marketplaceFile}`);
console.log(`Install or refresh with: codex plugin add ${PLUGIN_NAME}@personal`);

async function copyFile(relativePath) {
  const source = path.join(rootDir, relativePath);
  const target = path.join(pluginDir, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function writeMarketplace() {
  const payload = {
    name: "personal",
    interface: { displayName: "Personal" },
    plugins: [
      {
        name: PLUGIN_NAME,
        source: { source: "local", path: `./plugins/${PLUGIN_NAME}` },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      },
    ],
  };
  await fs.mkdir(path.dirname(marketplaceFile), { recursive: true });
  await fs.writeFile(marketplaceFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function assertInsideHome(target) {
  const relative = path.relative(homeDir, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to sync outside home directory: ${target}`);
  }
}
