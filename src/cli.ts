#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import {
  runCrawlCommand,
  runDemoCommand,
  runImportCommand,
  runInspectCommand,
  runValidateCommand
} from "./cli-content-actions.js";
import {
  runDashboardCommand,
  runHubCommand,
  runHubExportCommand,
  runHubImportCommand,
  runHubMcpCommand,
  runHubSearchCommand,
  runHubTraceCommand
} from "./cli-hub-actions.js";
import {
  runAddCommand,
  runCheckCommand,
  runDoctorCommand,
  runInitCommand,
  runRemoveCommand,
  runSourcesCommand,
  runUpdateCommand
} from "./cli-source-actions.js";
import { parseDurationSeconds } from "./duration.js";
import { packageVersion, runtimePackageRoot } from "./metadata.js";
import {
  parseSetupClient,
  type SetupClient
} from "./setup.js";
import type { RefreshMode } from "./source-store.js";
import {
  runActivateCommand,
  runMapCommand,
  runServeCommand
} from "./cli-workspace-actions.js";
import { runConnectCommand } from "./cli-connect-actions.js";
import { runSetupCommand } from "./cli-setup-actions.js";

const program = new Command();
const cliPath = fileURLToPath(import.meta.url);
const packageRoot = runtimePackageRoot();

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function duration(value: string): number {
  return parseDurationSeconds(value);
}

function integerOption(value: string, label: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    const expectation = minimum === 0 ? "a non-negative integer" : `an integer >= ${minimum}`;
    throw new Error(`Expected ${label} to be ${expectation}, received "${value}".`);
  }
  return parsed;
}

const positiveIntegerOption =
  (label: string) =>
  (value: string): number =>
    integerOption(value, label, 1);
const nonNegativeIntegerOption =
  (label: string) =>
  (value: string): number =>
    integerOption(value, label, 0);

function refreshMode(value: string): RefreshMode {
  if (value === "off" || value === "stale-while-refresh" || value === "blocking") return value;
  throw new Error(`Invalid refresh mode "${value}". Use off, stale-while-refresh, or blocking.`);
}

function setupClient(value: string): SetupClient {
  return parseSetupClient(value);
}

function addSourceRegistrationOptions(command: Command): Command {
  return command
    .option("--max-pages <n>", "Maximum pages", positiveIntegerOption("max-pages"), 100)
    .option("--max-depth <n>", "Maximum crawl depth", nonNegativeIntegerOption("max-depth"), 4)
    .option("--include <pattern>", "Include glob or regex", collect, [])
    .option("--exclude <pattern>", "Exclude glob or regex", collect, [])
    .option("--same-origin", "Stay on same origin", true)
    .option("--no-same-origin", "Allow cross-origin links")
    .option("--respect-robots", "Respect robots.txt", true)
    .option("--no-respect-robots", "Ignore robots.txt")
    .option("--concurrency <n>", "Fetch concurrency", positiveIntegerOption("concurrency"), 4)
    .option("--allow-private-network", "Allow localhost/private IP crawl targets", false)
    .option(
      "--refresh-mode <mode>",
      "Refresh mode: off, stale-while-refresh, or blocking",
      refreshMode,
      "stale-while-refresh"
    )
    .option("--max-age <duration>", "Freshness max age", duration, 24 * 60 * 60)
    .option(
      "--min-refresh-interval <duration>",
      "Minimum interval between refresh attempts",
      duration,
      15 * 60
    )
    .option("--out <dir>", "Explicit active bundle directory")
    .option("--force", "Overwrite an existing source registration", false);
}

program
  .name("okfit")
  .description("Turn docs into agent memory with Open Knowledge Format and MCP.")
  .version(packageVersion());

const initCommand = program
  .command("init")
  .argument("<name>", "Local source name")
  .argument("<url>", "Docs URL to crawl")
  .option(
    "--client <client>",
    "Target client: claude-code, claude-desktop, cursor, codex, or generic",
    setupClient,
    parseSetupClient("generic")
  );

addSourceRegistrationOptions(initCommand)
  .option("--probe-timeout <duration>", "MCP setup probe timeout", duration, 5)
  .option("--json", "Print JSON output", false)
  .action((name, url, options) => runInitCommand(name, url, options, cliPath));

program
  .command("doctor")
  .argument("[names...]", "Registered source name(s)")
  .option("--all", "Check all registered sources as one workspace", false)
  .option(
    "--client <client>",
    "Target client: claude-code, claude-desktop, cursor, codex, or generic",
    setupClient,
    parseSetupClient("generic")
  )
  .option("--max-age <duration>", "Override freshness max age", duration)
  .option("--probe-timeout <duration>", "MCP setup probe timeout", duration, 5)
  .option("--json", "Print JSON output", false)
  .action((names: string[] = [], options) => runDoctorCommand(names, options, cliPath));

