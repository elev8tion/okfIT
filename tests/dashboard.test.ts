import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import {
  importPathIntoHub,
  renderHubDashboard,
  startHubHttpServer,
  HubSearch,
  type HubConcept,
  type HubGraphEdge,
  type HubKnowledgeGraph,
  type HubOverview,
  type HubSourceProvenance,
  type HubSourceSummary
} from "../src/hub.js";

/* ------------------------------------------------------------------ */
/* Synthetic data builders (for fast, deterministic unit tests)        */
/* ------------------------------------------------------------------ */

function makeProvenance(sourceName: string, over: Partial<HubSourceProvenance> = {}): HubSourceProvenance {
  return {
    sourceName,
    sourceKind: "website",
    seedUrl: `https://docs.example.com/${sourceName}`,
    bundleDir: `/tmp/${sourceName}/bundle`,
    importedAt: "2026-07-01T00:00:00.000Z",
    originalPath: `/tmp/${sourceName}`,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    freshnessStatus: "fresh",
    lastSuccessfulRefreshAt: "2026-07-10T00:00:00.000Z",
    refreshInProgress: false,
    lastRefreshError: null,
    ...over
  };
}

interface MakeConceptArgs {
  ref: string;
  id?: string;
  type?: string;
  title?: string;
  description?: string;
  tags?: string[];
  body?: string;
  resource?: string;
  sourceName: string;
}

function makeConcept(args: MakeConceptArgs): HubConcept {
  const id = args.id ?? args.ref.split(":").slice(1).join(":") ?? args.ref;
  return {
    id,
    path: args.ref,
    frontmatter: {},
    type: args.type ?? "Concept",
    title: args.title,
    description: args.description,
    tags: args.tags ?? [],
    body: args.body ?? "",
    resource: args.resource,
    ref: args.ref,
    source: makeProvenance(args.sourceName)
  };
}

function makeGraph(concepts: HubConcept[], edges: HubGraphEdge[]): HubKnowledgeGraph {
  const conceptsMap = new Map(concepts.map((c) => [c.ref, c]));
  const outbound = new Map<string, string[]>();
  const backlinks = new Map<string, string[]>();
  const bySourceConceptId = new Map<string, string>();
  const link = (m: Map<string, string[]>, k: string, v: string): void => {
    const arr = m.get(k) ?? [];
    if (!arr.includes(v)) arr.push(v);
    m.set(k, arr);
  };
  for (const e of edges) {
    link(outbound, e.from, e.to);
    link(backlinks, e.to, e.from);
  }
  for (const c of concepts) bySourceConceptId.set(`${c.source.sourceName}:${c.id}`, c.ref);
  return { concepts: conceptsMap, outbound, backlinks, edges, bySourceConceptId };
}

function makeSource(over: Partial<HubSourceSummary> & { name: string }): HubSourceSummary {
  return {
    kind: "website",
    seedUrl: `https://docs.example.com/${over.name}`,
    bundleDir: `/tmp/${over.name}/bundle`,
    availabilityStatus: "available",
    validationStatus: "valid",
    conceptCount: 0,
    warningCount: 0,
    brokenLinks: 0,
    orphanConcepts: [],
    freshnessStatus: "fresh",
    lastSuccessfulRefreshAt: "2026-07-10T00:00:00.000Z",
    ...over
  };
}

function makeOverview(over: Partial<HubOverview> = {}): HubOverview {
  return {
    schemaVersion: 1,
    okfitVersion: "0.3.2",
    okfitHome: "/tmp/okfit-home",
    generatedAt: "2026-07-12T00:00:00.000Z",
    sourceCount: 0,
    usableSourceCount: 0,
    conceptCount: 0,
    edgeCount: 0,
    validation: { status: "valid", warningCount: 0, brokenLinks: 0, orphanCount: 0 },
    freshnessTimeline: [],
    typeDistribution: {},
    tagDistribution: {},
    sources: [],
    ...over
  };
}

