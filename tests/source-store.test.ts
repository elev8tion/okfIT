import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listSources,
  readRefreshState,
  readSourceRecord,
  readSourceManifest,
  removeSource,
  resolveBundleDir,
  resolveOkfitHome,
  resolveSourceDir,
  validateSourceName,
  writeRefreshState,
  writeSourceManifest,
  type RefreshState,
  type SourceManifest
} from "../src/source-store.js";

const tempDirs: string[] = [];

async function tempHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okfit-source-store-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function manifest(partial: Partial<SourceManifest> = {}): SourceManifest {
  return {
    schemaVersion: 1,
    okfitVersion: "0.1.4",
    name: "stripe",
    kind: "website",
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:00:00.000Z",
    source: {
      seedUrl: "https://docs.stripe.com/checkout"
    },
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
    refresh: {
      mode: "stale-while-refresh",
      maxAgeSeconds: 86_400,
      minIntervalSeconds: 900
    },
    bundle: {
      dir: "bundle"
    },
    ...partial
  };
}

function state(partial: Partial<RefreshState> = {}): RefreshState {
  return {
    schemaVersion: 1,
    status: "fresh",
    lastCheckedAt: "2026-06-16T00:00:00.000Z",
    lastRefreshStartedAt: "2026-06-16T00:00:00.000Z",
    lastRefreshCompletedAt: "2026-06-16T00:01:10.000Z",
    lastSuccessfulRefreshAt: "2026-06-16T00:01:10.000Z",
    nextRefreshAllowedAt: "2026-06-16T00:16:10.000Z",
    refreshInProgress: false,
    lastError: null,
    bundle: {
      conceptCount: 25,
      warningCount: 0,
      valid: true,
      contentHash: "sha256:test"
    },
    ...partial
  };
}

describe("OKFIT home and source names", () => {
  it("uses OKFIT_HOME when resolving the local store home", () => {
    expect(resolveOkfitHome({ env: { OKFIT_HOME: "/tmp/custom-okfit" } })).toBe(
      path.resolve("/tmp/custom-okfit")
    );
  });

  it("accepts stable filesystem-safe source names", () => {
    for (const name of [
      "stripe",
      "stripe_checkout",
      "stripe.checkout-v2",
      "a1",
      "-legacy",
      "_legacy",
      ".legacy"
    ]) {
      expect(validateSourceName(name)).toBe(name);
    }
  });

  it("rejects empty, unsafe, or path-like source names", () => {
    for (const name of [
      "",
      ".",
      "..",
      "Stripe",
      "stripe/docs",
      "stripe\\docs",
      "../stripe",
      "stripe docs"
    ]) {
      expect(() => validateSourceName(name)).toThrow(/source name/i);
    }
  });

  it("resolves source directories under OKFIT_HOME sources", async () => {
    const okfitHome = await tempHome();

    expect(resolveSourceDir("stripe", { okfitHome })).toBe(path.join(okfitHome, "sources", "stripe"));
  });
});

