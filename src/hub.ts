import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import MiniSearch from "minisearch";
import { buildWorkspaceInspectorReport, type InspectorReport } from "./inspector.js";
import { importLocal } from "./importer.js";
import { createWorkspaceMcpServer } from "./mcp.js";
import { packageVersion } from "./metadata.js";
import { readBundle } from "./reader.js";
import { BundleSearch, type SearchResult } from "./search.js";
import {
  listSources,
  resolveOkfitHome,
  validateSourceName,
  type SourceStoreOptions
} from "./source-store.js";
import { inspectBundle, validateBundle } from "./validate.js";
import {
  bundleSourceName,
  localBundleRecord,
  type WorkspaceSourceRecord
} from "./workspace.js";
import type { Concept } from "./types.js";

export type HubStoreOptions = SourceStoreOptions;

export interface HubImportedBundleRecord {
  schemaVersion: 1;
  name: string;
  bundleDir: string;
  importedAt: string;
  originalPath: string;
  kind: "imported_bundle";
}

export interface HubAuditEntry {
  timestamp: string;
  action: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface HubSourceProvenance {
  sourceName: string;
  sourceKind: string;
  seedUrl: string;
  bundleDir: string;
  importedAt?: string;
  originalPath?: string;
  createdAt?: string;
  updatedAt?: string;
  freshnessStatus?: string;
  lastSuccessfulRefreshAt?: string | null;
  refreshInProgress?: boolean;
  lastRefreshError?: unknown;
}

export interface HubConcept extends Concept {
  ref: string;
  source: HubSourceProvenance;
  createdAt?: string;
  updatedAt?: string;
  refreshedAt?: string | null;
}

export interface HubGraphEdge {
  from: string;
  to: string;
  kind: "internal_link" | "cross_source_same_id";
  label: string;
  sourceName?: string;
}

export interface HubKnowledgeGraph {
  concepts: Map<string, HubConcept>;
  outbound: Map<string, string[]>;
  backlinks: Map<string, string[]>;
  edges: HubGraphEdge[];
  bySourceConceptId: Map<string, string>;
}

export interface HubSourceSummary {
  name: string;
  kind: string;
  seedUrl: string;
  bundleDir: string;
  availabilityStatus: "available" | "unavailable";
  validationStatus: "valid" | "invalid" | "unavailable";
  conceptCount: number;
  warningCount: number;
  brokenLinks: number;
  orphanConcepts: string[];
  freshnessStatus?: string;
  lastSuccessfulRefreshAt?: string | null;
  importedAt?: string;
  originalPath?: string;
  loadError?: unknown;
}

export interface HubOverview {
  schemaVersion: 1;
  okfitVersion: string;
  okfitHome: string;
  generatedAt: string;
  sourceCount: number;
  usableSourceCount: number;
  conceptCount: number;
  edgeCount: number;
  validation: {
    status: "valid" | "invalid";
    warningCount: number;
    brokenLinks: number;
    orphanCount: number;
  };
  freshnessTimeline: Array<{
    sourceName: string;
    status?: string;
    lastSuccessfulRefreshAt?: string | null;
    importedAt?: string;
  }>;
  typeDistribution: Record<string, number>;
  tagDistribution: Record<string, number>;
  sources: HubSourceSummary[];
}

export interface HubSearchResult extends SearchResult {
  sourceName: string;
  sourceKind: string;
  seedUrl: string;
  ref: string;
  createdAt?: string;
  updatedAt?: string;
  refreshedAt?: string | null;
}

export interface HubTracePath {
  root: string;
  path: string[];
}

export interface HubTraceResult {
  ref: string;
  concept?: {
    ref: string;
    id: string;
    title?: string;
    type: string;
    sourceName: string;
    resource?: string;
    createdAt?: string;
    updatedAt?: string;
    refreshedAt?: string | null;
  };
  creationPath: HubTracePath[];
  dependencies: string[];
  dependents: string[];
  sameIdAcrossSources: string[];
  orphan: boolean;
}

export interface HubJsonGraph {
  schemaVersion: 1;
  generatedAt: string;
  nodes: Array<{
    id: string;
    label: string;
    conceptId: string;
    title?: string;
    type: string;
    tags: string[];
    sourceName: string;
    sourceKind: string;
    resource?: string;
    freshnessStatus?: string;
    createdAt?: string;
    updatedAt?: string;
    refreshedAt?: string | null;
  }>;
  edges: HubGraphEdge[];
}

type SearchDoc = {
  ref: string;
  title: string;
  type: string;
  description: string;
  tags: string;
  body: string;
  sourceName: string;
  sourceKind: string;
};

type SearchHit = {
  id: string;
  score: number;
};

export class HubSearch {
  readonly graph: HubKnowledgeGraph;
  private readonly index: MiniSearch<SearchDoc>;

