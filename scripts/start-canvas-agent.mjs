#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const rootDir = resolveRepoRoot();

if (rootDir) {
  const agentDir = path.join(rootDir, "canvas-agent");
  const entry = path.join(agentDir, "dist", "index.js");
  ensureAgentBuilt(agentDir, entry);

  run(process.execPath, [entry], rootDir);
} else {
  run(npxCommand(), ["-y", "@basketikun/canvas-agent"], pluginRoot);
}

function resolveRepoRoot() {
  return [process.env.V2API_INFINITE_CANVAS_REPO, pluginRoot].filter(Boolean).find((dir) => existsSync(path.join(dir, "canvas-agent"))) || null;
}

function ensureAgentBuilt(agentDir, entry) {
  if (existsSync(entry)) return;
  runNpm(agentDir, ["install", "--package-lock=false", "--legacy-peer-deps"]);
  runNpm(agentDir, ["run", "build"]);
}

function runNpm(agentDir, args) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, args, {
    cwd: agentDir,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function run(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    windowsHide: true,
  });

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}
