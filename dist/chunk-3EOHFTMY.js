import {
  BundleSearch,
  bundleSourceName,
  codexMcpServerName,
  createWorkspaceMcpServer,
  defaultOkfitHome,
  ensureMarkdownPath,
  firstAgentPrompt,
  inspectBundle,
  isRegisteredWorkspaceRecord,
  isReservedOkfPath,
  listSources,
  localBundleRecord,
  mcpServerName,
  okfitUserAgent,
  packageVersion,
  readBundle,
  relativeMarkdownLink,
  renderMcpClientArtifacts,
  resolveOkfitHome,
  resolveOkfitHome2,
  safeSegment,
  serveCommand,
  toPosixPath,
  urlToOutputPath,
  validateBundle,
  validateSourceName
} from "./chunk-PZ2MNDGA.js";

// src/normalize.ts
import * as cheerio from "cheerio";
import TurndownService from "turndown";
var turndown = new TurndownService({
  codeBlockStyle: "fenced",
  headingStyle: "atx",
  bulletListMarker: "-"
});
turndown.keep(["table"]);
function extractHeadings(markdown) {
  return [...markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match) => ({
    depth: match[1]?.length ?? 1,
    text: (match[2] ?? "").trim(),
    slug: safeSegment(match[2] ?? "")
  }));
}
function extractMarkdownLinks(markdown) {
  return [...markdown.matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => ({
    text: match[1] ?? "",
    href: match[2] ?? ""
  }));
}
function inferType(title, sourceId, markdown) {
  const haystack = `${title} ${sourceId} ${markdown.slice(0, 2e3)}`.toLowerCase();
  if (/\breadme\b/.test(haystack)) return "README";
  if (/\b(api|reference|sdk|endpoint|parameter|request|response)\b/.test(haystack)) return "API Reference";
  if (/\b(quickstart|guide|tutorial|walkthrough|get started)\b/.test(haystack)) return "Guide";
  if (/\bdocs?\b/.test(haystack)) return "Documentation Page";
  return "Concept";
}
function inferTags(title, sourceId, headings) {
  const raw = `${sourceId} ${title} ${headings.slice(0, 3).map((h) => h.text).join(" ")}`;
  const words = raw.toLowerCase().replace(/https?:\/\/[^/]+/g, "").split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && word.length <= 24).filter((word) => !["html", "markdown", "index", "docs", "page", "guide"].includes(word));
  return [...new Set(words)].slice(0, 6);
}
function titleFromMarkdown(markdown, fallback) {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return plainTitle(heading);
  return fallback;
}
function plainTitle(title) {
  return title.replace(/\[([^\]]+)]\([^)]+\)/g, "$1").replace(/[`*_#]/g, "").replace(/\s+/g, " ").trim();
}
function fallbackTitle(sourceId) {
  const leaf = sourceId.split(/[/?#]/).filter(Boolean).pop() ?? "Index";
  return leaf.replace(/\.[a-z0-9]+$/i, "").split(/[-_\s]+/).filter(Boolean).map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join(" ");
}
function normalizeDocument(raw) {
  let markdown = raw.raw;
  let title = fallbackTitle(raw.url ?? raw.filePath ?? raw.sourceId);
  if (raw.contentType === "html") {
    const $ = cheerio.load(raw.raw);
    $("script,style,noscript,svg,header,footer,nav,aside").remove();
    title = $("h1").first().text().trim() || $("title").first().text().trim() || title;
    const main = $("main, article, [role='main'], .markdown-body, .docs-content").first();
    const html = (main.length ? main : $("body")).html() ?? raw.raw;
    markdown = turndown.turndown(html).trim();
  } else if (raw.contentType === "text") {
    markdown = `# ${title}

\`\`\`text
${raw.raw.trim()}
\`\`\``;
  }
  markdown = markdown.replace(/\r\n/g, "\n").trim();
  title = titleFromMarkdown(markdown, plainTitle(title)).replace(/\s+/g, " ").trim();
  const headings = extractHeadings(markdown);
  const links = extractMarkdownLinks(markdown);
  const sourceId = raw.url ?? raw.filePath ?? raw.sourceId;
  return {
    sourceId,
    title,
    markdown,
    resource: raw.url,
    sourcePath: raw.filePath,
    headings,
    links,
    tags: inferTags(title, sourceId, headings),
    type: inferType(title, sourceId, markdown)
  };
}
function descriptionFromMarkdown(markdown) {
  const text = markdown.replace(/^---[\s\S]*?---\s*/m, "").replace(/^#{1,6}\s+.+$/gm, "").replace(/```[\s\S]*?```/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[`*_>#-]/g, "").replace(/\s+/g, " ").trim();
  return text.slice(0, 180) || "Generated OKF concept.";
}

// src/writer.ts
import fs from "fs/promises";
import os from "os";
import path from "path";

// src/util/url.ts
import dns from "dns/promises";
import net from "net";
var TRACKING_PARAMS = [/^utm_/i, /^fbclid$/i, /^gclid$/i, /^mc_/i];
function canonicalizeUrl(input, base) {
  const url = new URL(input, base);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((pattern) => pattern.test(key))) url.searchParams.delete(key);
  }
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (url.pathname !== "/" && url.pathname.endsWith("/") && !input.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}
function sameOrigin(a, b) {
  const left = new URL(a);
  const right = new URL(b);
  return left.origin === right.origin;
}
function isHttpUrl(input) {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
function isPrivateIpv4Parts(parts) {
  const [a = 0, b = 0] = parts;
  return a === 0 || a === 10 || a === 127 || a === 100 && b >= 64 && b <= 127 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 169 && b === 254 || a >= 224;
}
function mappedIpv4PartsFromIpv6(host) {
  const dotted = host.match(/^(?:::|0:0:0:0:0:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
  if (dotted) {
    const parts = dotted.split(".").map(Number);
    if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) return parts;
  }
  const hex = host.match(/^(?:::|0:0:0:0:0:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return void 0;
  const high = Number.parseInt(hex[1] ?? "", 16);
  const low = Number.parseInt(hex[2] ?? "", 16);
  if (!Number.isInteger(high) || !Number.isInteger(low) || high < 0 || high > 65535 || low < 0 || low > 65535) {
    return void 0;
  }
  return [high >> 8, high & 255, low >> 8, low & 255];
}
function isPrivateNetworkUrl(input) {
  const url = new URL(input);
  const host = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::" || host === "::1" || host.startsWith("fe80:")) return true;
  const ipKind = net.isIP(host);
  if (ipKind === 4) {
    const parts = host.split(".").map(Number);
    return isPrivateIpv4Parts(parts);
  }
  if (ipKind === 6) {
    const mappedIpv4Parts = mappedIpv4PartsFromIpv6(host);
    if (mappedIpv4Parts) return isPrivateIpv4Parts(mappedIpv4Parts);
    return host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
  }
  return false;
}
async function resolvesToPrivateNetwork(input) {
  if (isPrivateNetworkUrl(input)) return true;
  const url = new URL(input);
  const host = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (net.isIP(host)) return false;
  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    return false;
  }
  return records.some((record) => {
    const host2 = record.address.includes(":") ? `[${record.address}]` : record.address;
    return isPrivateNetworkUrl(`${url.protocol}//${host2}`);
  });
}
async function assertPublicNetworkUrl(input) {
  if (await resolvesToPrivateNetwork(input)) {
    throw new Error("Private network crawl target rejected. Use --allow-private-network for trusted local fixtures.");
  }
}

// src/writer.ts
function yamlScalar(value) {
  return JSON.stringify(value);
}
function frontmatter(doc, timestamp) {
  const lines = [
    "---",
    `type: ${yamlScalar(doc.type)}`,
    `title: ${yamlScalar(doc.title)}`,
    `description: ${yamlScalar(descriptionFromMarkdown(doc.markdown))}`,
    `resource: ${yamlScalar(doc.resource ?? doc.sourcePath ?? doc.sourceId)}`,
    "tags:",
    ...doc.tags.length ? doc.tags.map((tag) => `  - ${yamlScalar(tag)}`) : ["  []"],
    `timestamp: ${yamlScalar(timestamp)}`,
    "---",
    ""
  ];
  return lines.join("\n");
}
function withTitle(title, markdown) {
  const trimmed = markdown.trim();
  if (trimmed.match(/^#\s+/)) return trimmed;
  return `# ${title}

${trimmed}`;
}
function sourceKey(doc) {
  if (doc.resource) return canonicalizeUrl(doc.resource);
  return toPosixPath(doc.sourcePath ?? doc.sourceId);
}
function assignOutputPaths(docs) {
  const used = /* @__PURE__ */ new Set();
  const result = /* @__PURE__ */ new Map();
  for (const doc of docs) {
    const base = safeConceptOutputPath(
      doc.resource ? urlToOutputPath(doc.resource) : ensureMarkdownPath(doc.sourcePath ?? doc.sourceId)
    );
    let candidate = base;
    let index = 2;
    while (used.has(candidate)) {
      const parsed = path.posix.parse(base);
      candidate = path.posix.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
      index += 1;
    }
    used.add(candidate);
    result.set(sourceKey(doc), candidate);
    doc.outputPath = candidate;
  }
  return result;
}
function safeConceptOutputPath(candidate) {
  if (!isReservedOkfPath(candidate)) return candidate;
  const parsed = path.posix.parse(candidate);
  const safeName = parsed.name.toLowerCase() === "log" ? "change-log" : parsed.dir ? "overview" : "home";
  return path.posix.join(parsed.dir, `${safeName}.md`);
}
function rewriteLinks(doc, sourceToOutput) {
  return doc.markdown.replace(/\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g, (full, text, href, suffix) => {
    if (/^(https?:)?\/\//.test(href)) {
      try {
        const key = canonicalizeUrl(href);
        const target = sourceToOutput.get(key);
        if (target && doc.outputPath) {
          return `[${text}](${relativeMarkdownLink(doc.outputPath, target)}${suffix})`;
        }
      } catch {
        return full;
      }
    }
    if (!href.startsWith("#") && doc.resource) {
      try {
        const key = canonicalizeUrl(href, doc.resource);
        const target = sourceToOutput.get(key);
        if (target && doc.outputPath)
          return `[${text}](${relativeMarkdownLink(doc.outputPath, target)}${suffix})`;
        return `[${text}](${key}${suffix})`;
      } catch {
        return full;
      }
    }
    if (!href.startsWith("#") && doc.sourcePath) {
      const abs = toPosixPath(
        path.posix.normalize(path.posix.join(path.posix.dirname(doc.sourcePath), href))
      );
      const noHash = abs.split("#")[0] ?? abs;
      const target = sourceToOutput.get(noHash);
      if (target && doc.outputPath)
        return `[${text}](${relativeMarkdownLink(doc.outputPath, target)}${suffix})`;
    }
    return full;
  });
}
async function pathExists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
async function resolveForSafety(target) {
  const resolved = path.resolve(target);
  if (await pathExists(resolved)) return fs.realpath(resolved);
  const missingSegments = [path.basename(resolved)];
  let ancestor = path.dirname(resolved);
  while (!await pathExists(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor)
      throw new Error(`Unable to resolve output path ancestor for ${target}.`);
    missingSegments.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  const realAncestor = await fs.realpath(ancestor);
  return path.join(realAncestor, ...missingSegments);
}
async function assertNoCwdSymlinkAncestor(target) {
  const cwd = path.resolve(process.cwd());
  const resolved = path.resolve(target);
  const relative = path.relative(cwd, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return;
  let current = cwd;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Unsafe output directory for --force: refusing symlink ancestor ${current}.`);
    }
  }
}
async function findRepoRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (await pathExists(path.join(current, ".git"))) return fs.realpath(current);
    const parent = path.dirname(current);
    if (parent === current) return void 0;
    current = parent;
  }
}
function containsOrEquals(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || !relative.startsWith("..") && !path.isAbsolute(relative);
}
async function okfitHomeForSafety() {
  return resolveForSafety(resolveOkfitHome());
}
async function assertSafeForceOutDir(outDir, options) {
  if (options.dangerouslyAllowUnsafeOutput) return;
  if (outDir.trim() === "") throw new Error("Unsafe output directory for --force: empty path.");
  const rawResolved = path.resolve(outDir);
  const existing = await pathExists(rawResolved);
  if (existing) {
    const stat = await fs.lstat(rawResolved);
    if (stat.isSymbolicLink()) {
      throw new Error(`Unsafe output directory for --force: refusing symlink ${outDir}.`);
    }
  }
  await assertNoCwdSymlinkAncestor(outDir);
  const realOutDir = await resolveForSafety(outDir);
  const forbidden = /* @__PURE__ */ new Map([
    [path.parse(realOutDir).root, "filesystem root"],
    [await fs.realpath(os.homedir()), "home directory"],
    [await fs.realpath(process.cwd()), "current working directory"],
    [await okfitHomeForSafety(), "OKFIT_HOME"]
  ]);
  const addForbidden = (filePath, reason) => {
    if (!forbidden.has(filePath)) forbidden.set(filePath, reason);
  };
  const repoRoot = await findRepoRoot(process.cwd());
  if (repoRoot) addForbidden(repoRoot, "repository root");
  if (options.inputPath) {
    const inputReal = await resolveForSafety(options.inputPath);
    addForbidden(inputReal, "input path");
    addForbidden(path.dirname(inputReal), "parent of input path");
  }
  for (const [protectedPath, reason] of forbidden.entries()) {
    if (!containsOrEquals(realOutDir, protectedPath)) continue;
    const relation = realOutDir === protectedPath ? "delete" : "delete ancestor of";
    throw new Error(
      `Unsafe output directory for --force: refusing to ${relation} ${reason} (${protectedPath}) from ${realOutDir}.`
    );
  }
}
async function ensureCleanOutDir(outDir, options) {
  if (options.force) await assertSafeForceOutDir(outDir, options);
  try {
    const entries = await fs.readdir(outDir);
    if (entries.length > 0) {
      if (!options.force)
        throw new Error(`Output directory is not empty: ${outDir}. Use --force to overwrite.`);
      await fs.rm(outDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs.mkdir(outDir, { recursive: true });
}
function titleForPath(relPath, fallback) {
  const basename = path.posix.basename(relPath, ".md");
  return fallback || basename;
}
function markdownLink(fromDir, toPath) {
  if (fromDir === ".") return toPath;
  return path.posix.relative(fromDir, toPath);
}
function indexTitle(dir, options) {
  if (dir === ".") return options.title ?? options.sourceName ?? "OKF Bundle";
  const leaf = path.posix.basename(dir);
  return leaf.split(/[-_\s]+/).filter(Boolean).map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join(" ");
}
async function writePlainIndex(outDir, dir, concepts, options) {
  const indexPath = dir === "." ? "index.md" : path.posix.join(dir, "index.md");
  const entries = (dir === "." ? concepts : concepts.filter((concept) => path.posix.dirname(concept.relPath) === dir)).slice().sort((a, b) => a.relPath.localeCompare(b.relPath));
  const lines = [
    `# ${indexTitle(dir, options)}`,
    "",
    ...entries.map(
      (concept) => `* [${concept.title}](${markdownLink(dir, concept.relPath)}) - ${concept.description}`
    )
  ];
  await fs.mkdir(path.dirname(path.join(outDir, indexPath)), { recursive: true });
  await fs.writeFile(path.join(outDir, indexPath), `${lines.join("\n").trimEnd()}
`, "utf8");
  return indexPath;
}
async function writeOkfBundle(docs, options) {
  if (docs.length === 0) throw new Error("No documents to write.");
  await ensureCleanOutDir(options.outDir, options);
  const timestamp = options.timestamp ?? (/* @__PURE__ */ new Date()).toISOString();
  const orderedDocs = docs.slice().sort((first, second) => sourceKey(first).localeCompare(sourceKey(second)));
  const sourceToOutput = assignOutputPaths(orderedDocs);
  const written = [];
  const concepts = [];
  for (const doc of orderedDocs) {
    const relPath = doc.outputPath ?? "index.md";
    const absolute = path.join(options.outDir, relPath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const body = withTitle(doc.title, rewriteLinks(doc, sourceToOutput));
    await fs.writeFile(absolute, `${frontmatter(doc, timestamp)}${body}
`, "utf8");
    written.push(relPath);
    concepts.push({
      relPath,
      title: titleForPath(relPath, doc.title),
      description: descriptionFromMarkdown(doc.markdown)
    });
  }
  written.push(await writePlainIndex(options.outDir, ".", concepts, options));
  const dirs = [
    ...new Set(
      concepts.map((concept) => path.posix.dirname(concept.relPath)).filter((dir) => dir !== ".")
    )
  ].sort();
  for (const dir of dirs) {
    written.push(await writePlainIndex(options.outDir, dir, concepts, options));
  }
  return written.sort();
}

// src/crawler.ts
import pLimit from "p-limit";

// src/crawl/discovery.ts
import robotsParser from "robots-parser";

// src/crawl/fetch-policy.ts
var USER_AGENT = okfitUserAgent();
var MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
function isRedirect(status) {
  return status >= 300 && status < 400;
}
function isSecurityRejection(error) {
  const message = error instanceof Error ? error.message : "";
  return message.includes("Private network crawl target rejected") || message.includes("Cross-origin redirect rejected");
}
async function fetchWithRedirects(url, options, signal) {
  let current = url;
  for (let redirectCount = 0; redirectCount <= 10; redirectCount += 1) {
    if (!options.allowPrivateNetwork) await assertPublicNetworkUrl(current);
    if (options.sameOriginSeed && !sameOrigin(current, options.sameOriginSeed)) {
      throw new Error(`Cross-origin redirect rejected: ${current}`);
    }
    const response = await fetch(current, {
      signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,text/markdown,text/plain,*/*" },
      redirect: "manual"
    });
    if (!isRedirect(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error(`Redirect missing location for ${current}`);
    current = canonicalizeUrl(location, current);
  }
  throw new Error(`Too many redirects for ${url}`);
}
async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15e3);
  try {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetchWithRedirects(url, options, controller.signal);
        if (!response.ok) {
          if ((response.status >= 500 || response.status === 429) && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
            continue;
          }
          throw new Error(`Fetch failed ${response.status} for ${url}`);
        }
        const length = Number(response.headers.get("content-length") ?? "0");
        if (length > MAX_RESPONSE_BYTES) throw new Error(`Response too large for ${url}`);
        const text = await response.text();
        if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES)
          throw new Error(`Response too large for ${url}`);
        return { text, contentType: response.headers.get("content-type") ?? "" };
      } catch (error) {
        lastError = error;
        if (isSecurityRejection(error)) throw error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
    throw lastError ?? new Error(`Fetch failed for ${url}`);
  } finally {
    clearTimeout(timeout);
  }
}

// src/util/match.ts
import { minimatch } from "minimatch";
function matchesPattern(value, pattern) {
  if (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 2) {
    try {
      return new RegExp(pattern.slice(1, -1)).test(value);
    } catch {
      return false;
    }
  }
  try {
    return minimatch(value, pattern, { dot: true });
  } catch {
    return false;
  }
}
function matchesAnyPattern(value, patterns) {
  return Boolean(patterns?.some((pattern) => matchesPattern(value, pattern)));
}

// src/crawl/discovery.ts
async function loadRobots(seedUrl, enabled) {
  if (!enabled) return void 0;
  const origin = new URL(seedUrl).origin;
  try {
    const fetched = await fetchText(`${origin}/robots.txt`, { sameOriginSeed: seedUrl });
    const text = fetched.text;
    return robotsParser(`${origin}/robots.txt`, text);
  } catch {
    return robotsParser(`${origin}/robots.txt`, "");
  }
}
function shouldVisit(url, seed, options, robots) {
  if (!isHttpUrl(url)) return false;
  if ((options.sameOrigin ?? true) && !sameOrigin(url, seed)) return false;
  if (!options.allowPrivateNetwork && isPrivateNetworkUrl(url)) return false;
  if (options.include?.length && !matchesAnyPattern(url, options.include)) return false;
  if (matchesAnyPattern(url, options.exclude)) return false;
  if (robots && !robots.isAllowed(url, USER_AGENT)) return false;
  return true;
}

// src/crawl/extraction.ts
import * as cheerio2 from "cheerio";
function contentTypeFromHeader(header) {
  const lower = header.toLowerCase();
  if (lower.includes("text/html")) return "html";
  if (lower.includes("markdown")) return "markdown";
  if (lower.includes("text/plain")) return "text";
  if (!lower) return "html";
  return void 0;
}
function extractRawHtmlLinks(raw) {
  const $ = cheerio2.load(raw);
  return $("a[href]").map((_, element) => ({
    href: String($(element).attr("href") ?? ""),
    text: $(element).text().trim()
  })).get().filter((link) => link.href.length > 0);
}
function normalizeFetchedDocument(options) {
  const raw = {
    sourceId: options.url,
    url: options.url,
    contentType: options.contentType,
    raw: options.text,
    discoveredAt: options.discoveredAt
  };
  return normalizeDocument(raw);
}

// src/crawl/write.ts
async function writeCrawlBundle(documents, options) {
  if (documents.length === 0) throw new Error("Crawl generated zero concepts.");
  options.onProgress?.({
    type: "writing",
    concepts: documents.length,
    outDir: options.outDir
  });
  return writeOkfBundle(documents, {
    outDir: options.outDir,
    title: options.title,
    sourceName: options.seedUrl,
    force: options.force,
    dangerouslyAllowUnsafeOutput: options.dangerouslyAllowUnsafeOutput,
    timestamp: options.timestamp
  });
}

// src/crawler.ts
async function crawlWebsite(options) {
  const seed = canonicalizeUrl(options.seedUrl);
  if (!options.allowPrivateNetwork && isPrivateNetworkUrl(seed)) {
    throw new Error(
      "Private network crawl target rejected. Use --allow-private-network for trusted local fixtures."
    );
  }
  if (!options.allowPrivateNetwork) await assertPublicNetworkUrl(seed);
  const maxPages = options.maxPages ?? 100;
  const maxDepth = options.maxDepth ?? 4;
  const robots = await loadRobots(seed, options.respectRobots ?? true);
  const queue = [{ url: seed, depth: 0 }];
  const queued = /* @__PURE__ */ new Set([seed]);
  const visited = /* @__PURE__ */ new Set();
  const planned = [];
  const documents = [];
  let skipped = 0;
  let failed = 0;
  const limit = pLimit(options.concurrency ?? 4);
  options.onProgress?.({ type: "start", seed, maxPages, maxDepth });
  while (queue.length > 0 && visited.size < maxPages) {
    const batch = queue.splice(0, Math.min(queue.length, maxPages - visited.size));
    await Promise.all(
      batch.map(
        (item) => limit(async () => {
          if (visited.has(item.url)) return;
          visited.add(item.url);
          if (!shouldVisit(item.url, seed, options, robots)) {
            skipped += 1;
            options.onProgress?.({
              type: "skipped",
              url: item.url,
              fetched: documents.length,
              queued: queue.length,
              maxPages
            });
            return;
          }
          planned.push(item.url);
          options.onProgress?.({
            type: "fetch",
            url: item.url,
            fetched: documents.length,
            queued: queue.length,
            maxPages
          });
          try {
            const fetched = await fetchText(item.url, {
              allowPrivateNetwork: options.allowPrivateNetwork,
              sameOriginSeed: options.sameOrigin ?? true ? seed : void 0
            });
            const contentType = contentTypeFromHeader(fetched.contentType);
            if (!contentType) {
              skipped += 1;
              return;
            }
            const doc = normalizeFetchedDocument({
              url: item.url,
              contentType,
              text: fetched.text,
              discoveredAt: options.timestamp ?? (/* @__PURE__ */ new Date()).toISOString()
            });
            if (!options.dryRun) documents.push(doc);
            let discovered = 0;
            if (item.depth < maxDepth) {
              const links = options.dryRun && contentType === "html" ? extractRawHtmlLinks(fetched.text) : doc.links;
              for (const link of links) {
                try {
                  const next = canonicalizeUrl(link.href, item.url);
                  if (!queued.has(next) && shouldVisit(next, seed, options, robots) && (options.allowPrivateNetwork || !await resolvesToPrivateNetwork(next)) && queued.size < maxPages * 4) {
                    queued.add(next);
                    queue.push({ url: next, depth: item.depth + 1 });
                    discovered += 1;
                  }
                } catch {
                  skipped += 1;
                }
              }
            }
            options.onProgress?.({
              type: "fetched",
              url: item.url,
              fetched: options.dryRun ? planned.length : documents.length,
              queued: queue.length,
              discovered,
              maxPages
            });
          } catch (error) {
            if (isSecurityRejection(error)) throw error;
            failed += 1;
            options.onProgress?.({
              type: "failed",
              url: item.url,
              fetched: documents.length,
              queued: queue.length,
              maxPages
            });
          }
        })
      )
    );
  }
  if (options.dryRun) {
    return {
      pagesFetched: planned.length,
      skipped,
      failed,
      written: [],
      documents: [],
      dryRunPages: planned.slice(0, maxPages)
    };
  }
  const written = await writeCrawlBundle(documents, { ...options, seedUrl: seed });
  return { pagesFetched: documents.length, skipped, failed, written, documents };
}

// src/importer.ts
import fs2 from "fs/promises";
import path2 from "path";
function contentTypeFor(file) {
  const ext = path2.extname(file).toLowerCase();
  if (ext === ".md") return "markdown";
  if (ext === ".mdx") return "mdx";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".txt") return "text";
  return void 0;
}
async function listFiles(root) {
  const stat = await fs2.stat(root);
  if (stat.isFile()) return [root];
  const files = [];
  async function walk(dir) {
    for (const entry of await fs2.readdir(dir, { withFileTypes: true })) {
      const absolute = path2.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (![".git", "node_modules", "dist"].includes(entry.name)) await walk(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      }
    }
  }
  await walk(root);
  return files.sort();
}
async function importLocal(options) {
  const root = path2.resolve(options.inputPath);
  const files = await listFiles(root);
  const docs = [];
  for (const file of files) {
    const rel = path2.relative(root, file).split(path2.sep).join("/");
    if (options.include?.length && !matchesAnyPattern(rel, options.include)) continue;
    if (matchesAnyPattern(rel, options.exclude)) continue;
    const contentType = contentTypeFor(file);
    if (!contentType) continue;
    const raw = {
      sourceId: rel,
      filePath: rel,
      contentType,
      raw: await fs2.readFile(file, "utf8"),
      discoveredAt: options.timestamp ?? (/* @__PURE__ */ new Date()).toISOString()
    };
    docs.push(normalizeDocument(raw));
  }
  if (docs.length === 0) throw new Error("No supported Markdown, MDX, HTML, or text files found.");
  const written = await writeOkfBundle(docs, {
    outDir: options.outDir,
    title: options.sourceName,
    sourceName: options.sourceName ?? options.inputPath,
    force: options.force,
    inputPath: root,
    dangerouslyAllowUnsafeOutput: options.dangerouslyAllowUnsafeOutput,
    timestamp: options.timestamp
  });
  return { written, documents: docs };
}

// src/hub.ts
import fs3 from "fs/promises";
import http from "http";
import path3 from "path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import MiniSearch from "minisearch";
var HubSearch = class {
  graph;
  index;
  constructor(graph) {
    this.graph = graph;
    this.index = new MiniSearch({
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
  search(query, options = {}) {
    const limit = options.limit ?? 10;
    const trimmed = query.trim();
    const tagFilter = new Set(options.tags ?? []);
    return this.index.search(trimmed || MiniSearch.wildcard, { combineWith: trimmed ? "AND" : "OR" }).slice(0, Math.max(limit, 100)).map((hit) => ({ hit, concept: this.graph.concepts.get(hit.id) })).filter((row) => Boolean(row.concept)).filter(({ concept }) => !options.source || concept.source.sourceName === options.source).filter(({ concept }) => !options.type || concept.type === options.type).filter(
      ({ concept }) => tagFilter.size === 0 || concept.tags.some((tag) => tagFilter.has(tag))
    ).map(({ hit, concept }) => ({
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
    })).slice(0, limit);
  }
  getConcept(refOrId, source) {
    if (refOrId.includes(":")) return this.graph.concepts.get(refOrId);
    if (source) return this.graph.concepts.get(`${source}:${refOrId}`);
    const matches = [...this.graph.concepts.values()].filter((concept) => concept.id === refOrId);
    return matches.length === 1 ? matches[0] : void 0;
  }
  trace(refOrId, source) {
    const concept = this.getConcept(refOrId, source);
    const ref = concept?.ref ?? (source ? `${source}:${refOrId}` : refOrId);
    const dependencies = this.graph.outbound.get(ref) ?? [];
    const dependents = this.graph.backlinks.get(ref) ?? [];
    const sameIdAcrossSources = concept ? [...this.graph.concepts.values()].filter((candidate) => candidate.id === concept.id && candidate.ref !== concept.ref).map((candidate) => candidate.ref).sort() : [];
    return {
      ref,
      concept: concept ? {
        ref: concept.ref,
        id: concept.id,
        title: concept.title,
        type: concept.type,
        sourceName: concept.source.sourceName,
        resource: concept.resource,
        createdAt: concept.createdAt,
        updatedAt: concept.updatedAt,
        refreshedAt: concept.refreshedAt
      } : void 0,
      creationPath: concept ? creationPaths(this.graph, concept.ref) : [],
      dependencies,
      dependents,
      sameIdAcrossSources,
      orphan: dependencies.length === 0 && dependents.length === 0
    };
  }
  orphanAnalysis() {
    return [...this.graph.concepts.values()].filter(
      (concept) => (this.graph.outbound.get(concept.ref) ?? []).length === 0 && (this.graph.backlinks.get(concept.ref) ?? []).length === 0
    ).map((concept) => ({
      ref: concept.ref,
      id: concept.id,
      title: concept.title,
      sourceName: concept.source.sourceName
    })).sort((first, second) => first.ref.localeCompare(second.ref));
  }
  toJSONGraph() {
    return {
      schemaVersion: 1,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
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
  typeDistribution(source) {
    return distribution(this.graph, source, (concept) => [concept.type]);
  }
  tagDistribution(source) {
    return distribution(this.graph, source, (concept) => concept.tags);
  }
};
function hubImportsDir(options = {}) {
  return path3.join(resolveOkfitHome2(options), "hub", "imports");
}
function hubAuditLogPath(options = {}) {
  return path3.join(resolveOkfitHome2(options), "hub", "log.md");
}
async function appendHubAudit(action, message, details = {}, options = {}) {
  const logPath = hubAuditLogPath(options);
  const entry = `## ${(/* @__PURE__ */ new Date()).toISOString()} \u2014 ${action}

${message}

${Object.keys(details).length ? `\`\`\`json
${JSON.stringify(details, null, 2)}
\`\`\`

` : ""}`;
  await fs3.mkdir(path3.dirname(logPath), { recursive: true });
  await fs3.appendFile(logPath, entry, "utf8");
}
async function importBundleIntoHub(bundlePath, options = {}) {
  const resolved = path3.resolve(bundlePath);
  await validateHubBundlePath(resolved);
  const name = validateSourceName(options.name ?? bundleSourceName(resolved));
  const { importDir, bundleDir, manifestPath } = await prepareHubImportTarget(name, options);
  await fs3.mkdir(importDir, { recursive: true });
  await fs3.cp(resolved, bundleDir, { recursive: true });
  const record = await writeHubImportRecord(
    { name, bundleDir, originalPath: resolved, importedAt: (/* @__PURE__ */ new Date()).toISOString() },
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
async function importPathIntoHub(inputPath, options = {}) {
  const resolved = path3.resolve(inputPath);
  const name = validateSourceName(options.name ?? bundleSourceName(resolved));
  const { importDir, bundleDir, manifestPath } = await prepareHubImportTarget(name, options);
  try {
    await validateHubBundlePath(resolved);
    await fs3.mkdir(importDir, { recursive: true });
    await fs3.cp(resolved, bundleDir, { recursive: true });
    const record2 = await writeHubImportRecord(
      { name, bundleDir, originalPath: resolved, importedAt: (/* @__PURE__ */ new Date()).toISOString() },
      manifestPath
    );
    await appendHubAudit("import", `Copied OKF bundle ${resolved} into hub as ${name}.`, { name, originalPath: resolved, bundleDir }, options);
    const concepts = await readBundle(bundleDir);
    return { record: record2, conceptCount: new Set([...concepts.values()].map((concept) => concept.id)).size, mode: "copy-bundle" };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Cannot import invalid OKF bundle")) throw error;
  }
  await fs3.mkdir(importDir, { recursive: true });
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
    { name, bundleDir, originalPath: resolved, importedAt: (/* @__PURE__ */ new Date()).toISOString() },
    manifestPath
  );
  await appendHubAudit("import", `Converted ${resolved} into hub OKF bundle ${name}.`, { name, originalPath: resolved, bundleDir, conceptCount: result.documents.length }, options);
  return { record, conceptCount: result.documents.length, mode: "convert-local" };
}
async function listHubImportedBundles(options = {}) {
  const root = hubImportsDir(options);
  let entries;
  try {
    entries = await fs3.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const raw = JSON.parse(await fs3.readFile(path3.join(root, entry.name, "import.json"), "utf8"));
      records.push(validateHubImportRecord(raw, entry.name));
    } catch {
    }
  }
  return records.sort((first, second) => first.name.localeCompare(second.name));
}
async function resolveHubSources(options = {}) {
  const registered = await listSources(options);
  const imports = await listHubImportedBundles(options);
  const importRecords = imports.map(importedRecordFromManifest);
  const names = /* @__PURE__ */ new Set();
  const records = [];
  for (const record of [...registered, ...importRecords]) {
    if (names.has(record.name)) continue;
    names.add(record.name);
    records.push(record);
  }
  return records.sort((first, second) => first.name.localeCompare(second.name));
}
async function buildHubSearch(options = {}) {
  const records = await resolveHubSources(options);
  const summaries = await Promise.all(records.map(sourceSummary));
  return new HubSearch(
    await buildHubKnowledgeGraph(
      records.filter((_, index) => summaries[index]?.availabilityStatus === "available")
    )
  );
}
async function buildHubKnowledgeGraph(records) {
  const concepts = /* @__PURE__ */ new Map();
  const outbound = /* @__PURE__ */ new Map();
  const backlinks = /* @__PURE__ */ new Map();
  const edges = [];
  const bySourceConceptId = /* @__PURE__ */ new Map();
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
  const refsById = /* @__PURE__ */ new Map();
  for (const concept of concepts.values()) {
    refsById.set(concept.id, [...refsById.get(concept.id) ?? [], concept.ref]);
  }
  for (const refs of refsById.values()) {
    if (refs.length < 2) continue;
    const sorted = [...refs].sort();
    for (let index = 0; index < sorted.length; index += 1) {
      for (let inner = index + 1; inner < sorted.length; inner += 1) {
        edges.push({
          from: sorted[index],
          to: sorted[inner],
          kind: "cross_source_same_id",
          label: "Same concept id across sources"
        });
      }
    }
  }
  return { concepts, outbound, backlinks, edges, bySourceConceptId };
}
async function buildHubOverview(options = {}) {
  const okfitHome = resolveOkfitHome2(options);
  const records = await resolveHubSources(options);
  const summaries = await Promise.all(records.map(sourceSummary));
  const graph = await buildHubKnowledgeGraph(records.filter((_, index) => summaries[index]?.availabilityStatus === "available"));
  const search = new HubSearch(graph);
  const warningCount = summaries.reduce((sum2, source) => sum2 + source.warningCount, 0);
  const brokenLinks = summaries.reduce((sum2, source) => sum2 + source.brokenLinks, 0);
  const orphanCount = search.orphanAnalysis().length;
  return {
    schemaVersion: 1,
    okfitVersion: packageVersion(),
    okfitHome,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
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
    freshnessTimeline: summaries.map((source) => ({
      sourceName: source.name,
      status: source.freshnessStatus,
      lastSuccessfulRefreshAt: source.lastSuccessfulRefreshAt,
      importedAt: source.importedAt
    })).sort(
      (first, second) => String(second.lastSuccessfulRefreshAt ?? second.importedAt ?? "").localeCompare(
        String(first.lastSuccessfulRefreshAt ?? first.importedAt ?? "")
      )
    ),
    typeDistribution: search.typeDistribution(),
    tagDistribution: search.tagDistribution(),
    sources: summaries
  };
}
async function createHubMcpServer(options = {}) {
  const records = await resolveHubSources(options);
  return createWorkspaceMcpServer({
    name: options.name ?? "okfit-hub",
    maxResultChars: options.maxResultChars,
    availableSourceNames: records.map((record) => record.name),
    sources: records.map((record) => ({ record }))
  });
}
async function serveHubMcpStdio(options = {}) {
  const server = await createHubMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
function renderHubLlmsTxt(baseUrl) {
  const base = baseUrl.replace(/\/$/, "");
  return `# OKFIT Hub

A central, source-aware Open Knowledge Format memory hub.

## Agent entry points

- Overview: ${base}/api/overview
- Search: ${base}/api/search?q=your-query
- Graph JSON: ${base}/graph.json
- Orphan analysis: ${base}/api/orphans
- MCP manifest: ${base}/mcp-manifest.json

## Trace queries

Use ${base}/api/trace?ref=source:concept-id to inspect creation path, dependencies, dependents, and cross-source matches.
`;
}
function renderHubSitemap(baseUrl) {
  const base = baseUrl.replace(/\/$/, "");
  const urls = ["/", "/llms.txt", "/graph.json", "/api/overview", "/api/orphans", "/mcp-manifest.json"];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${escapeXml(`${base}${url}`)}</loc></url>`).join("\n")}
</urlset>
`;
}
function hubMcpManifest(baseUrl) {
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
async function startHubHttpServer(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 8765;
  const server = http.createServer(async (request, response) => {
    try {
      await handleHubRequest(request, response, { ...options, host, port: requestedPort });
    } catch (error) {
      sendJson(response, 500, { error: { message: error?.message ?? "Hub request failed." } });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  await appendHubAudit("serve", `Started OKFIT hub server at http://${host}:${requestedPort}.`, { host, port: requestedPort }, options);
  return server;
}
async function handleHubRequest(request, response, options) {
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
      source: url.searchParams.get("source") ?? void 0,
      type: url.searchParams.get("type") ?? void 0,
      tags: url.searchParams.getAll("tag"),
      limit: Number(url.searchParams.get("limit") ?? 10)
    }));
    return;
  }
  if (url.pathname === "/api/trace") {
    const search = await buildHubSearch(options);
    sendJson(response, 200, search.trace(url.searchParams.get("ref") ?? url.searchParams.get("id") ?? "", url.searchParams.get("source") ?? void 0));
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
    sendJson(response, 200, { status: "refresh-queued", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
    return;
  }
  sendJson(response, 404, { error: { message: "Not found" } });
}
function renderHubDashboard(overview, search) {
  const graph = search.toJSONGraph();
  const data = JSON.stringify({ overview, graph }).replace(/</g, "<");
  const sourceOptions = overview.sources.map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join("");
  const typeOptions = Object.keys(overview.typeDistribution).sort().map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
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
      <span class="logo">\u25C6</span>
      <div style="min-width:0">
        <h1>OKFIT Hub</h1>
        <p class="sub">source-aware agent memory \xB7 <span class="mono">${escapeHtml(overview.okfitHome)}</span></p>
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
          <input id="q" placeholder="Search all concepts, tags, sources\u2026" autocomplete="off" spellcheck="false">
        </div>
        <select id="f-source"><option value="">All sources</option>${sourceOptions}</select>
        <select id="f-type"><option value="">All types</option>${typeOptions}</select>
        <div class="spacer"></div>
        <button class="tool" id="fit" type="button" title="Fit to view (f)">\u2922 fit</button>
        <button class="tool" id="clear" type="button" title="Clear filters">clear</button>
        <button class="refresh-btn" id="refresh" type="button">\u21BB refresh</button>
        <span class="result-count" id="count"></span>
      </div>
      <div class="canvas-wrap">
        <canvas id="graph"></canvas>
        <div class="legend" id="legend"></div>
        <div class="hint">drag to pan \xB7 scroll to zoom \xB7 click a node to trace \xB7 / to search</div>
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
        <div class="sources">${overview.sources.map((s) => {
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
function sendText(response, status, value, contentType = "text/plain; charset=utf-8") {
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  response.end(value);
}
function sendHtml(response, status, value) {
  sendText(response, status, value, "text/html; charset=utf-8");
}
function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}
async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}
function escapeXml(value) {
  return escapeHtml(value);
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

// src/hash.ts
import crypto from "crypto";
import fs4 from "fs/promises";
import path4 from "path";
async function listBundleFiles(bundleDir) {
  const files = [];
  async function walk(current) {
    for (const entry of await fs4.readdir(current, { withFileTypes: true })) {
      const absolutePath = path4.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        files.push({
          absolutePath,
          relativePath: toPosixPath(path4.relative(bundleDir, absolutePath))
        });
      }
    }
  }
  await walk(bundleDir);
  return files.sort((first, second) => first.relativePath.localeCompare(second.relativePath));
}
async function hashBundleContents(bundleDir) {
  const hash = crypto.createHash("sha256");
  const files = await listBundleFiles(bundleDir);
  for (const file of files) {
    const contents = await fs4.readFile(file.absolutePath);
    hash.update(`${file.relativePath.length}:${file.relativePath}\0${contents.byteLength}:`);
    hash.update(contents);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

// src/refresh.ts
import fs5 from "fs/promises";
import path5 from "path";
import { randomUUID } from "crypto";
var DEFAULT_STALE_LOCK_TIMEOUT_MS = 30 * 60 * 1e3;
async function pathExists2(target) {
  try {
    await fs5.access(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
function secondsBetween(startIso, end) {
  return (end.getTime() - new Date(startIso).getTime()) / 1e3;
}
function iso(date) {
  return date.toISOString();
}
function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1e3).toISOString();
}
function isBeforeNextRefreshAllowed(state, now) {
  if (!state?.nextRefreshAllowedAt) return false;
  return new Date(state.nextRefreshAllowedAt).getTime() > now.getTime();
}
function tempBundleDir(sourceDir) {
  return path5.join(sourceDir, `bundle.tmp-${process.pid}-${randomUUID()}`);
}
function lockfilePath(sourceDir) {
  return path5.join(sourceDir, ".refresh.lock");
}
async function isLockStale(lockPath, now, staleLockTimeoutMs) {
  try {
    const raw = await fs5.readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw);
    const createdAt = parsed.createdAt ? Date.parse(parsed.createdAt) : Number.NaN;
    if (Number.isFinite(createdAt)) return now.getTime() - createdAt > staleLockTimeoutMs;
  } catch {
  }
  const stat = await fs5.stat(lockPath);
  return now.getTime() - stat.mtimeMs > staleLockTimeoutMs;
}
async function acquireRefreshLock(sourceDir, now, staleLockTimeoutMs) {
  const lockPath = lockfilePath(sourceDir);
  await fs5.mkdir(sourceDir, { recursive: true });
  try {
    const handle = await fs5.open(lockPath, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: iso(now) }, null, 2));
    await handle.close();
    return {
      acquired: true,
      release: async () => {
        await fs5.rm(lockPath, { force: true });
      }
    };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  if (await isLockStale(lockPath, now, staleLockTimeoutMs)) {
    await fs5.rm(lockPath, { force: true });
    return acquireRefreshLock(sourceDir, now, staleLockTimeoutMs);
  }
  return { acquired: false };
}
function stateForRefreshStart(state, freshness, startedAt) {
  return {
    schemaVersion: 1,
    status: "refreshing",
    lastCheckedAt: iso(startedAt),
    lastRefreshStartedAt: iso(startedAt),
    lastRefreshCompletedAt: state?.lastRefreshCompletedAt ?? null,
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    refreshInProgress: true,
    lastError: state?.lastError ?? null,
    bundle: state?.bundle ?? (freshness.validation ? bundleStateFromValidation(freshness.validation, state?.bundle?.contentHash ?? "") : null)
  };
}
function stateForLockedRefresh(state, checkedAt) {
  return {
    schemaVersion: 1,
    status: "refreshing",
    lastCheckedAt: iso(checkedAt),
    lastRefreshStartedAt: state?.lastRefreshStartedAt ?? null,
    lastRefreshCompletedAt: state?.lastRefreshCompletedAt ?? null,
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    refreshInProgress: true,
    lastError: state?.lastError ?? null,
    bundle: state?.bundle ?? null
  };
}
function stateForCheckedRefresh(state, status, checkedAt) {
  return {
    schemaVersion: 1,
    status,
    lastCheckedAt: iso(checkedAt),
    lastRefreshStartedAt: state?.lastRefreshStartedAt ?? null,
    lastRefreshCompletedAt: state?.lastRefreshCompletedAt ?? null,
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    refreshInProgress: false,
    lastError: state?.lastError ?? null,
    bundle: state?.bundle ?? null
  };
}
function messageFromError(error) {
  return error instanceof Error ? error.message : String(error);
}
function errorState(manifest, error, occurredAt) {
  return {
    message: messageFromError(error),
    sourceName: manifest.name,
    seedUrl: manifest.source.seedUrl,
    occurredAt: iso(occurredAt)
  };
}
function stateForRefreshFailure(state, manifest, error, startedAt) {
  return {
    schemaVersion: 1,
    status: "failed",
    lastCheckedAt: iso(startedAt),
    lastRefreshStartedAt: iso(startedAt),
    lastRefreshCompletedAt: iso(startedAt),
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: addSeconds(startedAt, manifest.refresh.minIntervalSeconds),
    refreshInProgress: false,
    lastError: errorState(manifest, error, startedAt),
    bundle: state?.bundle ?? null
  };
}
function bundleStateFromValidation(validation, contentHash) {
  return {
    conceptCount: validation.conceptCount,
    warningCount: validation.warningCount,
    valid: validation.valid,
    contentHash
  };
}
async function replaceActiveBundle(tempDir, bundleDir) {
  await assertSafeForceOutDir(bundleDir, { outDir: bundleDir, force: true });
  const backupDir = `${bundleDir}.backup-${process.pid}-${randomUUID()}`;
  let movedActiveToBackup = false;
  try {
    await fs5.mkdir(path5.dirname(bundleDir), { recursive: true });
    if (await pathExists2(bundleDir)) {
      await fs5.rename(bundleDir, backupDir);
      movedActiveToBackup = true;
    }
    await fs5.rename(tempDir, bundleDir);
    if (movedActiveToBackup) await fs5.rm(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (movedActiveToBackup && !await pathExists2(bundleDir) && await pathExists2(backupDir)) {
      await fs5.rename(backupDir, bundleDir);
    }
    throw error;
  }
}
async function evaluateFreshness(options) {
  const now = options.now ?? /* @__PURE__ */ new Date();
  const validateBundle2 = options.validateBundle ?? validateBundle;
  if (!await pathExists2(options.bundleDir)) {
    return { status: "missing", reason: "bundle_missing" };
  }
  if (options.state?.refreshInProgress) {
    return { status: "refreshing", reason: "refresh_in_progress" };
  }
  if ((options.state?.status === "failed" || options.state?.lastError) && isBeforeNextRefreshAllowed(options.state, now)) {
    return { status: "failed", reason: "latest_refresh_failed" };
  }
  const validation = await validateBundle2(options.bundleDir);
  if (!validation.valid) {
    return { status: "failed", reason: "bundle_invalid", validation };
  }
  if (options.state?.status === "failed" || options.state?.lastError) {
    return {
      status: isBeforeNextRefreshAllowed(options.state, now) ? "failed" : "stale",
      reason: "latest_refresh_failed",
      validation
    };
  }
  const lastSuccessfulRefreshAt = options.state?.lastSuccessfulRefreshAt;
  if (!lastSuccessfulRefreshAt) {
    return { status: "stale", reason: "never_refreshed", validation };
  }
  const maxAgeSeconds = options.maxAgeSeconds ?? options.manifest.refresh.maxAgeSeconds;
  if (secondsBetween(lastSuccessfulRefreshAt, now) > maxAgeSeconds) {
    return { status: "stale", reason: "exceeded_max_age", validation };
  }
  return { status: "fresh", reason: "within_max_age", validation };
}
async function refreshSource(options) {
  const now = options.now ?? /* @__PURE__ */ new Date();
  const crawlRunner = options.crawlRunner ?? crawlWebsite;
  const inspectBundle2 = options.inspectBundle ?? inspectBundle;
  const hashBundleContent = options.hashBundleContent ?? hashBundleContents;
  const freshness = await evaluateFreshness({
    manifest: options.manifest,
    state: options.state,
    bundleDir: options.bundleDir,
    now,
    validateBundle: options.validateBundle
  });
  if (!options.force && freshness.status === "fresh") {
    const nextState = stateForCheckedRefresh(options.state, "fresh", now);
    await options.writeState(nextState);
    return { status: "fresh", reason: "fresh", skipped: true, state: nextState };
  }
  if (!options.force && isBeforeNextRefreshAllowed(options.state, now)) {
    const nextState = stateForCheckedRefresh(options.state, freshness.status, now);
    await options.writeState(nextState);
    return { status: freshness.status, reason: "min_interval", skipped: true, state: nextState };
  }
  const tempDir = tempBundleDir(options.sourceDir);
  if (options.dryRun) {
    try {
      const crawlResult = await crawlRunner({
        ...options.manifest.crawl,
        seedUrl: options.manifest.source.seedUrl,
        outDir: tempDir,
        dryRun: true,
        timestamp: iso(now)
      });
      return { status: freshness.status, skipped: false, dryRun: true, crawlResult };
    } finally {
      await fs5.rm(tempDir, { recursive: true, force: true });
    }
  }
  const lock = await acquireRefreshLock(
    options.sourceDir,
    now,
    options.staleLockTimeoutMs ?? DEFAULT_STALE_LOCK_TIMEOUT_MS
  );
  if (!lock.acquired) {
    const lockedState = stateForLockedRefresh(options.state, now);
    await options.writeState(lockedState);
    return { status: "refreshing", reason: "locked", skipped: true, state: lockedState };
  }
  const startedState = stateForRefreshStart(options.state, freshness, now);
  try {
    await options.writeState(startedState);
    const crawlResult = await crawlRunner({
      ...options.manifest.crawl,
      seedUrl: options.manifest.source.seedUrl,
      outDir: tempDir,
      force: true,
      dryRun: false,
      timestamp: iso(now)
    });
    const validation = await (options.validateBundle ?? validateBundle)(tempDir);
    if (!validation.valid) {
      throw new Error(`Refresh generated invalid bundle for ${options.manifest.name}.`);
    }
    const inspection = await inspectBundle2(tempDir);
    const contentHash = await hashBundleContent(tempDir);
    await replaceActiveBundle(tempDir, options.bundleDir);
    const nextState = {
      schemaVersion: 1,
      status: "fresh",
      lastCheckedAt: iso(now),
      lastRefreshStartedAt: iso(now),
      lastRefreshCompletedAt: iso(now),
      lastSuccessfulRefreshAt: iso(now),
      nextRefreshAllowedAt: addSeconds(now, options.manifest.refresh.minIntervalSeconds),
      refreshInProgress: false,
      lastError: null,
      bundle: {
        conceptCount: inspection.conceptCount,
        warningCount: inspection.warningCount,
        valid: validation.valid,
        contentHash
      }
    };
    await options.writeState(nextState);
    return { status: "fresh", skipped: false, state: nextState, crawlResult };
  } catch (error) {
    await fs5.rm(tempDir, { recursive: true, force: true });
    const failedState = stateForRefreshFailure(options.state, options.manifest, error, now);
    await options.writeState(failedState);
    return {
      status: "failed",
      skipped: false,
      state: failedState,
      error: failedState.lastError ?? void 0
    };
  } finally {
    await lock.release();
  }
}

// src/duration.ts
var DURATION_UNITS = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60
};
function parseDurationSeconds(input) {
  const value = input.trim();
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    throw new Error(`Invalid duration "${input}". Use a number followed by s, m, h, or d.`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "";
  const multiplier = DURATION_UNITS[unit];
  const seconds = amount * multiplier;
  if (!Number.isSafeInteger(seconds)) {
    throw new Error(`Invalid duration "${input}". Duration is too large.`);
  }
  return seconds;
}

// src/activation.ts
import fs6 from "fs/promises";
import path6 from "path";
var PACKET_FILES = [
  { label: "Inspector HTML", fileName: "okfit-inspector.html" },
  { label: "Setup Markdown", fileName: "okfit-setup.md" },
  { label: "Proof JSON", fileName: "okfit-proof.json" }
];
async function buildActivationPacket(options) {
  const outDir = path6.resolve(options.outDir);
  const protectedInputPaths = uniqueResolvedPaths(
    options.protectedInputPaths ?? protectedActivationInputPaths(options.records)
  );
  const files = PACKET_FILES.map((file) => ({ ...file, path: path6.join(outDir, file.fileName) }));
  const usesRegistered = options.records.some(isRegisteredWorkspaceRecord) || isAllTarget(options.commandTarget);
  const okfitHome = usesRegistered ? options.okfitHome ?? process.env.OKFIT_HOME ?? defaultOkfitHome() : defaultOkfitHome();
  const serverIdentity = options.serverIdentity ?? options.records.map((record) => record.name);
  const serverName = mcpServerName(serverIdentity);
  const codexServerName = codexMcpServerName(serverIdentity);
  const command = serveCommand(options.commandTarget, okfitHome, defaultOkfitHome(), {
    autoRefresh: options.autoRefresh ?? usesRegistered
  });
  const artifacts = renderMcpClientArtifacts({
    client: options.client,
    serverName,
    codexServerName,
    command
  });
  const workspace = options.report.target.kind !== "bundle";
  const firstPrompt = firstAgentPrompt(options.client === "codex" ? codexServerName : serverName, {
    workspace
  });
  const setup = {
    client: options.client,
    serverName,
    codexServerName,
    command,
    artifacts,
    firstPrompt
  };
  const proof = await buildActivationProof({
    records: options.records,
    report: options.report,
    proofTask: options.proofTask,
    generatedAt: options.generatedAt ?? (/* @__PURE__ */ new Date()).toISOString()
  });
  return {
    schemaVersion: 1,
    generatedBy: "okfit",
    outDir,
    protectedInputPaths,
    setup,
    proof,
    files
  };
}
function withActivationMetadata(report, packet) {
  return {
    ...report,
    activation: {
      client: packet.setup.client,
      serverName: packet.setup.serverName,
      codexServerName: packet.setup.codexServerName,
      command: {
        display: packet.setup.command.display,
        env: packet.setup.command.env
      },
      firstPrompt: packet.setup.firstPrompt,
      artifacts: packet.setup.artifacts.map((artifact) => ({
        label: artifact.label,
        format: artifact.format,
        body: artifact.body
      })),
      files: packet.files.map((file) => ({ label: file.label, path: file.path }))
    }
  };
}
function renderActivationSetupMarkdown(packet) {
  const lines = [
    "# OKFIT Activation Packet",
    "",
    `Status: ${packet.proof.summary.result.readiness.validationStatus}`,
    `Client: ${packet.setup.client}`,
    `Server: ${packet.setup.serverName}`,
    "",
    "## MCP Launch Command",
    "",
    "```bash",
    packet.setup.command.display,
    "```",
    ""
  ];
  if (Object.keys(packet.setup.command.env).length) {
    lines.push("Environment:", "");
    lines.push("```json", JSON.stringify(packet.setup.command.env, null, 2), "```", "");
  }
  lines.push("## Client Setup", "");
  for (const artifact of packet.setup.artifacts) {
    lines.push(`### ${artifact.label}`, "", codeFence(artifact.format), artifact.body, "```", "");
  }
  lines.push(
    "## First Prompt",
    "",
    "```text",
    packet.setup.firstPrompt,
    "```",
    "",
    "## Proof",
    "",
    `Query: ${packet.proof.search.input.query}`,
    `Search results: ${packet.proof.search.results.length}`,
    `Read concept: ${packet.proof.read?.result.ref ?? "none"}`,
    `Citation: ${packet.proof.read?.result.citation.sourceResource ?? "none"}`,
    "",
    "## Packet Files",
    ""
  );
  for (const file of packet.files) lines.push(`- ${file.label}: \`${file.path}\``);
  return `${lines.join("\n").trimEnd()}
`;
}
async function writeActivationPacketFiles(packet, contents, options = {}) {
  await ensureActivationOutDir(packet.outDir, {
    force: Boolean(options.force),
    protectedInputPaths: options.protectedInputPaths ?? packet.protectedInputPaths
  });
  await Promise.all([
    writeFileAtomically(packet.files[0].path, contents.inspectorHtml),
    writeFileAtomically(packet.files[1].path, contents.setupMarkdown),
    writeFileAtomically(packet.files[2].path, `${JSON.stringify(packet.proof, null, 2)}
`)
  ]);
}
async function buildActivationProof(options) {
  const loaded = await loadSources(options.records);
  const primary = firstReadableConcept(loaded, options.report);
  const taskQuery = normalizeProofTask(options.proofTask);
  const query = taskQuery ?? (primary ? queryForConcept(primary.concept) : "documentation");
  const searchSource = sourceScopedProofSearch(loaded, options.report);
  const searchResults = loaded.length ? searchProofResults(loaded, query, options.report, searchSource) : [];
  const searchedTarget = conceptForSearchResult(loaded, searchResults[0], options.report);
  const readTarget = searchedTarget ?? (taskQuery ? void 0 : primary);
  return {
    schemaVersion: 1,
    generatedBy: "okfit",
    generatedAt: options.generatedAt,
    target: options.report.target,
    summary: {
      tool: "bundle_summary",
      result: {
        title: options.report.title,
        readiness: options.report.readiness,
        sources: options.report.sources
      }
    },
    search: {
      tool: "search_concepts",
      input: {
        query,
        limit: 5,
        ...searchSource ? { source: searchSource } : {}
      },
      results: searchResults
    },
    read: readTarget ? readProof(readTarget, options.report) : null,
    neighbors: readTarget ? neighborProof(readTarget, options.report) : null
  };
}
async function loadSources(records) {
  const loaded = [];
  for (const record of records) {
    if (record.loadError) continue;
    try {
      loaded.push({ record, search: await BundleSearch.fromBundle(record.bundleDir) });
    } catch {
    }
  }
  return loaded;
}
function firstReadableConcept(loaded, report) {
  for (const source of loaded) {
    const concept = [...source.search.graph.concepts.values()].sort(
      (first, second) => first.id.localeCompare(second.id)
    )[0];
    if (concept) return proofConcept(source, concept, report);
  }
  return void 0;
}
function searchProofResults(loaded, query, report, sourceName) {
  const searchable = sourceName ? loaded.filter((source) => source.record.name === sourceName) : loaded;
  return searchable.flatMap(
    (source) => source.search.search(query, { limit: 5 }).map((result) => proofSearchResult(source, result, report))
  ).sort(
    (first, second) => second.score - first.score || (first.sourceName ?? "").localeCompare(second.sourceName ?? "") || first.id.localeCompare(second.id)
  ).slice(0, 5);
}
function sourceScopedProofSearch(loaded, report) {
  if (report.target.kind === "bundle") return void 0;
  return loaded.length === 1 ? loaded[0].record.name : void 0;
}
function conceptForSearchResult(loaded, result, report) {
  if (!result) return void 0;
  const source = result.sourceName ? loaded.find((candidate) => candidate.record.name === result.sourceName) : loaded[0];
  const concept = source?.search.getConcept(result.id);
  return source && concept ? proofConcept(source, concept, report) : void 0;
}
function readProof(target, report) {
  return {
    tool: "read_concept",
    input: {
      id: target.concept.id,
      ...report.target.kind !== "bundle" ? { source: target.record.name } : {},
      max_chars: 4e3
    },
    result: {
      id: target.concept.id,
      ref: target.ref,
      title: target.concept.title,
      type: target.concept.type,
      resource: target.concept.resource,
      bodyPreview: target.concept.body.replace(/\s+/g, " ").trim().slice(0, 500),
      citation: {
        ref: target.ref,
        sourceResource: target.concept.resource,
        ...report.target.kind !== "bundle" ? { sourceName: target.record.name } : {}
      }
    }
  };
}
function neighborProof(target, report) {
  return {
    tool: "get_neighbors",
    input: {
      id: target.concept.id,
      ...report.target.kind !== "bundle" ? { source: target.record.name } : {},
      depth: 1
    },
    result: {
      outbound: (target.search.graph.outbound.get(target.concept.id) ?? []).map((id) => refFor(target.record, id, report)).sort(),
      backlinks: (target.search.graph.backlinks.get(target.concept.id) ?? []).map((id) => refFor(target.record, id, report)).sort()
    }
  };
}
function proofSearchResult(source, result, report) {
  return {
    ...report.target.kind !== "bundle" ? { sourceName: source.record.name } : {},
    id: result.id,
    ref: refFor(source.record, result.id, report),
    title: result.title,
    type: result.type,
    resource: result.resource,
    snippet: result.snippet,
    score: result.score
  };
}
function proofConcept(source, concept, report) {
  return {
    record: source.record,
    search: source.search,
    concept,
    ref: refFor(source.record, concept.id, report)
  };
}
function refFor(record, id, report) {
  return report.concepts.find((concept) => concept.sourceName === record.name && concept.id === id)?.ref ?? report.concepts.find((concept) => concept.id === id)?.ref ?? (report.target.kind === "bundle" ? id : `${record.name}:${id}`);
}
function queryForConcept(concept) {
  const candidate = concept.title ?? concept.description ?? concept.id;
  return candidate.replace(/[^A-Za-z0-9\s._-]+/g, " ").replace(/\s+/g, " ").trim() || concept.id;
}
function normalizeProofTask(task) {
  const normalized = task?.replace(/\s+/g, " ").trim();
  return normalized || void 0;
}
async function ensureActivationOutDir(outDir, options) {
  const protectedInputPaths = uniqueResolvedPaths(options.protectedInputPaths ?? []);
  assertActivationOutDirDoesNotTargetProtectedPaths(outDir, protectedInputPaths);
  if (options.force) {
    if (protectedInputPaths.length) {
      for (const inputPath of protectedInputPaths) {
        await assertSafeForceOutDir(outDir, { outDir, force: true, inputPath });
      }
    } else {
      await assertSafeForceOutDir(outDir, { outDir, force: true });
    }
  }
  try {
    const entries = await fs6.readdir(outDir);
    if (entries.length > 0) {
      if (!options.force)
        throw new Error(
          `Activation output directory is not empty: ${outDir}. Use --force to overwrite.`
        );
      await fs6.rm(outDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs6.mkdir(outDir, { recursive: true });
}
function assertActivationOutDirDoesNotTargetProtectedPaths(outDir, protectedInputPaths) {
  const resolvedOut = path6.resolve(outDir);
  let nestedConflict;
  for (const inputPath of protectedInputPaths) {
    const protectedPath = path6.resolve(inputPath);
    if (resolvedOut === protectedPath) {
      throw new Error(
        `Activation output directory cannot target a selected source path: ${resolvedOut}. Choose a separate --out directory.`
      );
    }
    if (isPathInside(protectedPath, resolvedOut))
      nestedConflict ??= { relation: "descendant", protectedPath };
    if (isPathInside(resolvedOut, protectedPath))
      nestedConflict ??= { relation: "ancestor", protectedPath };
  }
  if (nestedConflict?.relation === "descendant") {
    throw new Error(
      `Activation output directory cannot be inside a selected source path: ${resolvedOut} is inside ${nestedConflict.protectedPath}. Choose a separate --out directory.`
    );
  }
  if (nestedConflict?.relation === "ancestor") {
    throw new Error(
      `Activation output directory cannot contain a selected source path: ${resolvedOut} contains ${nestedConflict.protectedPath}. Choose a separate --out directory.`
    );
  }
}
function protectedActivationInputPaths(records) {
  return records.flatMap(
    (record) => isRegisteredWorkspaceRecord(record) ? [record.bundleDir, record.dir] : [record.bundleDir]
  );
}
function isPathInside(parentPath, childPath) {
  const relative = path6.relative(parentPath, childPath);
  return relative !== "" && !relative.startsWith("..") && !path6.isAbsolute(relative);
}
function uniqueResolvedPaths(paths) {
  return Array.from(new Set(paths.map((filePath) => path6.resolve(filePath))));
}
async function writeFileAtomically(filePath, contents) {
  const resolved = path6.resolve(filePath);
  const tempPath = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  await fs6.mkdir(path6.dirname(resolved), { recursive: true });
  try {
    await fs6.writeFile(tempPath, contents, "utf8");
    await fs6.rename(tempPath, resolved);
  } catch (error) {
    await fs6.rm(tempPath, { force: true });
    throw error;
  }
}
function codeFence(format) {
  if (format === "toml") return "```toml";
  if (format === "json") return "```json";
  return "```bash";
}
function isAllTarget(target) {
  return typeof target === "object" && !Array.isArray(target) && target.all;
}

// src/inspector.ts
import path7 from "path";
async function buildBundleInspectorReport(bundleDir, options = {}) {
  const resolved = path7.resolve(bundleDir);
  const record = localBundleRecord(resolved);
  return buildInspectorReport([record], {
    target: { kind: "bundle", bundleDir: resolved },
    title: options.title ?? `${path7.basename(resolved)} OKFIT Inspector`,
    prefixSingleSourceRefs: false
  });
}
async function buildWorkspaceInspectorReport(records, options = {}) {
  return buildInspectorReport(records, {
    target: {
      kind: "workspace",
      workspaceName: options.workspaceName,
      sourceNames: records.map((record) => record.name)
    },
    title: options.title ?? `${options.workspaceName ?? "Workspace"} OKFIT Inspector`,
    prefixSingleSourceRefs: true
  });
}
async function buildInspectorReport(records, options) {
  const sourceReports = await Promise.all(
    records.map(
      (record) => sourceReport(record, {
        prefixRefs: options.prefixSingleSourceRefs || records.length > 1
      })
    )
  );
  const sources = sourceReports.map((report) => report.source);
  const concepts = sourceReports.flatMap((report) => report.concepts);
  const edges = sourceReports.flatMap((report) => report.edges);
  const readiness = summarizeReadiness(sources);
  return {
    schemaVersion: 1,
    title: options.title,
    generatedBy: "okfit",
    target: options.target,
    readiness,
    sources,
    concepts,
    edges,
    agentPreview: agentPreview(sources, concepts)
  };
}
async function sourceReport(record, options) {
  const baseSource = sourceBase(record);
  if (record.loadError) {
    return {
      source: unavailableSource(baseSource, record.loadError, record.state),
      concepts: [],
      edges: []
    };
  }
  let search;
  try {
    search = await BundleSearch.fromBundle(record.bundleDir);
  } catch (error) {
    return {
      source: unavailableSource(baseSource, error, record.state),
      concepts: [],
      edges: []
    };
  }
  const [validation, stats] = await Promise.all([
    validateBundle(record.bundleDir),
    inspectBundle(record.bundleDir)
  ]);
  const refFor2 = (id) => options.prefixRefs ? `${record.name}:${id}` : id;
  const concepts = [...search.graph.concepts.values()].sort((first, second) => first.id.localeCompare(second.id)).map((concept) => inspectorConcept(concept, search, record, refFor2, options.prefixRefs));
  return {
    source: {
      ...baseSource,
      availabilityStatus: "available",
      validationStatus: validation.valid ? "valid" : "invalid",
      conceptCount: stats.conceptCount,
      warningCount: validation.warningCount,
      brokenLinkCount: brokenLinkCount(validation.issues),
      orphanConcepts: stats.orphanConcepts.map(refFor2),
      freshnessStatus: record.state?.status ?? "fresh",
      refreshInProgress: Boolean(record.state?.refreshInProgress),
      lastSuccessfulRefreshAt: record.state?.lastSuccessfulRefreshAt ?? null,
      nextRefreshAllowedAt: record.state?.nextRefreshAllowedAt ?? null,
      lastRefreshError: normalizeError(record.state?.lastError ?? null)
    },
    concepts,
    edges: collapsedEdges(search, record.name, refFor2, options.prefixRefs)
  };
}
function inspectorConcept(concept, search, record, refFor2, includeSource) {
  const ref = refFor2(concept.id);
  const outbound = (search.graph.outbound.get(concept.id) ?? []).map(refFor2).sort();
  const backlinks = (search.graph.backlinks.get(concept.id) ?? []).map(refFor2).sort();
  return {
    id: concept.id,
    ref,
    path: concept.path,
    title: concept.title,
    type: concept.type,
    tags: [...concept.tags],
    description: concept.description,
    resource: concept.resource,
    resourceUrl: concept.resource,
    ...includeSource ? {
      sourceName: record.name,
      sourceKind: record.manifest.kind,
      seedUrl: record.manifest.source.seedUrl
    } : {},
    outbound,
    outboundLinks: [...outbound],
    backlinks,
    citation: {
      ref,
      conceptPath: concept.path,
      sourceResource: concept.resource,
      ...includeSource ? { sourceName: record.name } : {}
    }
  };
}
function collapsedEdges(search, sourceName, refFor2, includeSource) {
  const seen = /* @__PURE__ */ new Set();
  const edges = [];
  for (const concept of [...search.graph.concepts.values()].sort(
    (a, b) => a.id.localeCompare(b.id)
  )) {
    for (const target of search.graph.outbound.get(concept.id) ?? []) {
      const from = refFor2(concept.id);
      const to = refFor2(target);
      const key = [from, to].sort().join("\0");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        from,
        to,
        kind: "internal_link",
        label: "Markdown link",
        ...includeSource ? { sourceName } : {}
      });
    }
  }
  return edges.sort(
    (first, second) => (first.sourceName ?? "").localeCompare(second.sourceName ?? "") || first.from.localeCompare(second.from) || first.to.localeCompare(second.to)
  );
}
function sourceBase(record) {
  return {
    sourceName: record.name,
    name: record.name,
    label: record.name,
    kind: record.manifest.kind,
    seedUrl: record.manifest.source.seedUrl,
    bundleDir: record.bundleDir
  };
}
function unavailableSource(baseSource, error, state) {
  return {
    ...baseSource,
    availabilityStatus: "unavailable",
    validationStatus: "unavailable",
    conceptCount: state?.bundle?.conceptCount ?? 0,
    warningCount: state?.bundle?.warningCount ?? 0,
    brokenLinkCount: 0,
    orphanConcepts: [],
    freshnessStatus: state?.status ?? "failed",
    refreshInProgress: Boolean(state?.refreshInProgress),
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    lastRefreshError: normalizeError(error)
  };
}
function summarizeReadiness(sources) {
  const sourceCount = sources.length;
  const usableSourceCount = sources.filter(
    (source) => source.availabilityStatus === "available"
  ).length;
  const conceptCount = sum(sources, "conceptCount");
  const warningCount = sum(sources, "warningCount");
  const brokenLinkCount2 = sum(sources, "brokenLinkCount");
  const orphanConcepts = sources.flatMap((source) => source.orphanConcepts).sort();
  const freshnessStatuses = {};
  for (const source of sources) {
    if (source.freshnessStatus) {
      freshnessStatuses[source.freshnessStatus] = (freshnessStatuses[source.freshnessStatus] ?? 0) + 1;
    }
  }
  const failedSource = sources.find((source) => source.lastRefreshError);
  return {
    availabilityStatus: usableSourceCount > 0 ? "available" : "unavailable",
    validationStatus: sources.some((source) => source.validationStatus !== "valid") ? "invalid" : "valid",
    sourceCount,
    usableSourceCount,
    conceptCount,
    warningCount,
    brokenLinkCount: brokenLinkCount2,
    brokenLinks: brokenLinkCount2,
    orphanConcepts,
    refreshInProgress: sources.some((source) => source.refreshInProgress),
    freshnessStatus: aggregateFreshnessStatus(sources),
    freshnessStatuses: Object.fromEntries(
      Object.entries(freshnessStatuses).sort(([first], [second]) => first.localeCompare(second))
    ),
    lastSuccessfulRefreshAt: latest(
      sources.map((source) => source.lastSuccessfulRefreshAt).filter(isString)
    ),
    nextRefreshAllowedAt: earliest(
      sources.map((source) => source.nextRefreshAllowedAt).filter(isString)
    ),
    lastRefreshError: failedSource?.lastRefreshError ?? null,
    sources
  };
}
function aggregateFreshnessStatus(sources) {
  const statuses = new Set(sources.map((source) => source.freshnessStatus).filter(isString));
  for (const status of ["failed", "missing", "refreshing", "stale", "fresh"]) {
    if (statuses.has(status)) return status;
  }
  return void 0;
}
function agentPreview(sources, concepts) {
  const firstConcept = concepts[0];
  const firstSource = sources.find((source) => source.availabilityStatus === "available");
  const sourceHint = sources.length > 1 && firstSource ? `, "source": "${firstSource.name}"` : "";
  const readId = firstConcept?.id ?? "concept-id";
  const sequence = [
    {
      tool: "bundle_summary",
      name: "bundle_summary",
      purpose: "Start with validation, source freshness, and available concept counts.",
      example: "bundle_summary({})"
    },
    {
      tool: "search_concepts",
      name: "search_concepts",
      purpose: "Search for the docs concept that matches the task before reading.",
      example: `search_concepts({ "query": "setup"${sourceHint}, "limit": 5 })`
    },
    {
      tool: "read_concept",
      name: "read_concept",
      purpose: "Read only the selected concept and cite its source resource.",
      example: `read_concept({ "id": "${readId}"${sourceHint} })`
    },
    {
      tool: "get_neighbors",
      name: "get_neighbors",
      purpose: "Traverse outbound links and backlinks when adjacent docs matter.",
      example: `get_neighbors({ "id": "${readId}"${sourceHint}, "depth": 1 })`
    }
  ];
  return {
    sequence,
    tools: sequence.map((step) => ({ name: step.tool, purpose: step.purpose })),
    citationGuidance: sources.length > 1 ? "Use source filters when the library is known, then cite source_resource URLs from read_concept results." : "Cite source_resource URLs from read_concept results when available.",
    suggestedQuestions: suggestedQuestions(sources, concepts)
  };
}
function suggestedQuestions(sources, concepts) {
  const firstSource = sources.find((source) => source.availabilityStatus === "available");
  const firstConcept = concepts[0];
  const questions = [
    firstSource ? `In ${firstSource.name}, what should I read first to get started?` : "What concepts are available in this OKF bundle?",
    firstConcept ? `Read ${firstConcept.ref} and cite the source URL.` : "Search the OKF bundle and cite the most relevant source URL.",
    "What related concepts should I inspect next with get_neighbors?"
  ];
  return [...new Set(questions)];
}
function brokenLinkCount(issues) {
  return issues.filter((issue) => issue.code === "broken_internal_link").length;
}
function normalizeError(error) {
  if (!error) return null;
  if (error instanceof Error) {
    const details = { message: error.message };
    if ("code" in error && typeof error.code === "string") details.code = error.code;
    return details;
  }
  if (typeof error === "object") {
    const record = error;
    return {
      ...record,
      message: typeof record.message === "string" ? record.message : "Inspector source failed."
    };
  }
  return { message: String(error) };
}
function sum(sources, key) {
  return sources.reduce((total, source) => total + source[key], 0);
}
function latest(values) {
  return values.sort().at(-1) ?? null;
}
function earliest(values) {
  return values.sort()[0] ?? null;
}
function isString(value) {
  return typeof value === "string" && value.length > 0;
}

export {
  extractHeadings,
  extractMarkdownLinks,
  inferType,
  inferTags,
  normalizeDocument,
  descriptionFromMarkdown,
  assertSafeForceOutDir,
  writeOkfBundle,
  crawlWebsite,
  importLocal,
  HubSearch,
  hubImportsDir,
  hubAuditLogPath,
  appendHubAudit,
  importBundleIntoHub,
  importPathIntoHub,
  listHubImportedBundles,
  resolveHubSources,
  buildHubSearch,
  buildHubKnowledgeGraph,
  buildHubOverview,
  createHubMcpServer,
  serveHubMcpStdio,
  renderHubLlmsTxt,
  renderHubSitemap,
  hubMcpManifest,
  startHubHttpServer,
  renderHubDashboard,
  hashBundleContents,
  evaluateFreshness,
  refreshSource,
  parseDurationSeconds,
  buildActivationPacket,
  withActivationMetadata,
  renderActivationSetupMarkdown,
  writeActivationPacketFiles,
  protectedActivationInputPaths,
  buildBundleInspectorReport,
  buildWorkspaceInspectorReport
};