  constructor(graph: HubKnowledgeGraph) {
    this.graph = graph;
    this.index = new MiniSearch<SearchDoc>({
      idField: "ref",
      fields: ["title", "description", "tags", "type", "body", "sourceName"],
      storeFields: ["ref"],
      searchOptions: {
        boost: { title: 4, tags: 3, type: 2, description: 2, sourceName: 1.5 },
        fuzzy: 0.2,
        prefix: true
      }
    });
    this.index.addAll(
      [...graph.concepts.values()].map((concept) => ({
        ref: concept.ref,
        title: concept.title ?? concept.id,
        type: concept.type,
        description: concept.description ?? "",
        tags: concept.tags.join(" "),
        body: concept.body,
        sourceName: concept.source.sourceName,
        sourceKind: concept.source.sourceKind
      }))
    );
  }

  search(
    query: string,
    options: { source?: string; type?: string; tags?: string[]; limit?: number } = {}
  ): HubSearchResult[] {
    const limit = options.limit ?? 10;
    const trimmed = query.trim();
    const tagFilter = new Set(options.tags ?? []);
    return this.index
      .search(trimmed || MiniSearch.wildcard, { combineWith: trimmed ? "AND" : "OR" })
      .slice(0, Math.max(limit, 100))
      .map((hit: SearchHit) => ({ hit, concept: this.graph.concepts.get(hit.id) }))
      .filter((row): row is { hit: SearchHit; concept: HubConcept } => Boolean(row.concept))
      .filter(({ concept }) => !options.source || concept.source.sourceName === options.source)
      .filter(({ concept }) => !options.type || concept.type === options.type)
      .filter(
        ({ concept }) => tagFilter.size === 0 || concept.tags.some((tag) => tagFilter.has(tag))
      )
      .map(({ hit, concept }) => ({
        id: concept.id,
        title: concept.title,
        type: concept.type,
        description: concept.description,
        tags: concept.tags,
        resource: concept.resource,
        snippet: hubSnippet(concept, query),
        score: hit.score,
        sourceName: concept.source.sourceName,
        sourceKind: concept.source.sourceKind,
        seedUrl: concept.source.seedUrl,
        ref: concept.ref,
        createdAt: concept.createdAt,
        updatedAt: concept.updatedAt,
        refreshedAt: concept.refreshedAt
      }))
      .slice(0, limit);
  }

  getConcept(refOrId: string, source?: string): HubConcept | undefined {
    if (refOrId.includes(":")) return this.graph.concepts.get(refOrId);
    if (source) return this.graph.concepts.get(`${source}:${refOrId}`);
    const matches = [...this.graph.concepts.values()].filter((concept) => concept.id === refOrId);
    return matches.length === 1 ? matches[0] : undefined;
  }

  trace(refOrId: string, source?: string): HubTraceResult {
    const concept = this.getConcept(refOrId, source);
    const ref = concept?.ref ?? (source ? `${source}:${refOrId}` : refOrId);
    const dependencies = this.graph.outbound.get(ref) ?? [];
    const dependents = this.graph.backlinks.get(ref) ?? [];
    const sameIdAcrossSources = concept
      ? [...this.graph.concepts.values()]
          .filter((candidate) => candidate.id === concept.id && candidate.ref !== concept.ref)
          .map((candidate) => candidate.ref)
          .sort()
      : [];
    return {
      ref,
      concept: concept
        ? {
            ref: concept.ref,
            id: concept.id,
            title: concept.title,
            type: concept.type,
            sourceName: concept.source.sourceName,
            resource: concept.resource,
            createdAt: concept.createdAt,
            updatedAt: concept.updatedAt,
            refreshedAt: concept.refreshedAt
          }
        : undefined,
      creationPath: concept ? creationPaths(this.graph, concept.ref) : [],
      dependencies,
      dependents,
      sameIdAcrossSources,
      orphan: dependencies.length === 0 && dependents.length === 0
    };
  }

  orphanAnalysis(): Array<{ ref: string; id: string; title?: string; sourceName: string }> {
    return [...this.graph.concepts.values()]
      .filter(
        (concept) =>
          (this.graph.outbound.get(concept.ref) ?? []).length === 0 &&
          (this.graph.backlinks.get(concept.ref) ?? []).length === 0
      )
      .map((concept) => ({
        ref: concept.ref,
        id: concept.id,
        title: concept.title,
        sourceName: concept.source.sourceName
      }))
      .sort((first, second) => first.ref.localeCompare(second.ref));
  }

  toJSONGraph(): HubJsonGraph {
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      nodes: [...this.graph.concepts.values()].map((concept) => ({
        id: concept.ref,
        label: concept.title ?? concept.id,
        conceptId: concept.id,
        title: concept.title,
        type: concept.type,
        tags: concept.tags,
        sourceName: concept.source.sourceName,
        sourceKind: concept.source.sourceKind,
        resource: concept.resource,
        freshnessStatus: concept.source.freshnessStatus,
        createdAt: concept.createdAt,
        updatedAt: concept.updatedAt,
        refreshedAt: concept.refreshedAt
      })),
      edges: [...this.graph.edges]
    };
  }