describe("source manifest and state storage", () => {
  it("writes and reads source.json with stable two-space JSON", async () => {
    const okfitHome = await tempHome();

    await writeSourceManifest(manifest(), { okfitHome });

    await expect(readSourceManifest("stripe", { okfitHome })).resolves.toEqual(manifest());
    const sourceJson = await fs.readFile(
      path.join(okfitHome, "sources", "stripe", "source.json"),
      "utf8"
    );
    expect(sourceJson).toContain('\n  "schemaVersion": 1,\n');
    expect(sourceJson.indexOf('"schemaVersion"')).toBeLessThan(sourceJson.indexOf('"okfitVersion"'));
    expect(sourceJson.indexOf('"crawl"')).toBeLessThan(sourceJson.indexOf('"refresh"'));
    expect(sourceJson.endsWith("\n")).toBe(true);
  });

  it("writes and reads state.json with stable two-space JSON", async () => {
    const okfitHome = await tempHome();

    await writeSourceManifest(manifest(), { okfitHome });
    await writeRefreshState("stripe", state(), { okfitHome });

    await expect(readRefreshState("stripe", { okfitHome })).resolves.toEqual(state());
    const stateJson = await fs.readFile(
      path.join(okfitHome, "sources", "stripe", "state.json"),
      "utf8"
    );
    expect(stateJson).toContain('\n  "status": "fresh",\n');
    expect(stateJson.indexOf('"lastCheckedAt"')).toBeLessThan(
      stateJson.indexOf('"lastRefreshStartedAt"')
    );
    expect(stateJson.endsWith("\n")).toBe(true);
  });

  it("writes concurrent refresh states through unique temp files", async () => {
    const okfitHome = await tempHome();
    const now = vi.spyOn(Date, "now").mockReturnValue(1_777_777_777_777);
    try {
      await writeSourceManifest(manifest(), { okfitHome });

      await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          writeRefreshState(
            "stripe",
            state({
              status: index % 2 === 0 ? "fresh" : "stale",
              bundle: {
                conceptCount: 25 + index,
                warningCount: 0,
                valid: true,
                contentHash: `sha256:test-${index}`
              }
            }),
            { okfitHome }
          )
        )
      );

      const stored = await readRefreshState("stripe", { okfitHome });
      expect(stored.bundle?.contentHash).toMatch(/^sha256:test-[0-7]$/);
      const sourceDir = path.join(okfitHome, "sources", "stripe");
      const leftovers = (await fs.readdir(sourceDir)).filter((name) => name.endsWith(".tmp"));
      expect(leftovers).toEqual([]);
    } finally {
      now.mockRestore();
    }
  });

  it("rejects malformed state.json instead of trusting unchecked JSON", async () => {
    const okfitHome = await tempHome();
    const sourceDir = path.join(okfitHome, "sources", "stripe");

    await writeSourceManifest(manifest(), { okfitHome });
    await fs.writeFile(
      path.join(sourceDir, "state.json"),
      JSON.stringify({ ...state(), status: "ready" }),
      "utf8"
    );

    await expect(readRefreshState("stripe", { okfitHome })).rejects.toThrow(
      /Invalid refresh state.*status/i
    );

    const sources = await listSources({ okfitHome });
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      name: "stripe",
      state: undefined,
      loadError: {
        message: expect.stringMatching(/Invalid refresh state.*status/i)
      }
    });
  });

  it("loads explicit source records with malformed state as load errors", async () => {
    const okfitHome = await tempHome();
    const sourceDir = path.join(okfitHome, "sources", "stripe");

    await writeSourceManifest(manifest(), { okfitHome });
    await fs.mkdir(path.join(sourceDir, "bundle"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "state.json"),
      JSON.stringify({ ...state(), status: "ready" }),
      "utf8"
    );

    const record = await readSourceRecord("stripe", { okfitHome });

    expect(record).toMatchObject({
      name: "stripe",
      state: undefined,
      bundleDir: path.join(sourceDir, "bundle"),
      loadError: {
        message: expect.stringMatching(/Invalid refresh state.*status/i)
      }
    });
  });

  it("rejects malformed state bundle summaries", async () => {
    const okfitHome = await tempHome();
    const sourceDir = path.join(okfitHome, "sources", "stripe");

    await writeSourceManifest(manifest(), { okfitHome });
    await fs.writeFile(
      path.join(sourceDir, "state.json"),
      JSON.stringify({ ...state(), bundle: { conceptCount: 25, warningCount: 0, valid: true } }),
      "utf8"
    );

    await expect(readRefreshState("stripe", { okfitHome })).rejects.toThrow(
      /Invalid refresh state.*bundle\.contentHash/i
    );
  });

  it("lists registered sources sorted by source name", async () => {
    const okfitHome = await tempHome();

    await writeSourceManifest(manifest({ name: "stripe" }), { okfitHome });
    await writeSourceManifest(
      manifest({ name: "astro", source: { seedUrl: "https://docs.astro.build" } }),
      {
        okfitHome
      }
    );
    await writeRefreshState("stripe", state(), { okfitHome });

    const sources = await listSources({ okfitHome });

    expect(sources.map((source) => source.name)).toEqual(["astro", "stripe"]);
    expect(sources[1]).toMatchObject({
      manifest: manifest(),
      state: state(),
      bundleDir: path.join(okfitHome, "sources", "stripe", "bundle")
    });
  });

  it("keeps corrupt source directories visible with load errors", async () => {
    const okfitHome = await tempHome();

    await fs.mkdir(path.join(okfitHome, "sources", "broken"), { recursive: true });
    await writeSourceManifest(manifest({ name: "stripe" }), { okfitHome });

    const sources = await listSources({ okfitHome });

    expect(sources.map((source) => source.name)).toEqual(["broken", "stripe"]);
    expect(sources[0]).toMatchObject({
      name: "broken",
      manifest: {
        name: "broken",
        okfitVersion: "unknown",
        bundle: { dir: "bundle" }
      },
      loadError: {
        code: "ENOENT"
      },
      bundleDir: path.join(okfitHome, "sources", "broken", "bundle")
    });
    expect(sources[0]?.loadError?.message).toMatch(/source\.json|ENOENT/);
  });

  it("turns malformed source manifests into fallback records", async () => {
    const okfitHome = await tempHome();
    const sourceDir = path.join(okfitHome, "sources", "broken");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "source.json"),
      '{"schemaVersion":1,"name":"broken"}\n',
      "utf8"
    );

    const sources = await listSources({ okfitHome });

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      name: "broken",
      manifest: {
        name: "broken",
        source: { seedUrl: "" },
        bundle: { dir: "bundle" }
      },
      loadError: {
        message: expect.stringMatching(/kind|okfitVersion|source/i)
      }
    });
  });

  it("uses valid fallback names for invalid source directory names", async () => {
    const okfitHome = await tempHome();
    await fs.mkdir(path.join(okfitHome, "sources", "Bad Name"), { recursive: true });

    const sources = await listSources({ okfitHome });

    expect(sources).toHaveLength(1);
    expect(sources[0]?.name).toMatch(/^invalid-[a-z0-9]+-bad-name$/);
    expect(() => validateSourceName(sources[0]?.name ?? "")).not.toThrow();
    expect(sources[0]).toMatchObject({
      dir: path.join(okfitHome, "sources", "Bad Name"),
      manifest: {
        name: sources[0]?.name,
        source: { seedUrl: "" }
      },
      loadError: {
        sourceDirName: "Bad Name",
        message: expect.stringContaining('Invalid source name "Bad Name"')
      }
    });
  });
});

