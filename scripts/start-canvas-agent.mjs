#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoFallback = "D:\\vibecoding\\infinite-canvas";
const rootDir = process.env.V2API_INFINITE_CANVAS_REPO || (existsSync(path.join(pluginRoot, "canvas-agent")) ? pluginRoot : repoFallback);
const agentDir = path.join(rootDir, "canvas-agent");
const entry = path.join(agentDir, "dist", "index.js");

ensureAgentBuilt();

const child = spawn(process.execPath, [entry], {
  cwd: rootDir,
  stdio: "inherit",
  windowsHide: true,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

function ensureAgentBuilt() {
  if (existsSync(entry)) return;
  runNpm(["install", "--package-lock=false", "--legacy-peer-deps"]);
  runNpm(["run", "build"]);
}

function runNpm(args) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, args, {
    cwd: agentDir,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