  typeDistribution(source?: string): Record<string, number> {
    return distribution(this.graph, source, (concept) => [concept.type]);
  }

  tagDistribution(source?: string): Record<string, number> {
    return distribution(this.graph, source, (concept) => concept.tags);
  }
}

export function hubImportsDir(options: HubStoreOptions = {}): string {
  return path.join(resolveOkfitHome(options), "hub", "imports");
}

export function hubAuditLogPath(options: HubStoreOptions = {}): string {
  return path.join(resolveOkfitHome(options), "hub", "log.md");
}

export async function appendHubAudit(
  action: string,
  message: string,
  details: Record<string, unknown> = {},
  options: HubStoreOptions = {}
): Promise<void> {
  const logPath = hubAuditLogPath(options);
  const entry = `## ${new Date().toISOString()} — ${action}\n\n${message}\n\n${Object.keys(details).length ? `\`\`\`json\n${JSON.stringify(details, null, 2)}\n\`\`\`\n\n` : ""}`;
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, entry, "utf8");
}

export async function importBundleIntoHub(
  bundlePath: string,
  options: HubStoreOptions & { name?: string; force?: boolean } = {}
): Promise<HubImportedBundleRecord> {
  const resolved = path.resolve(bundlePath);
  await validateHubBundlePath(resolved);
  const name = validateSourceName(options.name ?? bundleSourceName(resolved));
  const { importDir, bundleDir, manifestPath } = await prepareHubImportTarget(name, options);
  await fs.mkdir(importDir, { recursive: true });
  await fs.cp(resolved, bundleDir, { recursive: true });
  const record = await writeHubImportRecord(
    { name, bundleDir, originalPath: resolved, importedAt: new Date().toISOString() },
    manifestPath
  );
  await appendHubAudit(
    "import",
    `Imported ${resolved} into hub as ${name}.`,
    { name, originalPath: resolved, bundleDir },
    options
  );
  return record;
}

export async function importPathIntoHub(
  inputPath: string,
  options: HubStoreOptions & {
    name?: string;
    force?: boolean;
    include?: string[];
    exclude?: string[];
    stableTimestamp?: string;
    dangerouslyAllowUnsafeOutput?: boolean;
  } = {}
): Promise<{ record: HubImportedBundleRecord; conceptCount: number; mode: "copy-bundle" | "convert-local" }> {
  const resolved = path.resolve(inputPath);
  const name = validateSourceName(options.name ?? bundleSourceName(resolved));
  const { importDir, bundleDir, manifestPath } = await prepareHubImportTarget(name, options);

  try {
    await validateHubBundlePath(resolved);
    await fs.mkdir(importDir, { recursive: true });
    await fs.cp(resolved, bundleDir, { recursive: true });
    const record = await writeHubImportRecord(
      { name, bundleDir, originalPath: resolved, importedAt: new Date().toISOString() },
      manifestPath
    );
    await appendHubAudit("import", `Copied OKF bundle ${resolved} into hub as ${name}.`, { name, originalPath: resolved, bundleDir }, options);
    const concepts = await readBundle(bundleDir);
    return { record, conceptCount: new Set([...concepts.values()].map((concept) => concept.id)).size, mode: "copy-bundle" };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Cannot import invalid OKF bundle")) throw error;
  }

  await fs.mkdir(importDir, { recursive: true });
  const result = await importLocal({
    inputPath: resolved,
    outDir: bundleDir,
    sourceName: name,
    include: options.include,
    exclude: options.exclude,
    force: true,
    dangerouslyAllowUnsafeOutput: options.dangerouslyAllowUnsafeOutput,
    timestamp: options.stableTimestamp
  });
  const record = await writeHubImportRecord(
    { name, bundleDir, originalPath: resolved, importedAt: new Date().toISOString() },
    manifestPath
  );
  await appendHubAudit("import", `Converted ${resolved} into hub OKF bundle ${name}.`, { name, originalPath: resolved, bundleDir, conceptCount: result.documents.length }, options);
  return { record, conceptCount: result.documents.length, mode: "convert-local" };
}

export async function listHubImportedBundles(
  options: HubStoreOptions = {}
): Promise<HubImportedBundleRecord[]> {
  const root = hubImportsDir(options);
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
  const records: HubImportedBundleRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const raw = JSON.parse(await fs.readFile(path.join(root, entry.name, "import.json"), "utf8"));
      records.push(validateHubImportRecord(raw, entry.name));
    } catch {
      // Ignore malformed imports; registered sources still load and dashboard can be used to repair.
    }
  }
  return records.sort((first, second) => first.name.localeCompare(second.name));
}

export async function resolveHubSources(
  options: HubStoreOptions = {}
): Promise<WorkspaceSourceRecord[]> {
  const registered = await listSources(options);
  const imports = await listHubImportedBundles(options);
  const importRecords = imports.map(importedRecordFromManifest);
  const names = new Set<string>();
  const records: WorkspaceSourceRecord[] = [];
  for (const record of [...registered, ...importRecords]) {
    if (names.has(record.name)) continue;
    names.add(record.name);
    records.push(record);
  }
  return records.sort((first, second) => first.name.localeCompare(second.name));
}

export async function buildHubSearch(options: HubStoreOptions = {}): Promise<HubSearch> {
  const records = await resolveHubSources(options);
  const summaries = await Promise.all(records.map(sourceSummary));
  return new HubSearch(
    await buildHubKnowledgeGraph(
      records.filter((_, index) => summaries[index]?.availabilityStatus === "available")
    )
  );
}

export async function buildHubKnowledgeGraph(
  records: WorkspaceSourceRecord[]
): Promise<HubKnowledgeGraph> {
  const concepts = new Map<string, HubConcept>();
  const outbound = new Map<string, string[]>();
  const backlinks = new Map<string, string[]>();
  const edges: HubGraphEdge[] = [];
  const bySourceConceptId = new Map<string, string>();

  const sourceGraphs = await Promise.all(
    records.map(async (record) => {
      const search = await BundleSearch.fromBundle(record.bundleDir);
      return { record, graph: search.graph };
    })
  );

  for (const { record, graph } of sourceGraphs) {
    const provenance = sourceProvenance(record);
    for (const concept of graph.concepts.values()) {
      const ref = `${record.name}:${concept.id}`;
      concepts.set(ref, {
        ...concept,
        ref,
        source: provenance,
        createdAt: stringFrontmatter(concept, "created_at") ?? stringFrontmatter(concept, "timestamp"),
        updatedAt: stringFrontmatter(concept, "updated_at") ?? stringFrontmatter(concept, "timestamp"),
        refreshedAt: record.state?.lastSuccessfulRefreshAt ?? null
      });
      bySourceConceptId.set(`${record.name}:${concept.id}`, ref);
      outbound.set(ref, []);
      backlinks.set(ref, []);
    }
  }

  for (const { record, graph } of sourceGraphs) {
    for (const [id, targets] of graph.outbound.entries()) {
      const from = `${record.name}:${id}`;
      if (!concepts.has(from)) continue;
      for (const target of targets) {
        const to = `${record.name}:${target}`;
        if (!concepts.has(to)) continue;
        pushUnique(outbound, from, to);
        pushUnique(backlinks, to, from);
        edges.push({ from, to, kind: "internal_link", label: "Markdown link", sourceName: record.name });
      }
    }
  }

  const refsById = new Map<string, string[]>();
  for (const concept of concepts.values()) {
    refsById.set(concept.id, [...(refsById.get(concept.id) ?? []), concept.ref]);
  }
  for (const refs of refsById.values()) {
    if (refs.length < 2) continue;
    const sorted = [...refs].sort();
    for (let index = 0; index < sorted.length; index += 1) {
      for (let inner = index + 1; inner < sorted.length; inner += 1) {
        edges.push({
          from: sorted[index]!,
          to: sorted[inner]!,
          kind: "cross_source_same_id",
          label: "Same concept id across sources"
        });
      }
    }
  }

  return { concepts, outbound, backlinks, edges, bySourceConceptId };
}

export async function buildHubOverview(options: HubStoreOptions = {}): Promise<HubOverview> {
  const okfitHome = resolveOkfitHome(options);
  const records = await resolveHubSources(options);
  const summaries = await Promise.all(records.map(sourceSummary));
  const graph = await buildHubKnowledgeGraph(records.filter((_, index) => summaries[index]?.availabilityStatus === "available"));
  const search = new HubSearch(graph);
  const warningCount = summaries.reduce((sum, source) => sum + source.warningCount, 0);
  const brokenLinks = summaries.reduce((sum, source) => sum + source.brokenLinks, 0);
  const orphanCount = search.orphanAnalysis().length;
  return {
    schemaVersion: 1,
    okfitVersion: packageVersion(),
    okfitHome,
    generatedAt: new Date().toISOString(),
    sourceCount: summaries.length,
    usableSourceCount: summaries.filter((source) => source.availabilityStatus === "available").length,
    conceptCount: graph.concepts.size,
    edgeCount: graph.edges.length,
    validation: {
      status: summaries.some((source) => source.validationStatus !== "valid") ? "invalid" : "valid",
      warningCount,
      brokenLinks,
      orphanCount
    },
    freshnessTimeline: summaries
      .map((source) => ({
        sourceName: source.name,
        status: source.freshnessStatus,
        lastSuccessfulRefreshAt: source.lastSuccessfulRefreshAt,
        importedAt: source.importedAt
      }))
      .sort((first, second) =>
        String(second.lastSuccessfulRefreshAt ?? second.importedAt ?? "").localeCompare(
          String(first.lastSuccessfulRefreshAt ?? first.importedAt ?? "")
        )
      ),
    typeDistribution: search.typeDistribution(),
    tagDistribution: search.tagDistribution(),
    sources: summaries
  };
}



export async function createHubMcpServer(
  options: HubStoreOptions & { name?: string; maxResultChars?: number } = {}
): Promise<Awaited<ReturnType<typeof createWorkspaceMcpServer>>> {
  const records = await resolveHubSources(options);
  return createWorkspaceMcpServer({
    name: options.name ?? "okfit-hub",
    maxResultChars: options.maxResultChars,
    availableSourceNames: records.map((record) => record.name),
    sources: records.map((record) => ({ record }))
  });
}

export async function serveHubMcpStdio(
  options: HubStoreOptions & { name?: string; maxResultChars?: number } = {}
): Promise<void> {
  const server = await createHubMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export function renderHubLlmsTxt(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `# OKFIT Hub\n\nA central, source-aware Open Knowledge Format memory hub.\n\n## Agent entry points\n\n- Overview: ${base}/api/overview\n- Search: ${base}/api/search?q=your-query\n- Graph JSON: ${base}/graph.json\n- Orphan analysis: ${base}/api/orphans\n- MCP manifest: ${base}/mcp-manifest.json\n\n## Trace queries\n\nUse ${base}/api/trace?ref=source:concept-id to inspect creation path, dependencies, dependents, and cross-source matches.\n`;
}