describe("bundle path safety and removal", () => {
  it("resolves relative bundle dirs inside the source directory", async () => {
    const okfitHome = await tempHome();

    expect(resolveBundleDir(manifest(), { okfitHome })).toBe(
      path.join(okfitHome, "sources", "stripe", "bundle")
    );
  });

  it("allows explicit absolute bundle dirs but rejects relative traversal", async () => {
    const okfitHome = await tempHome();
    const externalBundle = path.join(okfitHome, "external", "stripe-bundle");

    expect(resolveBundleDir(manifest({ bundle: { dir: externalBundle } }), { okfitHome })).toBe(
      externalBundle
    );
    expect(() =>
      resolveBundleDir(manifest({ bundle: { dir: "../outside" } }), { okfitHome })
    ).toThrow(/bundle/i);
  });

  it("removes only the registered source directory", async () => {
    const okfitHome = await tempHome();
    const externalBundle = path.join(okfitHome, "external", "stripe-bundle");
    await fs.mkdir(externalBundle, { recursive: true });
    await fs.writeFile(path.join(externalBundle, "index.md"), "# External\n", "utf8");
    await writeSourceManifest(manifest({ bundle: { dir: externalBundle } }), { okfitHome });
    await writeRefreshState("stripe", state(), { okfitHome });

    await removeSource("stripe", { okfitHome });

    await expect(fs.stat(path.join(okfitHome, "sources", "stripe"))).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(fs.readFile(path.join(externalBundle, "index.md"), "utf8")).resolves.toBe(
      "# External\n"
    );
  });
});