const addCommand = program
  .command("add")
  .argument("<name>", "Local source name")
  .argument("<url>", "Docs URL to crawl");

addSourceRegistrationOptions(addCommand)
  .option("--json", "Print JSON output", false)
  .action(runAddCommand);

program
  .command("sources")
  .option("--json", "Print JSON output", false)
  .action(runSourcesCommand);

program
  .command("check")
  .argument("<name-or-bundle>", "Registered source name or OKF bundle directory")
  .option("--max-age <duration>", "Override freshness max age", duration)
  .option("--json", "Print JSON output", false)
  .action(runCheckCommand);

program
  .command("update")
  .argument("<name>", "Registered source name")
  .option("--json", "Print JSON output", false)
  .option("--dry-run", "Report what would be refreshed without replacing the active bundle", false)
  .action(runUpdateCommand);

program
  .command("remove")
  .argument("<name>", "Registered source name")
  .option("-y, --yes", "Skip confirmation", false)
  .option("--json", "Print JSON output", false)
  .action(runRemoveCommand);

program
  .command("crawl")
  .argument("<url>", "Docs URL to crawl")
  .requiredOption("--out <dir>", "Output OKF bundle directory")
  .option("--max-pages <n>", "Maximum pages", positiveIntegerOption("max-pages"), 100)
  .option("--max-depth <n>", "Maximum crawl depth", nonNegativeIntegerOption("max-depth"), 4)
  .option("--include <pattern>", "Include glob or regex", collect, [])
  .option("--exclude <pattern>", "Exclude glob or regex", collect, [])
  .option("--same-origin", "Stay on same origin", true)
  .option("--no-same-origin", "Allow cross-origin links")
  .option("--respect-robots", "Respect robots.txt", true)
  .option("--no-respect-robots", "Ignore robots.txt")
  .option("--concurrency <n>", "Fetch concurrency", positiveIntegerOption("concurrency"), 4)
  .option("--title <name>", "Bundle title")
  .option("--force", "Overwrite output directory", false)
  .option("--dry-run", "List pages that would be crawled", false)
  .option("--allow-private-network", "Allow localhost/private IP crawl targets", false)
  .option(
    "--dangerously-allow-unsafe-output",
    "Dangerously allow --force to delete otherwise unsafe output paths",
    false
  )
  .option("--stable-timestamps", "Use a deterministic timestamp in generated frontmatter", false)
  .action(runCrawlCommand);

program
  .command("import")
  .argument("<path>", "Local docs folder or file")
  .requiredOption("--out <dir>", "Output OKF bundle directory")
  .option("--source-name <name>", "Source name")
  .option("--include <glob>", "Include glob", collect, [])
  .option("--exclude <glob>", "Exclude glob", collect, [])
  .option("--force", "Overwrite output directory", false)
  .option(
    "--dangerously-allow-unsafe-output",
    "Dangerously allow --force to delete otherwise unsafe output paths",
    false
  )
  .option("--stable-timestamps", "Use a deterministic timestamp in generated frontmatter", false)
  .action(runImportCommand);

program
  .command("validate")
  .argument("<bundle>", "OKF bundle directory")
  .option("--json", "Print JSON report", false)
  .action(runValidateCommand);

program
  .command("inspect")
  .argument("<bundle>", "OKF bundle directory")
  .action(runInspectCommand);

program
  .command("activate")
  .argument(
    "[targets...]",
    "Registered source name(s), OKF bundle path(s), or one OKF bundle directory"
  )
  .option("--all", "Activate all registered sources as one source-aware workspace", false)
  .option(
    "--client <client>",
    "Target client: claude-code, claude-desktop, cursor, codex, or generic",
    setupClient,
    "generic"
  )
  .option("--out <dir>", "Activation packet output directory", "okfit-activation")
  .option("--task <text>", "Task or question to prove with search_concepts in okfit-proof.json")
  .option("--force", "Overwrite a non-empty activation output directory", false)
  .option("--json", "Print activation packet manifest JSON", false)
  .action(runActivateCommand);

program
  .command("map")
  .argument(
    "[targets...]",
    "Registered source name(s), OKF bundle path(s), or one OKF bundle directory"
  )
  .option("--all", "Map all registered sources as one source-aware workspace", false)
  .option("--out <file>", "Inspector HTML output file", "okfit-inspector.html")
  .option("--json", "Print Inspector report JSON without writing HTML", false)
  .action(runMapCommand);

const hubCommand = program
  .command("hub")
  .description("Start the OKFIT central memory hub dashboard and JSON API")
  .option("--host <host>", "Host interface", "127.0.0.1")
  .option("--port <n>", "HTTP port", positiveIntegerOption("port"), 8765)
  .option("--json", "Print hub overview JSON without starting a server", false)
  .option("--demo", "Serve the dashboard with sample data (no import required)", false)
  .action((options: any) => runHubCommand(options, packageRoot));