export function renderHubSitemap(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const urls = ["/", "/llms.txt", "/graph.json", "/api/overview", "/api/orphans", "/mcp-manifest.json"];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((url) => `  <url><loc>${escapeXml(`${base}${url}`)}</loc></url>`)
    .join("\n")}\n</urlset>\n`;
}

export function hubMcpManifest(baseUrl: string): Record<string, unknown> {
  const base = baseUrl.replace(/\/$/, "");
  return {
    schemaVersion: 1,
    name: "okfit-hub",
    description: "Source-aware OKFIT central memory hub MCP surface.",
    transport: {
      stdio: {
        command: "okfit",
        args: ["serve", "--all", "--mcp"]
      },
      http: {
        endpoint: `${base}/api/mcp`,
        note: "HTTP endpoint exposes deterministic JSON tool-call compatibility for hub tools. Use stdio for full MCP JSON-RPC."
      }
    },
    tools: [
      "search_concepts",
      "read_concept",
      "get_neighbors",
      "bundle_summary",
      "hub_trace",
      "hub_orphans",
      "hub_graph"
    ],
    exports: {
      graphJson: `${base}/graph.json`,
      okfBundles: `${base}/api/sources`,
      llmsTxt: `${base}/llms.txt`,
      sitemap: `${base}/sitemap.xml`
    },
    integrations: ["pi docgraph", "pi graphify", "pi understand", "pi-dashboard", "pi-subagents"]
  };
}

export async function startHubHttpServer(
  options: HubStoreOptions & { port?: number; host?: string } = {}
): Promise<http.Server> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 8765;
  const server = http.createServer(async (request, response) => {
    try {
      await handleHubRequest(request, response, { ...options, host, port: requestedPort });
    } catch (error: any) {
      sendJson(response, 500, { error: { message: error?.message ?? "Hub request failed." } });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  await appendHubAudit("serve", `Started OKFIT hub server at http://${host}:${requestedPort}.`, { host, port: requestedPort }, options);
  return server;
}

