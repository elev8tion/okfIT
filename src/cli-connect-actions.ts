import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import { printJson } from "./cli-presenters.js";

const MCP_COMMAND = "npx";
const MCP_ARGS = ["-y", "okfit", "hub", "mcp"];

export async function runConnectCommand(client: string, options: any): Promise<void> {
  const name = options.name ?? "okfit";
  const scope = options.scope ?? "user";
  const dryRun = !!options.dryRun;
  const json = !!options.json;
  const force = !!options.force;

  try {
    if (!["codex", "claude", "cursor", "pi"].includes(client)) {
      throw new Error(`Unsupported client: ${client}. Use codex | claude | cursor | pi.`);
    }

    let result: any;
    switch (client) {
      case "claude":
        result = await connectClaude(name, scope, dryRun, force);
        break;
      case "codex":
        result = await connectCodex(name, dryRun, force);
        break;
      case "cursor":
        result = await connectCursor(name, scope, dryRun, force);
        break;
      case "pi":
        result = await connectPi(name, dryRun, force);
        break;
    }

    if (json) {
      printJson(result);
    } else {
      console.log(pc.green(`Connected ${client} → ${name}`));
      if (result.path) console.log(`Config: ${result.path}`);
      if (result.action) console.log(`Action: ${result.action}`);
      if (result.note) console.log(pc.dim(result.note));
    }
  } catch (error: any) {
    if (json) {
      printJson({ status: "failed", client, name, error: error?.message ?? String(error) });
    } else {
      console.error(pc.red(error?.message ?? "Connect failed."));
    }
    process.exitCode = 1;
  }
}

async function connectClaude(name: string, scope: string, dryRun: boolean, force: boolean) {
  const home = os.homedir();
  const configPath = path.join(home, ".claude.json");

  // Preferred: use official CLI
  const claudeBin = spawnSync("which", ["claude"], { encoding: "utf8" }).stdout.trim();
  if (claudeBin && !dryRun) {
    const args = ["mcp", "add", name, "--scope", scope, "--", MCP_COMMAND, ...MCP_ARGS];
    const r = spawnSync("claude", args, { stdio: "inherit" });
    if (r.status === 0) {
      return { status: "ok", client: "claude", name, path: configPath, action: "claude mcp add" };
    }
  }

  // Fallback: edit ~/.claude.json
  let cfg: any = {};
  if (fs.existsSync(configPath)) {
    try {
      cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch {
      /* ignore parse error, start fresh */
    }
  }

  const entry = { type: "stdio", command: MCP_COMMAND, args: MCP_ARGS };

  if (scope === "project") {
    const cwd = process.cwd();
    if (!cfg.projects) cfg.projects = {};
    if (!cfg.projects[cwd]) cfg.projects[cwd] = { mcpServers: {} };
    if (cfg.projects[cwd].mcpServers?.[name] && !force) {
      return { status: "exists", client: "claude", name, path: configPath, action: "skipped (exists)" };
    }
    cfg.projects[cwd].mcpServers[name] = entry;
  } else {
    if (!cfg.mcpServers) cfg.mcpServers = {};
    if (cfg.mcpServers[name] && !force) {
      return { status: "exists", client: "claude", name, path: configPath, action: "skipped (exists)" };
    }
    cfg.mcpServers[name] = entry;
  }

  if (!dryRun) {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
  }

  return { status: "ok", client: "claude", name, path: configPath, action: dryRun ? "dry-run" : "json-edit" };
}

async function connectCodex(name: string, dryRun: boolean, force: boolean) {
  const home = os.homedir();
  const dir = path.join(home, ".codex");
  const configPath = path.join(dir, "config.toml");

  if (!fs.existsSync(dir) && !dryRun) fs.mkdirSync(dir, { recursive: true });

  let content = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";

  const table = `[mcp_servers.${name}]`;
  const cmdLine = `command = "${MCP_COMMAND}"`;
  const argsLine = `args = ${JSON.stringify(MCP_ARGS)}`;

  if (content.includes(table)) {
    if (!force) {
      return { status: "exists", client: "codex", name, path: configPath, action: "skipped (exists)" };
    }
    // crude replace of the block
    const re = new RegExp(`\\[mcp_servers\\.${name}\\][\\s\\S]*?(?=\\n\\[|$)`, "m");
    content = content.replace(re, `${table}\n${cmdLine}\n${argsLine}\n`);
  } else {
    content += `\n${table}\n${cmdLine}\n${argsLine}\n`;
  }

  if (!dryRun) fs.writeFileSync(configPath, content);

  return { status: "ok", client: "codex", name, path: configPath, action: dryRun ? "dry-run" : "toml-edit" };
}

async function connectCursor(name: string, scope: string, dryRun: boolean, force: boolean) {
  const home = os.homedir();
  const userPath = path.join(home, ".cursor", "mcp.json");
  const projectPath = path.join(process.cwd(), ".cursor", "mcp.json");
  const targetPath = scope === "project" ? projectPath : userPath;

  if (scope === "project" && !fs.existsSync(path.dirname(projectPath)) && !dryRun) {
    fs.mkdirSync(path.dirname(projectPath), { recursive: true });
  }

  let cfg: any = { mcpServers: {} };
  if (fs.existsSync(targetPath)) {
    try {
      cfg = JSON.parse(fs.readFileSync(targetPath, "utf8"));
    } catch {
      /* ignore */
    }
  }
  if (!cfg.mcpServers) cfg.mcpServers = {};

  const entry = { command: MCP_COMMAND, args: MCP_ARGS };

  if (cfg.mcpServers[name] && !force) {
    return { status: "exists", client: "cursor", name, path: targetPath, action: "skipped (exists)" };
  }

  cfg.mcpServers[name] = entry;

  if (!dryRun) {
    fs.writeFileSync(targetPath, JSON.stringify(cfg, null, 2) + "\n");
  }

  return { status: "ok", client: "cursor", name, path: targetPath, action: dryRun ? "dry-run" : "json-edit" };
}

async function connectPi(name: string, dryRun: boolean, force: boolean) {
  const home = os.homedir();
  const bridgePath = path.join(home, ".pi", "mcp-manager", "servers.json");

  if (!fs.existsSync(bridgePath)) {
    const snippet = {
      name,
      kind: "stdio",
      command: MCP_COMMAND,
      args: MCP_ARGS,
      cwd: process.cwd(),
      description: "okfit hub mcp"
    };
    const note = `pi has no native MCP. Create ~/.pi/mcp-manager/servers.json and add:\n${JSON.stringify(snippet, null, 2)}`;
    return { status: "manual", client: "pi", name, note };
  }

  let cfg: any = { servers: [] };
  try {
    cfg = JSON.parse(fs.readFileSync(bridgePath, "utf8"));
  } catch {
    /* ignore */
  }
  if (!cfg.servers) cfg.servers = [];

  const entry = {
    name,
    kind: "stdio",
    command: MCP_COMMAND,
    args: MCP_ARGS,
    cwd: process.cwd(),
    description: "okfit hub mcp"
  };

  const idx = cfg.servers.findIndex((s: any) => s.name === name);
  if (idx !== -1) {
    if (!force) {
      return { status: "exists", client: "pi", name, path: bridgePath, action: "skipped (exists)" };
    }
    cfg.servers[idx] = entry;
  } else {
    cfg.servers.push(entry);
  }

  if (!dryRun) fs.writeFileSync(bridgePath, JSON.stringify(cfg, null, 2) + "\n");

  return { status: "ok", client: "pi", name, path: bridgePath, action: dryRun ? "dry-run" : "json-edit" };
}