hubCommand
  .command("import")
  .description("Import an OKF bundle or local docs folder into the hub")
  .argument("<path>", "OKF bundle or outside-project docs path to import into the hub")
  .option("--name <name>", "Hub source name")
  .option("--include <glob>", "Include glob for non-OKF local imports", collect, [])
  .option("--exclude <glob>", "Exclude glob for non-OKF local imports", collect, [])
  .option("--force", "Replace an existing hub import with the same name", false)
  .option(
    "--dangerously-allow-unsafe-output",
    "Dangerously allow importer output safety bypass for converted local imports",
    false
  )
  .option("--stable-timestamps", "Use a deterministic timestamp in generated frontmatter", false)
  .option("--json", "Print JSON output", false)
  .action(runHubImportCommand);

hubCommand
  .command("search")
  .description("Search every concept across all hub sources")
  .argument("<query>", "Global hub search query")
  .option("--source <name>", "Filter by source name")
  .option("--type <type>", "Filter by concept type")
  .option("--tag <tag>", "Filter by tag", collect, [])
  .option("--limit <n>", "Maximum results", positiveIntegerOption("limit"), 10)
  .option("--json", "Print JSON output", false)
  .action(runHubSearchCommand);

hubCommand
  .command("trace")
  .description("Trace a concept's creation path, dependencies, and dependents")
  .argument("<ref-or-id>", "Concept ref (source:id) or id")
  .option("--source <name>", "Source name for id-only trace")
  .option("--json", "Print JSON output", false)
  .action(runHubTraceCommand);

hubCommand
  .command("export")
  .description("Export the hub graph, overview, llms.txt, or sitemap without starting a server")
  .argument("<kind>", "Export kind: graph, overview, llms, sitemap")
  .option("--base-url <url>", "Base URL for crawlable exports")
  .option("--host <host>", "Host used for default base URL", "127.0.0.1")
  .option("--port <n>", "Port used for default base URL", positiveIntegerOption("port"), 8765)
  .action(runHubExportCommand);

hubCommand
  .command("mcp")
  .description("Start the central hub MCP server over stdio")
  .option("--transport <transport>", "Transport: stdio", "stdio")
  .option("--name <server-name>", "MCP server name", "okfit-hub")
  .option(
    "--max-result-chars <n>",
    "Maximum characters per tool result",
    positiveIntegerOption("max-result-chars"),
    12000
  )
  .action(runHubMcpCommand);

program
  .command("dashboard")
  .description("Alias for okfit hub")
  .option("--host <host>", "Host interface", "127.0.0.1")
  .option("--port <n>", "HTTP port", positiveIntegerOption("port"), 8765)
  .option("--json", "Print hub overview JSON without starting a server", false)
  .option("--demo", "Serve the dashboard with sample data (no import required)", false)
  .action((options: any) => runDashboardCommand(options, packageRoot));

program
  .command("connect")
  .description("Register the okfit Hub MCP server with an AI coding client")
  .argument("<client>", "codex | claude | cursor | pi")
  .option("--name <name>", "MCP server name", "okfit")
  .option("--scope <scope>", "user | project (for claude/cursor)", "user")
  .option("--force", "Overwrite existing entry", false)
  .option("--dry-run", "Print what would change without writing", false)
  .option("--json", "Print JSON result", false)
  .action(runConnectCommand);

program
  .command("setup")
  .description("One-command: register + crawl + activate + import into hub")
  .argument("<target>", "URL or local path")
  .requiredOption("--name <name>", "Source name (required)")
  .option("--client <client>", "generic | claude | codex | cursor | pi", "generic")
  .option("--out <dir>", "Activation output directory", "okfit-activation")
  .option("--force", "Overwrite existing", false)
  .option("--probe", "Run MCP probe (default)", true)
  .option("--no-probe", "Skip MCP probe")
  .option("--json", "JSON output", false)
  .action((target, opts) => runSetupCommand(target, opts, cliPath));

program
  .command("serve")
  .argument(
    "[targets...]",
    "Registered source name(s), OKF bundle path(s), or one OKF bundle directory"
  )
  .option("--all", "Serve all registered sources as one source-aware workspace", false)
  .option("--mcp", "Start MCP server", false)
  .option("--transport <transport>", "Transport: stdio", "stdio")
  .option("--name <server-name>", "MCP server name", "okfit")
  .option(
    "--max-result-chars <n>",
    "Maximum characters per tool result",
    positiveIntegerOption("max-result-chars"),
    12000
  )
  .option("--auto-refresh", "Enable registered source refresh behavior", false)
  .option(
    "--refresh-mode <mode>",
    "Refresh mode override: off, stale-while-refresh, or blocking",
    refreshMode
  )
  .option("--max-age <duration>", "Override freshness max age", duration)
  .action(runServeCommand);

program
  .command("demo")
  .description("Run offline demo against committed example bundle")
  .action(() => runDemoCommand(packageRoot));

program.parseAsync(process.argv);