/** A realistic two-source graph with internal + cross-source edges and one orphan. */
function realisticDashboard(): { overview: HubOverview; search: HubSearch } {
  const quickstart = makeConcept({
    ref: "stripe:guides/quickstart",
    type: "Guide",
    title: "Quickstart",
    tags: ["getting-started", "payments"],
    sourceName: "stripe"
  });
  const api = makeConcept({
    ref: "stripe:reference/api",
    id: "reference/api",
    type: "API Reference",
    title: "API Reference",
    tags: ["api"],
    sourceName: "stripe"
  });
  const localApi = makeConcept({
    ref: "local:reference/api",
    id: "reference/api",
    type: "API Reference",
    title: "API Reference (local)",
    tags: ["api"],
    sourceName: "local"
  });
  const loner = makeConcept({
    ref: "stripe:concepts/loner",
    type: "Concept",
    title: "Loner",
    tags: [],
    sourceName: "stripe"
  });
  const edges: HubGraphEdge[] = [
    { from: "stripe:guides/quickstart", to: "stripe:reference/api", kind: "internal_link", label: "links" },
    { from: "stripe:reference/api", to: "local:reference/api", kind: "cross_source_same_id", label: "same id" }
  ];
  const search = new HubSearch(makeGraph([quickstart, api, localApi, loner], edges));
  const overview = makeOverview({
    sourceCount: 2,
    usableSourceCount: 2,
    conceptCount: 4,
    edgeCount: edges.length,
    validation: { status: "valid", warningCount: 1, brokenLinks: 0, orphanCount: 1 },
    typeDistribution: { Guide: 1, "API Reference": 2, Concept: 1 },
    tagDistribution: { api: 2, "getting-started": 1, payments: 1 },
    sources: [
      makeSource({ name: "stripe", conceptCount: 3, warningCount: 1, orphanConcepts: ["stripe:concepts/loner"] }),
      makeSource({ name: "local", kind: "local", conceptCount: 1 })
    ]
  });
  return { overview, search };
}

function extractDataJson(html: string): { overview: HubOverview; graph: { nodes: unknown[]; edges: unknown[] } } {
  return JSON.parse(extractDataRaw(html));
}

function extractDataRaw(html: string): string {
  const match = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("data script not found");
  return match[1];
}

