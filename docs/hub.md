# OKFIT Hub

OKFIT Hub is a local, source-aware dashboard and JSON API over the docs sources you have already registered plus OKF bundles you import into the Hub. It lets you search, trace, export, and expose a full local knowledge surface without choosing one bundle at a time.

Hub is local-first. It reads and writes under `OKFIT_HOME`, defaults to `~/.okfit`, and runs on your machine. It is not a cloud service, not a managed service, and not account-based.

## What The Hub Does

Hub combines two kinds of sources:

- Registered website sources under `$OKFIT_HOME/sources`, created with commands such as `okfit add` or `okfit init`.
- Imported local OKF bundles or Markdown folders under `$OKFIT_HOME/hub/imports`, created with `okfit hub import`.

From those sources, Hub builds a source-qualified knowledge graph:

- Concept refs use `source:concept-id`, such as `stripe:reference/api`.
- Search results preserve source name, source kind, seed URL, resource path, tags, type, and score.
- Trace results show dependencies, dependents, creation paths, orphan status, and matching concept IDs across sources.
- Exports expose `graph.json`, `llms.txt`, `sitemap.xml`, and an MCP manifest for agent discovery.

Start the local dashboard and API:

```bash
npx -y okfit hub
```

`okfit dashboard` is an alias:

```bash
npx -y okfit dashboard
```

Print an overview without starting the server:

```bash
npx -y okfit hub --json
```

## When To Use Hub vs Serve

Use `okfit serve ... --mcp` when the agent should use one explicit source or one selected workspace:

```bash
npx -y okfit serve stripe --mcp --auto-refresh
npx -y okfit serve stripe clerk --mcp --auto-refresh
npx -y okfit serve ./docs-okf --mcp
```

Use Hub when the agent or user needs the full local source surface:

- Search across all registered sources and imported local bundles.
- Keep cross-source provenance visible.
- Trace a concept from `source:concept` to dependencies and dependents.
- Export a global graph for other local graph tools.
- Let MCP clients access the current Hub without listing sources in the config.

Hub does not replace `serve`. It is the global local view; `serve` is the narrower per-source or per-workspace MCP entry point.

## Importing Local Bundles

Import an existing OKF bundle into Hub:

```bash
npx -y okfit hub import ./docs-okf --name project-docs
```

If the path is not already a valid OKF bundle, Hub converts it with the local Markdown importer and stores the generated bundle under `OKFIT_HOME`:

```bash
npx -y okfit hub import ./docs --name project-docs
```

Use include/exclude filters for non-OKF local imports:

```bash
npx -y okfit hub import ./docs --name project-docs --include "**/*.md" --exclude "archive/**"
```

Use `--force` only when you intentionally want to replace an existing Hub import with the same name:

```bash
npx -y okfit hub import ./docs-okf --name project-docs --force
```

Import output includes the import mode, source name, concept count, and stored bundle path.

## Searching Across Sources

Search every Hub source:

```bash
npx -y okfit hub search "checkout sessions"
```

Filter by source, concept type, tag, or result count:

```bash
npx -y okfit hub search "checkout sessions" --source stripe --limit 5
npx -y okfit hub search "webhook" --type Guide --tag payments
```

Use JSON output when another tool should consume the results:

```bash
npx -y okfit hub search "checkout sessions" --json
```

Each result includes a source-qualified `ref`. Use that ref with trace or downstream tools.

## Tracing Concepts

Trace a source-qualified concept:

```bash
npx -y okfit hub trace stripe:reference/api
```

Trace an id-only concept when you also provide the source:

```bash
npx -y okfit hub trace reference/api --source stripe
```

Trace output includes:

- Title, source, type, and resource.
- Creation paths through linked concepts.
- Dependencies and dependents.
- Same concept IDs found in other sources.
- Orphan status when the concept has no local links.

JSON output is available for automation:

```bash
npx -y okfit hub trace stripe:reference/api --json
```

## JSON/API Endpoints

By default, `npx -y okfit hub` listens on `http://127.0.0.1:8765`. Use `--host` and `--port` to change that address.

```text
/
/api/overview
/api/search?q=...
/api/trace?ref=source:concept
/api/orphans
/graph.json
/llms.txt
/sitemap.xml
/mcp-manifest.json
/api/mcp
```

Additional useful endpoint:

```text
/api/sources
```

Endpoint guide:

| Endpoint | Purpose |
| --- | --- |
| `/` | Local dashboard with source summary, graph view, search controls, and trace explorer. |
| `/api/overview` | JSON overview with source counts, concept counts, validation, freshness, type distribution, and tag distribution. |
| `/api/search?q=...` | Source-aware search. Optional query params: `source`, `type`, `tag`, and `limit`. |
| `/api/trace?ref=source:concept` | Trace dependencies, dependents, creation paths, cross-source same-id matches, and orphan status. |
| `/api/orphans` | Concepts with no inbound or outbound links in the Hub graph. |
| `/api/sources` | Per-source availability, validation, freshness, bundle path, and import metadata. |
| `/graph.json` | Crawlable graph export with nodes and edges. |
| `/llms.txt` | Agent-readable entry points for overview, search, graph, orphans, and MCP manifest. |
| `/sitemap.xml` | Sitemap for the local Hub endpoints. |
| `/mcp-manifest.json` | Manifest describing Hub MCP entry points and exports. |
| `/api/mcp` | Deterministic JSON tool-call compatibility endpoint. Use `okfit hub mcp` for stdio MCP clients. |

## Hub MCP

Start the Hub MCP server over stdio:

```bash
npx -y okfit hub mcp
```

Use Hub MCP when an agent should see every readable registered source and every Hub import in the active `OKFIT_HOME`. Use `okfit serve ... --mcp` when the task should be scoped to one explicit source or workspace.

Codex example:

```toml
[mcp_servers.okfit_hub]
command = "npx"
args = ["-y", "okfit", "hub", "mcp"]
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
```

The source-aware MCP tools remain:

```text
bundle_summary
search_concepts
read_concept
get_neighbors
list_types
list_tags
```

Start with `bundle_summary`, search narrowly with `search_concepts`, read the best concepts, then use `get_neighbors` when links or backlinks matter. In multi-source results, pass `source` with `id` when the id could exist in more than one source.

Hub MCP tools are read-only. They expose the current local Hub surface; imports and source registration are CLI actions, not MCP tool writes.

## Crawlable Exports

Export the graph without starting the dashboard:

```bash
npx -y okfit hub export graph
```

Other exports:

```bash
npx -y okfit hub export overview
npx -y okfit hub export llms
npx -y okfit hub export sitemap
```

Use `--base-url` when the exported `llms.txt` or `sitemap.xml` should point at a specific local address:

```bash
npx -y okfit hub export sitemap --base-url http://127.0.0.1:8765
```

## Local-Only Storage

Hub uses the active `OKFIT_HOME`:

```text
$OKFIT_HOME/
  sources/
    <source>/
      source.json
      state.json
      bundle/
        index.md
  hub/
    imports/
      <name>/
        import.json
        bundle/
          index.md
    log.md
```

Default location:

```text
~/.okfit
```

Set a different local home for project isolation, tests, or CI:

```bash
OKFIT_HOME="$PWD/.okfit" npx -y okfit hub
OKFIT_HOME="$PWD/.okfit" npx -y okfit hub mcp
```

Registered sources keep their refresh state in `sources/<name>/state.json`. Hub imports are snapshots under `hub/imports/<name>` until you replace them with another import.

## Troubleshooting

### Hub starts but shows no sources

Check which `OKFIT_HOME` is active and list registered sources:

```bash
npx -y okfit sources
npx -y okfit hub --json
```

If you expected project-local data, run the command with the same `OKFIT_HOME` you used for import or registration.

### Import fails

If the input is meant to be an OKF bundle, validate it directly:

```bash
npx -y okfit validate ./docs-okf
```

If the input is a Markdown folder, make sure the output target is safe and the source name is unique. Add `--force` only when replacing an existing Hub import is intentional.

### Search results are stale

Registered website sources refresh through the source workflow, not through Hub import:

```bash
npx -y okfit check stripe
npx -y okfit update stripe
```

Imported bundles are snapshots. Re-run `okfit hub import <path> --name <name> --force` to replace a snapshot.

### Trace cannot find a concept

Use the source-qualified ref from search output:

```bash
npx -y okfit hub search "api reference" --json
npx -y okfit hub trace stripe:reference/api
```

If you only have an id, pass the source explicitly:

```bash
npx -y okfit hub trace reference/api --source stripe
```

### MCP client cannot see Hub tools

Use the stdio command in the MCP client config:

```bash
npx -y okfit hub mcp
```

Do not configure the dashboard URL as a stdio MCP command. The dashboard/API is HTTP for local browsing and JSON endpoints; `hub mcp` is the MCP subprocess entry point.
