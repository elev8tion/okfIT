import { existsSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import {
  buildHubOverview,
  buildHubSearch,
  hubAuditLogPath,
  importPathIntoHub,
  renderHubLlmsTxt,
  renderHubSitemap,
  serveHubMcpStdio,
  startHubHttpServer
} from "./hub.js";
import { printJson } from "./cli-presenters.js";

export async function runHubCommand(options: any, packageRoot: string): Promise<void> {
  try {
    const okfitHome = options.demo ? await seedDemoHub(packageRoot) : undefined;
    if (options.json) {
      printJson(await buildHubOverview(okfitHome ? { okfitHome } : {}));
      return;
    }
    const serverOptions: { port: any; host: any; okfitHome?: string } = {
      port: options.port,
      host: options.host
    };
    if (okfitHome) serverOptions.okfitHome = okfitHome;
    const server = await startHubHttpServer(serverOptions);
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : options.port;
    const base = `http://${options.host}:${actualPort}`;
    if (options.demo) {
      console.log("okfit hub --demo");
      console.log(pc.green("  Sample data loaded into a temporary hub (discarded on exit)."));
    } else {
      console.log("okfit hub");
    }
    console.log(`Dashboard:  ${base}/  (open in your browser)`);
    console.log(`OKFIT_HOME: ${okfitHome ?? hubAuditLogPath()}`);
    console.log("");
    console.log("JSON API & exports:");
    console.log(`  ${base}/api/overview`);
    console.log(`  ${base}/api/search?q=...`);
    console.log(`  ${base}/api/trace?ref=source:concept`);
    console.log(`  ${base}/api/orphans`);
    console.log(`  ${base}/graph.json`);
    console.log(`  ${base}/llms.txt`);
    console.log(`  ${base}/mcp-manifest.json`);
  } catch (error: any) {
    console.error(pc.red(error?.message ?? "Hub failed."));
    process.exitCode = 1;
  }
}

export async function runDashboardCommand(options: any, packageRoot: string): Promise<void> {
  await runHubCommand(options, packageRoot);
}

/** Seed a temporary OKFIT_HOME with the committed example bundles and return its path. */
async function seedDemoHub(packageRoot: string): Promise<string> {
  const tmpHome = await mkdtemp(path.join(os.tmpdir(), "okfit-demo-"));
  let seeded = 0;
  const bundles: Array<readonly [string, string]> = [
    ["okfit-docs", "okfit-docs"],
    ["stripe", "stripe-checkout-small"]
  ];
  for (const [name, dir] of bundles) {
    const bundle = resolveExampleBundle(packageRoot, dir);
    if (!bundle) continue;
    await importPathIntoHub(bundle, { okfitHome: tmpHome, name, force: true });
    seeded++;
  }
  const cleanup = (): void => {
    try {
      rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      /* ignore — best-effort cleanup of the temp dir */
    }
  };
  process.once("exit", cleanup);
  const stop = (): void => {
    cleanup();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  if (seeded === 0) {
    console.error(pc.yellow("  No example bundles found; serving an empty hub."));
  }
  return tmpHome;
}

function resolveExampleBundle(packageRoot: string, dir: string): string | undefined {
  const rel = path.join("examples", "bundles", dir);
  if (existsSync(rel)) return rel;
  const abs = path.join(packageRoot, rel);
  return existsSync(abs) ? abs : undefined;
}

export async function runHubMcpCommand(options: any): Promise<void> {
  if (options.transport !== "stdio") {
    console.error(pc.red("Only stdio transport is supported for hub MCP."));
    process.exitCode = 1;
    return;
  }
  try {
    console.error(`okfit hub mcp: starting stdio server "${options.name}"`);
    await serveHubMcpStdio({ name: options.name, maxResultChars: options.maxResultChars });
  } catch (error: any) {
    console.error(pc.red(error?.message ?? "Hub MCP failed."));
    process.exitCode = 1;
  }
}

export async function runHubImportCommand(inputPath: string, options: any): Promise<void> {
  try {
    const result = await importPathIntoHub(inputPath, {
      name: options.name,
      force: options.force,
      include: options.include,
      exclude: options.exclude,
      stableTimestamp: options.stableTimestamps ? "2026-06-14T00:00:00.000Z" : undefined,
      dangerouslyAllowUnsafeOutput: options.dangerouslyAllowUnsafeOutput
    });
    if (options.json) {
      printJson({ status: "imported", ...result });
      return;
    }
    console.log("okfit hub import");
    console.log(`Mode: ${result.mode}`);
    console.log(`Name: ${result.record.name}`);
    console.log(`Concepts: ${result.conceptCount}`);
    console.log(`Bundle: ${result.record.bundleDir}`);
  } catch (error: any) {
    if (options.json) printJson({ status: "failed", error: { message: error?.message ?? "Hub import failed." } });
    else console.error(pc.red(error?.message ?? "Hub import failed."));
    process.exitCode = 1;
  }
}

export async function runHubSearchCommand(query: string, options: any): Promise<void> {
  try {
    const search = await buildHubSearch();
    const results = search.search(query, {
      source: options.source,
      type: options.type,
      tags: options.tag,
      limit: options.limit
    });
    if (options.json) {
      printJson(results);
      return;
    }
    for (const result of results) {
      console.log(`${result.ref} — ${result.title ?? result.id}`);
      console.log(`  ${result.type} · ${result.tags.join(", ")}`);
      if (result.snippet) console.log(`  ${result.snippet}`);
    }
  } catch (error: any) {
    if (options.json) printJson({ status: "failed", error: { message: error?.message ?? "Hub search failed." } });
    else console.error(pc.red(error?.message ?? "Hub search failed."));
    process.exitCode = 1;
  }
}

export async function runHubTraceCommand(ref: string, options: any): Promise<void> {
  try {
    const search = await buildHubSearch();
    const trace = search.trace(ref, options.source);
    if (options.json) {
      printJson(trace);
      return;
    }
    console.log(`Trace: ${trace.ref}`);
    if (trace.concept) {
      console.log(`Title: ${trace.concept.title ?? trace.concept.id}`);
      console.log(`Source: ${trace.concept.sourceName}`);
      console.log(`Type: ${trace.concept.type}`);
    }
    console.log("");
    console.log("Creation paths:");
    for (const item of trace.creationPath) console.log(`  ${item.path.join(" -> ")}`);
    if (!trace.creationPath.length) console.log("  none");
    console.log("Depends on:");
    for (const item of trace.dependencies) console.log(`  ${item}`);
    if (!trace.dependencies.length) console.log("  none");
    console.log("Dependents:");
    for (const item of trace.dependents) console.log(`  ${item}`);
    if (!trace.dependents.length) console.log("  none");
    if (trace.sameIdAcrossSources.length) {
      console.log("Same concept id across sources:");
      for (const item of trace.sameIdAcrossSources) console.log(`  ${item}`);
    }
  } catch (error: any) {
    if (options.json) printJson({ status: "failed", error: { message: error?.message ?? "Hub trace failed." } });
    else console.error(pc.red(error?.message ?? "Hub trace failed."));
    process.exitCode = 1;
  }
}

export async function runHubExportCommand(kind: string, options: any): Promise<void> {
  try {
    const baseUrl = options.baseUrl ?? `http://${options.host ?? "127.0.0.1"}:${options.port ?? 8765}`;
    if (kind === "graph") {
      printJson((await buildHubSearch()).toJSONGraph());
      return;
    }
    if (kind === "overview") {
      printJson(await buildHubOverview());
      return;
    }
    if (kind === "llms") {
      console.log(renderHubLlmsTxt(baseUrl));
      return;
    }
    if (kind === "sitemap") {
      console.log(renderHubSitemap(baseUrl));
      return;
    }
    throw new Error("Export kind must be graph, overview, llms, or sitemap.");
  } catch (error: any) {
    console.error(pc.red(error?.message ?? "Hub export failed."));
    process.exitCode = 1;
  }
}