function extractClientJs(html: string): string {
  const open = html.lastIndexOf("<script>");
  const close = html.indexOf("</script>", open);
  if (open < 0 || close < 0) throw new Error("client script block not found");
  return html.slice(open + "<script>".length, close);
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("renderHubDashboard — structure & theme", () => {
  it("renders a dark, canvas-based single-page dashboard", () => {
    const { overview, search } = realisticDashboard();
    const html = renderHubDashboard(overview, search);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("<title>OKFIT Hub</title>");
    expect(html).toContain("color-scheme:dark");
    expect(html).toContain('id="graph"');
    expect(html).toContain("<canvas");
    expect(html).toContain('class="app"');
  });

  it("every element id the client JS queries actually exists in the HTML", () => {
    const { overview, search } = realisticDashboard();
    const html = renderHubDashboard(overview, search);
    const clientJs = extractClientJs(html);
    const referenced = [...clientJs.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const id of new Set(referenced)) {
      expect(html, `client JS queries #${id} but HTML has no such id`).toContain(`id="${id}"`);
    }
  });

  it("the embedded client JavaScript is syntactically valid", () => {
    const { overview, search } = realisticDashboard();
    const html = renderHubDashboard(overview, search);
    const clientJs = extractClientJs(html);
    expect(() => new vm.Script(clientJs)).not.toThrow();
  });
});

describe("renderHubDashboard — stat metrics", () => {
  it("renders every metric from the overview", () => {
    const { overview, search } = realisticDashboard();
    const html = renderHubDashboard(overview, search);
    const stats = html.match(/<strong>([0-9]+)<\/strong>/g) ?? [];
    const values = stats.map((s) => s.replace(/<[^>]+>/g, ""));
    expect(values).toEqual(
      expect.arrayContaining([
        String(overview.sourceCount),
        String(overview.usableSourceCount),
        String(overview.conceptCount),
        String(overview.edgeCount),
        String(overview.validation.orphanCount),
        String(overview.validation.warningCount),
        String(overview.validation.brokenLinks)
      ])
    );
  });

  it("makes the orphans stat interactive when there are orphans", () => {
    const { overview, search } = realisticDashboard();
    const html = renderHubDashboard(overview, search);
    const orphanStat = html.match(/<button class="stat[^"]*" data-action="orphans"[^>]*>/)?.[0] ?? "";
    expect(orphanStat).toContain('class="stat click"');
    expect(orphanStat).not.toContain("disabled");
  });

  it("disables the orphans stat when there are zero orphans", () => {
    const { search } = realisticDashboard();
    const overview = makeOverview({ validation: { status: "valid", warningCount: 0, brokenLinks: 0, orphanCount: 0 } });
    const html = renderHubDashboard(overview, search);
    const orphanStat = html.match(/<button class="stat[^"]*" data-action="orphans"[^>]*>/)?.[0] ?? "";
    expect(orphanStat).toContain("disabled");
    expect(orphanStat).not.toContain('class="stat click"');
  });
});

describe("renderHubDashboard — sources & health", () => {
  it("renders a health dot per source using status-driven buckets", () => {
    const { search } = realisticDashboard();
    const overview = makeOverview({
      sourceCount: 5,
      sources: [
        makeSource({ name: "good" }),
        makeSource({ name: "stale", freshnessStatus: "stale" }),
        makeSource({ name: "warned", warningCount: 4 }),
        makeSource({ name: "broken", brokenLinks: 2 }),
        makeSource({ name: "invalid", validationStatus: "invalid" }),
        makeSource({ name: "unavailable", availabilityStatus: "unavailable" }),
        makeSource({ name: "failed", freshnessStatus: "failed" })
      ]
    });
    const html = renderHubDashboard(overview, search);
    const card = (name: string): string =>
      html.match(new RegExp(`<div class="source" data-name="${name}"[\\s\\S]*?</div>\\s*</div>`))?.[0] ?? "";

    expect(card("good")).toContain('class="dot ok"');
    expect(card("stale")).toContain('class="dot amber"');
    expect(card("warned")).toContain('class="dot amber"');
    expect(card("broken")).toContain('class="dot amber"');
    expect(card("invalid")).toContain('class="dot bad"');
    expect(card("unavailable")).toContain('class="dot bad"');
    expect(card("failed")).toContain('class="dot bad"');
  });

  it("surfaces warnings, broken links, and orphan counts as flags", () => {
    const { search } = realisticDashboard();
    const overview = makeOverview({
      sources: [
        makeSource({ name: "s", warningCount: 3, brokenLinks: 5, orphanConcepts: ["s:a", "s:b"] })
      ]
    });
    const html = renderHubDashboard(overview, search);
    expect(html).toContain("3 warnings");
    expect(html).toContain("5 broken links");
    expect(html).toContain("2 orphans");
  });

  it("renders the last-refresh timestamp as a data-when attribute for relative-time formatting", () => {
    const { search } = realisticDashboard();
    const overview = makeOverview({
      sources: [makeSource({ name: "s", lastSuccessfulRefreshAt: "2026-07-09T12:00:00.000Z" })]
    });
    const html = renderHubDashboard(overview, search);
    expect(html).toContain('data-when="2026-07-09T12:00:00.000Z"');
  });
});

describe("renderHubDashboard — facets", () => {
  it("populates source and type dropdowns from the overview", () => {
    const { overview, search } = realisticDashboard();
    const html = renderHubDashboard(overview, search);
    expect(html).toContain('<option value="stripe">stripe</option>');
    expect(html).toContain('<option value="local">local</option>');
    expect(html).toContain('<option value="Guide">Guide</option>');
    expect(html).toContain('<option value="API Reference">API Reference</option>');
  });

  it("renders top tag chips with counts from tagDistribution", () => {
    const { overview, search } = realisticDashboard();
    const html = renderHubDashboard(overview, search);
    expect(html).toContain('data-tag="api"');
    expect(html).toContain('data-tag="getting-started"');
    // count shown inside the chip
    expect(html.match(/data-tag="api"[^>]*>[^<]*<i>2<\/i>/)).toBeTruthy();
  });
});

describe("renderHubDashboard — embedded data integrity", () => {
  it("embeds the overview verbatim and a graph whose nodes/edges match toJSONGraph()", () => {
    const { overview, search } = realisticDashboard();
    const html = renderHubDashboard(overview, search);
    const parsed = extractDataJson(html);
    expect(parsed.overview).toEqual(overview);
    const expected = search.toJSONGraph();
    expect(parsed.graph.nodes).toEqual(expected.nodes);
    expect(parsed.graph.edges).toEqual(expected.edges);
  });

  it("includes cross-source same-id edges in the embedded graph", () => {
    const { overview, search } = realisticDashboard();
    const html = renderHubDashboard(overview, search);
    const parsed = extractDataJson(html);
    expect(parsed.graph.edges.some((e) => (e as HubGraphEdge).kind === "cross_source_same_id")).toBe(true);
  });

  it("exposes per-source orphanConcepts so the client can build its orphan set", () => {
    const { overview, search } = realisticDashboard();
    const html = renderHubDashboard(overview, search);
    const parsed = extractDataJson(html);
    const stripe = parsed.overview.sources.find((s) => s.name === "stripe");
    expect(stripe?.orphanConcepts).toContain("stripe:concepts/loner");
  });
});

describe("renderHubDashboard — edge cases", () => {
  it("renders without crashing for an empty hub (zero concepts)", () => {
    const search = new HubSearch(makeGraph([], []));
    const overview = makeOverview();
    const html = renderHubDashboard(overview, search);
    expect(html).toContain('id="graph"');
    const parsed = extractDataJson(html);
    expect(parsed.graph.nodes).toEqual([]);
    expect(parsed.graph.edges).toEqual([]);
  });

  it("still renders the data script for an invalid hub", () => {
    const search = new HubSearch(makeGraph([], []));
    const overview = makeOverview({
      validation: { status: "invalid", warningCount: 2, brokenLinks: 7, orphanCount: 0 }
    });
    const html = renderHubDashboard(overview, search);
    expect(html).toContain("invalid");
    expect(html).toContain("badge bad");
  });
});

describe("renderHubDashboard — security", () => {
  it("escapes HTML in user-controlled source names (no reflected XSS)", () => {
    const search = new HubSearch(makeGraph([], []));
    const overview = makeOverview({
      sourceCount: 1,
      sources: [makeSource({ name: "<b>hi</b><img src=x onerror=alert(1)>" })]
    });
    const html = renderHubDashboard(overview, search);
    // server-rendered markup must HTML-escape the name
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;");
    // the raw, unescaped payload must never appear as live markup
    expect(html).not.toContain("<b>hi</b>");
    expect(html).not.toContain("<img");
    // and the embedded data payload must have every '<' neutralized
    expect(extractDataRaw(html)).not.toContain("<");
  });

  it("cannot break out of the data <script> via a concept title containing </script>", () => {
    const evil = makeConcept({
      ref: "src:evil",
      sourceName: "src",
      title: "</script><script>alert(1)</script>",
      type: "Concept"
    });
    const search = new HubSearch(makeGraph([evil], []));
    const overview = makeOverview({
      sourceCount: 1,
      conceptCount: 1,
      sources: [makeSource({ name: "src", conceptCount: 1 })],
      typeDistribution: { Concept: 1 }
    });
    const html = renderHubDashboard(overview, search);
    const dataMatch = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
    expect(dataMatch, "data script must be a single, intact block").toBeTruthy();
    const payload = extractDataRaw(html);
    // every '<' in the JSON payload must have been neutralized to \u003c
    expect(payload).not.toContain("<");
    expect(payload).not.toContain("</script>");
  });
});

/* ------------------------------------------------------------------ */
/* HTTP integration — the real route serves the dashboard              */
/* ------------------------------------------------------------------ */

const tempDirs: string[] = [];
function fixture(name: string): string {
  return path.resolve("test-fixtures", name);
}
async function tempHome(): Promise<string> {
  const dir = await import("node:fs/promises").then((fs) => fs.mkdtemp(path.join(os.tmpdir(), "okfit-dash-test-")));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true }))));
});

describe("renderHubDashboard — HTTP serving", () => {
  it("GET / serves the dashboard HTML with the correct content type", async () => {
    const okfitHome = await tempHome();
    await importPathIntoHub(fixture("okf-valid"), { okfitHome, name: "local-docs" });
    const server = await startHubHttpServer({ okfitHome, host: "127.0.0.1", port: 0 });
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const base = `http://127.0.0.1:${port}`;
      const response = await fetch(`${base}/`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      const html = await response.text();
      expect(html).toContain("<title>OKFIT Hub</title>");
      expect(html).toContain('id="graph"');
      expect(html).toContain("color-scheme:dark");
      // the two concepts from the okf-valid fixture are embedded
      const parsed = extractDataJson(html);
      expect(parsed.graph.nodes.length).toBe(2);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
