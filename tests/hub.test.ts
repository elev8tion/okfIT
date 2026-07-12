import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildHubKnowledgeGraph,
  buildHubOverview,
  buildHubSearch,
  hubMcpManifest,
  importPathIntoHub,
  renderHubLlmsTxt,
  renderHubSitemap,
  resolveHubSources,
  startHubHttpServer
} from "../src/hub.js";
import {
  type RefreshState,
  type SourceManifest,
  writeRefreshState,
  writeSourceManifest
} from "../src/source-store.js";

const tempDirs: string[] = [];

function fixture(name: string): string {
  return path.resolve("test-fixtures", name);
}

async function tempHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okfit-hub-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function manifest(name: string): SourceManifest {
  return {
    schemaVersion: 1,
    okfitVersion: "0.3.0",
    name,
    kind: "website",
    createdAt: "2026-06-23T00:00:00.000Z",
    updatedAt: "2026-06-23T00:00:00.000Z",
    source: { seedUrl: `https://docs.example.com/${name}` },
    crawl: {
      maxPages: 100,
      maxDepth: 4,
      include: [],
      exclude: [],
      sameOrigin: true,
      respectRobots: true,
      concurrency: 4,
      allowPrivateNetwork: false
    },
    refresh: { mode: "stale-while-refresh", maxAgeSeconds: 86_400, minIntervalSeconds: 900 },
    bundle: { dir: "bundle" }
  };
}

function state(partial: Partial<RefreshState> = {}): RefreshState {
  return {
    schemaVersion: 1,
    status: "fresh",
    lastCheckedAt: "2026-06-23T00:00:00.000Z",
    lastRefreshStartedAt: "2026-06-23T00:00:00.000Z",
    lastRefreshCompletedAt: "2026-06-23T00:01:00.000Z",
    lastSuccessfulRefreshAt: "2026-06-23T00:01:00.000Z",
    nextRefreshAllowedAt: "2026-06-23T00:16:00.000Z",
    refreshInProgress: false,
    lastError: null,
    bundle: { conceptCount: 2, warningCount: 0, valid: true, contentHash: "sha256:test" },
    ...partial
  };
}

async function registerFixtureSource(okfitHome: string, name: string): Promise<void> {
  await writeSourceManifest(manifest(name), { okfitHome });
  await writeRefreshState(name, state(), { okfitHome });
  await fs.cp(fixture("okf-valid"), path.join(okfitHome, "sources", name, "bundle"), {
    recursive: true
  });
}

describe("hub global graph and search", () => {
  it("merges registered sources and hub imports with source provenance", async () => {
    const okfitHome = await tempHome();
    await registerFixtureSource(okfitHome, "stripe");
    const imported = await importPathIntoHub(fixture("okf-valid"), {
      okfitHome,
      name: "local-docs"
    });

    const sources = await resolveHubSources({ okfitHome });
    expect(sources.map((source) => source.name)).toEqual(["local-docs", "stripe"]);
    expect(imported.mode).toBe("copy-bundle");

    const graph = await buildHubKnowledgeGraph(sources);
    expect([...graph.concepts.keys()].sort()).toEqual([
      "local-docs:guides/quickstart",
      "local-docs:reference/api",
      "stripe:guides/quickstart",
      "stripe:reference/api"
    ]);
    expect(graph.outbound.get("stripe:guides/quickstart")).toEqual(["stripe:reference/api"]);
    expect(graph.edges.some((edge) => edge.kind === "cross_source_same_id")).toBe(true);

    const search = await buildHubSearch({ okfitHome });
    const results = search.search("MCP tool", { limit: 10 });
    expect(results.map((result) => result.ref)).toEqual(
      expect.arrayContaining(["stripe:reference/api", "local-docs:reference/api"])
    );
    expect(results.every((result) => result.sourceName)).toBe(true);

    const trace = search.trace("stripe:reference/api");
    expect(trace.dependencies).toEqual(["stripe:guides/quickstart"]);
    expect(trace.dependents).toEqual(["stripe:guides/quickstart"]);
    expect(trace.creationPath.map((item) => item.path)).toContainEqual([
      "stripe:guides/quickstart",
      "stripe:reference/api"
    ]);
    expect(trace.sameIdAcrossSources).toContain("local-docs:reference/api");
  });

  it("builds overview, crawlable files, MCP manifest, and HTTP endpoints", async () => {
    const okfitHome = await tempHome();
    await registerFixtureSource(okfitHome, "stripe");
    const overview = await buildHubOverview({ okfitHome });
    expect(overview).toMatchObject({ sourceCount: 1, usableSourceCount: 1, conceptCount: 2 });
    expect(overview.typeDistribution).toMatchObject({ Guide: 1, "API Reference": 1 });
    expect(renderHubLlmsTxt("http://localhost:8765")).toContain("/api/search?q=your-query");
    expect(renderHubSitemap("http://localhost:8765")).toContain("/graph.json");
    expect(hubMcpManifest("http://localhost:8765")).toMatchObject({ name: "okfit-hub" });

    const server = await startHubHttpServer({ okfitHome, host: "127.0.0.1", port: 0 });
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const base = `http://127.0.0.1:${port}`;
      const [overviewResponse, graphResponse, traceResponse, llmsResponse] = await Promise.all([
        fetch(`${base}/api/overview`).then((response) => response.json()),
        fetch(`${base}/graph.json`).then((response) => response.json()),
        fetch(`${base}/api/trace?ref=stripe:reference/api`).then((response) => response.json()),
        fetch(`${base}/llms.txt`).then((response) => response.text())
      ]);
      expect(overviewResponse.conceptCount).toBe(2);
      expect(graphResponse.nodes).toHaveLength(2);
      expect(traceResponse.dependents).toContain("stripe:guides/quickstart");
      expect(llmsResponse).toContain("OKFIT Hub");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