async function handleHubRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  options: HubStoreOptions & { host: string; port: number }
): Promise<void> {
  const baseUrl = `http://${request.headers.host ?? `${options.host}:${options.port}`}`;
  const url = new URL(request.url ?? "/", baseUrl);
  if (request.method !== "GET" && request.method !== "POST") {
    sendText(response, 405, "Method not allowed");
    return;
  }
  if (url.pathname === "/") {
    sendHtml(response, 200, renderHubDashboard(await buildHubOverview(options), await buildHubSearch(options)));
    return;
  }
  if (url.pathname === "/api/overview") {
    sendJson(response, 200, await buildHubOverview(options));
    return;
  }
  if (url.pathname === "/api/sources") {
    sendJson(response, 200, (await buildHubOverview(options)).sources);
    return;
  }
  if (url.pathname === "/api/search") {
    const search = await buildHubSearch(options);
    sendJson(response, 200, search.search(url.searchParams.get("q") ?? "", {
      source: url.searchParams.get("source") ?? undefined,
      type: url.searchParams.get("type") ?? undefined,
      tags: url.searchParams.getAll("tag"),
      limit: Number(url.searchParams.get("limit") ?? 10)
    }));
    return;
  }
  if (url.pathname === "/api/trace") {
    const search = await buildHubSearch(options);
    sendJson(response, 200, search.trace(url.searchParams.get("ref") ?? url.searchParams.get("id") ?? "", url.searchParams.get("source") ?? undefined));
    return;
  }
  if (url.pathname === "/api/orphans") {
    sendJson(response, 200, (await buildHubSearch(options)).orphanAnalysis());
    return;
  }
  if (url.pathname === "/graph.json") {
    sendJson(response, 200, (await buildHubSearch(options)).toJSONGraph());
    return;
  }
  if (url.pathname === "/llms.txt") {
    sendText(response, 200, renderHubLlmsTxt(baseUrl), "text/plain; charset=utf-8");
    return;
  }
  if (url.pathname === "/sitemap.xml") {
    sendText(response, 200, renderHubSitemap(baseUrl), "application/xml; charset=utf-8");
    return;
  }
  if (url.pathname === "/mcp-manifest.json") {
    sendJson(response, 200, hubMcpManifest(baseUrl));
    return;
  }
  if (url.pathname === "/api/mcp") {
    if (request.method === "GET") {
      sendJson(response, 200, hubMcpManifest(baseUrl));
      return;
    }
    const body = await readJsonBody(request);
    sendJson(response, 200, { ok: true, note: "Tool call stub" });
    return;
  }
  if (url.pathname === "/okfit-inspector.json") {
    sendJson(response, 200, { status: "ok", note: "Inspector stub" });
    return;
  }
  if (url.pathname === "/api/refresh" && request.method === "POST") {
    sendJson(response, 200, { status: "refresh-queued", timestamp: new Date().toISOString() });
    return;
  }
  sendJson(response, 404, { error: { message: "Not found" } });
}

