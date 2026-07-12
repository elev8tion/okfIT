#!/usr/bin/env node
// Dev loop: rebuild src on change and restart the hub server.
// Usage:
//   pnpm dev                      # build + run `okfit hub`, rebuild on save
//   pnpm dev -- --demo            # seed sample data (no import needed)
//   pnpm dev -- --port 8765       # any hub flags pass through after `--`
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src");
const distCli = path.join(root, "dist", "cli.js");
const tsupBin = path.join(root, "node_modules", ".bin", "tsup");

// Everything after `--` (or any non-`--` arg) passes through to `okfit hub`.
const hubArgs = process.argv.slice(2).filter((a) => a !== "--");

const buildArgs = ["src/cli.ts", "src/index.ts", "src/setup-artifacts.ts", "--format", "esm", "--dts", "--clean"];

let serverProc = null;
let building = false;
let pendingChange = false;

function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: root, stdio: "inherit" });
    p.on("exit", (code) => resolve(code));
  });
}

function startServer() {
  serverProc = spawn("node", [distCli, "hub", ...hubArgs], { cwd: root, stdio: "inherit" });
  serverProc._killed = false;
  serverProc.on("exit", (code) => {
    if (serverProc && !serverProc._killed) {
      console.log(`[dev] hub exited unexpectedly (code ${code}) — will restart on next build`);
    }
  });
}

function restart() {
  if (serverProc) { serverProc._killed = true; serverProc.kill("SIGTERM"); }
  startServer();
}

async function rebuild() {
  if (building) { pendingChange = true; return; }
  building = true;
  console.log("\n[dev] source change → rebuilding…");
  const code = await run(tsupBin, buildArgs);
  building = false;
  if (code === 0) {
    console.log("[dev] build ok → restarting hub");
    restart();
  } else {
    console.log("[dev] build failed — keeping the last running hub");
  }
  if (pendingChange) { pendingChange = false; rebuild(); }
}

let timer = null;
function schedule() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; rebuild(); }, 250);
}

(async () => {
  console.log("[dev] initial build…");
  await run(tsupBin, buildArgs);
  console.log(`[dev] starting hub: node dist/cli.js hub ${hubArgs.join(" ")}`.trim());
  startServer();
  try {
    fs.watch(srcDir, { recursive: true }, () => schedule());
    console.log("[dev] watching src/ for changes (Ctrl-C to stop)");
  } catch {
    console.warn("[dev] recursive watch unavailable on this platform; changes won't auto-rebuild.");
  }
})();

function shutdown() {
  if (serverProc) { serverProc._killed = true; serverProc.kill("SIGTERM"); }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