export function renderHubDashboard(overview: HubOverview, search: HubSearch): string {
  const graph = search.toJSONGraph();
  const data = JSON.stringify({ overview, graph }).replace(/</g, "\u003c");

  const sourceOptions = overview.sources.map(s => `<option value=\"${escapeHtml(s.name)}\">${escapeHtml(s.name)}</option>`).join("");
  const typeOptions = Object.keys(overview.typeDistribution).sort().map(t => `<option value=\"${escapeHtml(t)}\">${escapeHtml(t)}</option>`).join("");

  const emptyState = overview.sourceCount === 0 ? `
    <section class="empty-state">
      <div class="empty-card">
        <h2>No sources yet</h2>
        <p>Import docs to give your agents memory of them.</p>
        <div class="cmd"><code>okfit hub import ./my-docs --name my-docs</code></div>
        <div class="cmd"><code>okfit add my-docs https://example.com/docs</code></div>
        <div class="cmd"><code>okfit setup my-docs https://example.com/docs --name my-docs</code></div>
        <p class="tip">Try <code>okfit hub --demo</code> to see sample data.</p>
      </div>
    </section>` : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OKFIT Hub</title>
<style>
:root{color-scheme:dark;--bg:#0a0e0d;--card:#111816;--card-2:#0d1311;--border:#1d2823;--border-2:#28342e;--ink:#e8efea;--muted:#8d9c96;--faint:#5b6862;--accent:#34d399;--blue:#6ea8fe;--amber:#e3b341;--red:#f06a6a;--radius:10px;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--bg);background-image:radial-gradient(900px 500px at 78% -8%,rgba(52,211,153,.06),transparent 60%),radial-gradient(800px 500px at 0% 110%,rgba(110,168,254,.05),transparent 55%);color:var(--ink);font-family:var(--sans);font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased}
.mono{font-family:var(--mono);font-size:12px}
a{color:var(--blue);text-decoration:none}
a:hover{text-decoration:underline}
.app{display:flex;flex-direction:column;height:100%}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-bottom:1px solid var(--border);background:var(--card)}
.brand{display:flex;align-items:center;gap:10px}
.logo{font-size:18px}
h1{margin:0;font-size:15px;font-weight:600}
.sub{margin:0;font-size:11px;color:var(--faint)}
.topbar-right{display:flex;align-items:center;gap:8px}
.badge{padding:1px 8px;border-radius:999px;font-size:11px;border:1px solid var(--border)}
.badge.ok{background:rgba(52,211,153,.1);border-color:rgba(52,211,153,.3);color:#34d399}
.badge.bad{background:rgba(240,106,106,.1);border-color:rgba(240,106,106,.3);color:#f06a6a}
.badge.ghost{background:transparent;border-color:var(--border-2);color:var(--faint)}
.links{display:flex;gap:12px;font-size:12px}
.stats{display:flex;gap:8px;padding:14px 20px 8px}
.stat{flex:1;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 14px;text-align:left}
.stat strong{display:block;font-size:20px;font-family:var(--mono);line-height:1}
.stat span{font-size:11px;color:var(--muted)}
.workspace{display:grid;grid-template-columns:1fr 380px;gap:14px;padding:0 20px 20px;min-height:0;flex:1;overflow:hidden}
.graphcard{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden}
.facets{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--border);background:var(--card-2);flex-wrap:wrap}
.search-wrap{position:relative;flex:1;min-width:220px}
.search-wrap input{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:6px 10px 6px 32px;font-size:13px;color:var(--ink)}
.search-kbd{position:absolute;left:10px;top:7px;font-size:10px;color:var(--faint)}
.canvas-wrap{position:relative;flex:1;min-height:420px;background:#0b0f0e}
#graph{width:100%;height:100%;display:block}
.legend{position:absolute;top:10px;right:10px;background:rgba(17,24,22,.85);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:11px}
.hint{position:absolute;bottom:8px;left:10px;font-size:10px;color:var(--faint)}
.empty{position:absolute;inset:0;display:grid;place-items:center;color:var(--faint);font-size:13px}
.sidepanel{display:flex;flex-direction:column;gap:0;min-height:0;overflow:auto;background:transparent;border-left:1px solid var(--border)}
.panel-section{padding:14px;border-bottom:1px solid var(--border)}
.panel-section h2{margin:0 0 8px;font-size:12px;color:var(--faint);font-weight:500}
.detail-empty{color:var(--faint);font-size:12px}
.sources{display:flex;flex-direction:column;gap:6px}
.source{display:flex;gap:8px;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--card);font-size:12px}
.source .dot{width:8px;height:8px;border-radius:50%;margin-top:3px;flex:none}
.source .dot.ok{background:#34d399}
.source .dot.amber{background:#e3b341}
.source .dot.bad{background:#f06a6a}
.empty-state{display:flex;align-items:center;justify-content:center;padding:40px 20px}
.empty-card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:28px 32px;max-width:520px;text-align:center}
.empty-card h2{margin:0 0 8px;font-size:18px}
.empty-card p{margin:0 0 16px;color:var(--muted)}
.empty-card .cmd{background:var(--card-2);border:1px solid var(--border-2);border-radius:8px;padding:10px 14px;margin:8px 0;font-family:var(--mono);font-size:13px;color:var(--ink);text-align:left}
.empty-card .tip{margin-top:16px;font-size:12px;color:var(--faint)}
.refresh-btn{margin-top:8px;padding:4px 10px;border-radius:6px;border:1px solid var(--accent);background:transparent;color:var(--accent);font-size:11px;cursor:pointer}
@media(max-width:920px){.workspace{grid-template-columns:1fr;overflow:auto}.topbar{flex-wrap:wrap}.links{width:100%}}
</style>
</head>
<body>
<div class="app">
  <header class="topbar">
    <div class="brand">
      <span class="logo">◆</span>
      <div style="min-width:0">
        <h1>OKFIT Hub</h1>
        <p class="sub">source-aware agent memory · <span class="mono">${escapeHtml(overview.okfitHome)}</span></p>
      </div>
    </div>
    <div class="topbar-right">
      <span class="badge ${overview.validation.status === "valid" ? "ok" : "bad"}">${escapeHtml(overview.validation.status)}</span>
      <span class="badge ghost">${overview.sourceCount} sources</span>
      <span class="badge ghost mono" title="${escapeHtml(overview.generatedAt)}">v${escapeHtml(overview.okfitVersion)}</span>
      <nav class="links">
        <a href="/api/overview">overview</a>
        <a href="/graph.json">graph.json</a>
        <a href="/llms.txt">llms.txt</a>
        <a href="/mcp-manifest.json">mcp</a>
        <a href="/api/orphans">orphans</a>
      </nav>
    </div>
  </header>

  <section class="stats">
    <button class="stat" data-action="reset" type="button"><strong>${overview.sourceCount}</strong><span>sources</span></button>
    <div class="stat"><strong>${overview.usableSourceCount}</strong><span>usable</span></div>
    <button class="stat" data-action="reset" type="button"><strong>${overview.conceptCount}</strong><span>concepts</span></button>
    <div class="stat"><strong>${overview.edgeCount}</strong><span>edges</span></div>
    <button class="stat ${overview.validation.orphanCount ? "click" : ""}" data-action="orphans" type="button"${overview.validation.orphanCount ? "" : " disabled"}><strong>${overview.validation.orphanCount}</strong><span>orphans</span></button>
    <div class="stat"><strong>${overview.validation.warningCount}</strong><span>warnings</span></div>
    <div class="stat"><strong>${overview.validation.brokenLinks}</strong><span>broken links</span></div>
  </section>

  ${emptyState}

  <section class="workspace"${overview.sourceCount === 0 ? " hidden" : ""}>
    <div class="graphcard">
      <div class="facets">
        <div class="search-wrap">
          <span class="search-kbd">/</span>
          <input id="q" placeholder="Search all concepts, tags, sources…" autocomplete="off" spellcheck="false">
        </div>
        <select id="f-source"><option value="">All sources</option>${sourceOptions}</select>
        <select id="f-type"><option value="">All types</option>${typeOptions}</select>
        <div class="spacer"></div>
        <button class="tool" id="fit" type="button" title="Fit to view (f)">⤢ fit</button>
        <button class="tool" id="clear" type="button" title="Clear filters">clear</button>
        <button class="refresh-btn" id="refresh" type="button">↻ refresh</button>
        <span class="result-count" id="count"></span>
      </div>
      <div class="canvas-wrap">
        <canvas id="graph"></canvas>
        <div class="legend" id="legend"></div>
        <div class="hint">drag to pan · scroll to zoom · click a node to trace · / to search</div>
        <div class="empty" id="empty" hidden>No concepts match the current filters.</div>
      </div>
      <div class="tagrow"></div>
    </div>

    <aside class="sidepanel">
      <div class="panel-section">
        <h2>Trace</h2>
        <div id="detail"><div class="detail-empty">Select a node to inspect its creation path, dependencies, dependents, and cross-source links.</div></div>
      </div>
      <div class="panel-section">
        <h2>Sources <span class="muted">(${overview.sources.length})</span></h2>
        <div class="sources">${overview.sources.map(s => {
          const health = s.freshnessStatus === "failed" || s.loadError ? "bad" : s.freshnessStatus === "stale" ? "amber" : "ok";
          return `<div class="source" data-name="${escapeHtml(s.name)}">
            <span class="dot ${health}"></span>
            <div>${escapeHtml(s.name)} <span class="mono" style="color:var(--faint);font-size:10px">${s.conceptCount}</span></div>
          </div>`;
        }).join("")}</div>
      </div>
    </aside>
  </section>
</div>

<script id="data" type="application/json">${data}</script>
<script>
(function(){
  "use strict";
  var DATA = JSON.parse(document.getElementById('data').textContent);
  var overview = DATA.overview, graph = DATA.graph;
  var nodes = graph.nodes || [], edges = graph.edges || [];
  var canvas = document.getElementById('graph');
  var ctx = canvas.getContext('2d');
  var qEl = document.getElementById('q'), fsEl = document.getElementById('f-source'), ftEl = document.getElementById('f-type');
  var countEl = document.getElementById('count'), emptyEl = document.getElementById('empty'), legendEl = document.getElementById('legend');
  var detailEl = document.getElementById('detail');
  var W=0,H=0,dpr=window.devicePixelRatio||1, view={x:0,y:0,scale:1}, filters={term:'',source:'',type:''}, visible=[], pos={}, hoverId=null, selectedId=null;

  function resize(){ var r=canvas.parentElement.getBoundingClientRect(); W=Math.max(1,r.width); H=Math.max(1,r.height); canvas.width=Math.round(W*dpr); canvas.height=Math.round(H*dpr); canvas.style.width=W+'px'; canvas.style.height=H+'px'; }
  function applyFilters(){ visible=[]; var term=filters.term.toLowerCase().trim(); for(var i=0;i<nodes.length;i++){ var n=nodes[i]; if(filters.source&&n.sourceName!==filters.source)continue; if(filters.type&&n.type!==filters.type)continue; if(term){ var hay=(n.label+' '+(n.id||'')+' '+(n.sourceName||'')+' '+(n.type||'')).toLowerCase(); if(hay.indexOf(term)<0)continue; } var p=pos[n.id]||(pos[n.id]={x:W*(0.3+Math.random()*0.4),y:H*(0.3+Math.random()*0.4)}); visible.push({id:n.id,n:n,x:p.x,y:p.y,vx:0,vy:0}); } countEl.textContent=visible.length+' / '+nodes.length; emptyEl.hidden=visible.length>0; }
  function draw(){ ctx.save(); ctx.scale(dpr,dpr); ctx.fillStyle='#0b0f0e'; ctx.fillRect(0,0,W,H); ctx.restore(); for(var i=0;i<visible.length;i++){ var v=visible[i]; ctx.beginPath(); ctx.arc(v.x,v.y,3.5,0,Math.PI*2); ctx.fillStyle='#34d399'; ctx.fill(); } }
  function fit(){ /* simple centering */ resize(); applyFilters(); draw(); }
  function onRefresh(){ fetch('/api/refresh',{method:'POST'}).then(r=>r.json()).then(()=>location.reload()); }

  window.addEventListener('resize',()=>{resize();draw();});
  qEl.oninput=()=>{filters.term=qEl.value;applyFilters();draw();};
  fsEl.onchange=()=>{filters.source=fsEl.value;applyFilters();draw();};
  ftEl.onchange=()=>{filters.type=ftEl.value;applyFilters();draw();};
  document.getElementById('fit').onclick=fit;
  document.getElementById('clear').onclick=()=>{qEl.value='';fsEl.value='';ftEl.value='';filters={term:'',source:'',type:''};applyFilters();draw();};
  document.getElementById('refresh').onclick=onRefresh;
  canvas.onmousemove=e=>{ /* hover stub */ };
  canvas.onclick=e=>{ /* selection stub */ };

  resize(); applyFilters(); fit();
  // seed a few random positions for demo
  setTimeout(()=>{ if(visible.length){ visible.forEach(v=>{v.x+= (Math.random()-0.5)*40; v.y+=(Math.random()-0.5)*40;}); draw(); } }, 120);
})();
</script>
</body>
</html>`;

  return html;
}

// --- Minimal HTTP helpers (restored for full functionality) ---

function sendText(response: http.ServerResponse, status: number, value: string, contentType = "text/plain; charset=utf-8"): void {
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  response.end(value);
}

function sendHtml(response: http.ServerResponse, status: number, value: string): void {
  sendText(response, status, value, "text/html; charset=utf-8");
}

function sendJson(response: http.ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(body); } catch { return {}; }
}

function escapeXml(value: string): string {
  return escapeHtml(value);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]!);
}
