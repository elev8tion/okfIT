# MCP Client Setup

okfit is meant to be launched by your agent as a local stdio MCP server. The default setup uses `npx -y okfit`, so Claude, Codex, Cursor, or another MCP client can run okfit without a global install:

```bash
npx -y okfit init stripe https://docs.stripe.com/checkout --client generic --max-pages 100 --max-depth 4
```

The generated launch command will use `npx -y okfit serve stripe --mcp --auto-refresh`.

MCP stdio means the client starts okfit as a local subprocess, sends JSON-RPC on stdin, and reads JSON-RPC responses on stdout. okfit logs and refresh progress belong on stderr so the MCP protocol stays clean.

## Registered Source Workflow

Use registered sources for third-party docs sites that should stay fresh over time:

```bash
npx -y okfit add stripe https://docs.stripe.com/checkout --max-pages 100 --max-depth 4
npx -y okfit sources
npx -y okfit check stripe
npx -y okfit doctor stripe
npx -y okfit update stripe
npx -y okfit remove stripe --yes
npx -y okfit serve stripe --mcp --auto-refresh
```

If you want registration plus client-specific setup artifacts, use `npx -y okfit init stripe https://docs.stripe.com/checkout --client generic --max-pages 100 --max-depth 4`.

By default, okfit stores sources in `~/.okfit`. Override that with `OKFIT_HOME` when you want CI isolation, a project-local cache, or a disposable test home:

```text
$OKFIT_HOME/
  sources/
    stripe/
      source.json
      state.json
      bundle/
        index.md
        ...
```

`source.json` stores the seed URL, crawl options, refresh policy, and bundle location. `state.json` stores freshness status, last successful refresh time, validation summary, refresh-in-progress state, and the latest refresh error if one exists.

This is local-first. There is no OKFIT cloud registry, account, central cache, hosted ranking, or cloud refresh worker. Refreshes run on your machine by rerunning the stored crawl configuration.

`init` is the setup shortcut over the registered-source workflow. It creates the source, validates the bundle, and prints client-specific config plus a first prompt without writing client config files by default.

`doctor` re-runs setup checks later. It verifies source existence, bundle validity, freshness, `npx` availability, generated command shape, MCP tool visibility, and JSON-RPC-clean stdout. Use it when the client cannot start okfit, the agent cannot see tools, or answers look stale:

```bash
npx -y okfit doctor stripe --client codex
```

## Activation Packet

Use activation when you want a reviewable setup packet before pasting config into an MCP client:

```bash
npx -y okfit activate stripe --client codex --out okfit-activation
```

The packet includes:

- `okfit-inspector.html` with readiness, relationships, setup command, and first prompt.
- `okfit-setup.md` with client-specific config snippets and the exact MCP launch command.
- `okfit-proof.json` with a deterministic `bundle_summary`, `search_concepts`, `read_concept`, and `get_neighbors` proof over the selected docs.

Add `--task "checkout sessions"` when you want the proof transcript to search and read against the task you plan to ask the agent:

```bash
npx -y okfit activate stripe --client codex --task "checkout sessions" --out okfit-activation
```

For local bundle snapshots:

```bash
npx -y okfit activate ./docs-okf --client codex --out okfit-activation
```

For multi-source workspaces:

```bash
npx -y okfit activate stripe clerk --client codex --out stack-activation
```

Activation does not write client files. It produces copyable config and proof artifacts that you can review, commit, or send to a teammate.

## Inspector Confidence Check

When you only need the visual preview without setup/proof files, use the Inspector directly:

```bash
npx -y okfit map stripe --out okfit-inspector.html
```

The Inspector is a local static HTML file you can open from disk. It shows readiness, validation warnings, source freshness, concept relationships, citation URLs, and the MCP path an agent should follow: `bundle_summary`, `search_concepts`, `read_concept`, then `get_neighbors` when relationship context matters.

For a workspace, pass the same registered source names you use with `serve`:

```bash
npx -y okfit map stripe clerk --out stack-inspector.html
```

For a local OKF bundle, pass the bundle path:

```bash
npx -y okfit map ./docs-okf --out okfit-inspector.html
```

Use `--json` when you need the Inspector report model on stdout without writing the HTML file.

## Multi-Source Workspaces

Use a workspace server when one coding session needs several docs sources. Register sources separately, then serve them through one source-aware MCP server:

```bash
npx -y okfit add stripe https://docs.stripe.com/checkout --max-pages 100 --max-depth 4
npx -y okfit add clerk https://clerk.com/docs --max-pages 100 --max-depth 4
npx -y okfit doctor stripe clerk --client codex
npx -y okfit serve stripe clerk --mcp --auto-refresh
```

For project-local docs, import each Markdown folder into its own OKF bundle and serve the bundle paths together:

```bash
npx -y okfit import ./docs/api --out ./okf/api-docs --source-name "API docs" --force
npx -y okfit import ./docs/product --out ./okf/product-docs --source-name "Product docs" --force
npx -y okfit serve ./okf/api-docs ./okf/product-docs --mcp
```

In local bundle workspaces, source filters use the bundle directory names, such as `api-docs` and `product-docs`.

Registered-source workspace config for JSON-based clients:

```json
{
  "mcpServers": {
    "stripe-clerk-okf": {
      "command": "npx",
      "args": ["-y", "okfit", "serve", "stripe", "clerk", "--mcp", "--auto-refresh"]
    }
  }
}
```

Registered-source workspace config for Codex:

```toml
[mcp_servers.stripe_clerk_okf]
command = "npx"
args = ["-y", "okfit", "serve", "stripe", "clerk", "--mcp", "--auto-refresh"]
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
```

Use `--all` only when every readable registered source in the active `OKFIT_HOME` should be exposed:

```bash
npx -y okfit serve --all --mcp --auto-refresh
```

Workspace mode keeps the same read-only tools. Tool inputs can include `source` for filtering:

```text
bundle_summary
search_concepts({ "query": "checkout sessions", "source": "stripe", "limit": 5 })
read_concept({ "source": "stripe", "id": "guides/quickstart", "max_chars": 6000 })
get_neighbors({ "source": "stripe", "id": "guides/quickstart", "depth": 1 })
```

`bundle_summary` returns workspace totals plus one per-source summary with validation, freshness, refresh progress, and refresh errors. `search_concepts` returns source-aware rows with `sourceName`, `seedUrl`, `ref`, `resource`, `snippet`, and `score`. If an id exists in multiple sources, `read_concept({ "id": "..." })` returns `ambiguous_concept`; pass `{ "source": "...", "id": "..." }` to disambiguate.

Default refresh mode is `stale-while-refresh`: if the cached bundle is stale, MCP tools keep serving the current bundle while okfit refreshes in the background. Use blocking mode when you want stale sources refreshed before search/read/list tool calls answer:

```bash
npx -y okfit serve stripe --mcp --auto-refresh --refresh-mode blocking
```

Use `--refresh-mode off` when MCP serving should never trigger network fetches. You can still refresh explicitly with `npx -y okfit update stripe`.

## Hub MCP

Use `okfit serve ... --mcp` when an agent should use one explicit source, one local bundle, or one selected workspace. Use `okfit hub mcp` when the agent should access the full local Hub surface across every readable registered source and Hub import in the active `OKFIT_HOME`.

Start the Hub MCP server over stdio:

```bash
npx -y okfit hub mcp
```

Codex config example:

```toml
[mcp_servers.okfit_hub]
command = "npx"
args = ["-y", "okfit", "hub", "mcp"]
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
```

For JSON-based clients, the same command shape is:

```json
{
  "mcpServers": {
    "okfit-hub": {
      "command": "npx",
      "args": ["-y", "okfit", "hub", "mcp"]
    }
  }
}
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

Start with `bundle_summary` to see available sources and totals, call `search_concepts` with the task terms, then pass both `source` and `id` to `read_concept` when a concept id could exist in multiple sources. Use `get_neighbors` for links, backlinks, prerequisites, and nearby API/reference pages.

Hub MCP is read-only. Use CLI commands such as `npx -y okfit hub import ./docs-okf --name project-docs` or `npx -y okfit add stripe https://docs.stripe.com/checkout` to change the local Hub surface before launching the MCP server.

Full Hub guide: [docs/hub.md](hub.md).

## Existing Bundle Paths

The existing crawl/import workflow still works for one-off snapshots and project-local bundles:

```bash
npx -y okfit crawl https://docs.stripe.com/checkout --out ./stripe-checkout-okf --max-pages 25
npx -y okfit validate ./stripe-checkout-okf
npx -y okfit serve ./stripe-checkout-okf --mcp
```

Local Markdown import still works too:

```bash
npx -y okfit import ./docs --out ./docs-okf --source-name "Project docs" --force
npx -y okfit validate ./docs-okf
npx -y okfit serve ./docs-okf --mcp
```

Direct bundle paths, including local bundle workspaces, do not use source auto-refresh. Use `add` plus `serve <source> --mcp --auto-refresh` when you want okfit to track freshness for a website source.

## Claude Code

Add a registered source as a local stdio server:

```bash
npx -y okfit init stripe https://docs.stripe.com/checkout --client claude-code
claude mcp add --transport stdio stripe-okf -- npx -y okfit serve stripe --mcp --auto-refresh
claude mcp list
```

Open Claude Code and check status:

```text
/mcp
```

Project-scoped config, saved as `.mcp.json` at project root:

```json
{
  "mcpServers": {
    "stripe-okf": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "okfit", "serve", "stripe", "--mcp", "--auto-refresh"]
    }
  }
}
```

Use `OKFIT_HOME` in the server env when the source cache is not in the default `~/.okfit`:

```json
{
  "mcpServers": {
    "stripe-okf": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "okfit", "serve", "stripe", "--mcp", "--auto-refresh"],
      "env": {
        "OKFIT_HOME": "/absolute/path/to/.okfit"
      }
    }
  }
}
```

Example prompt:

```text
Use the stripe-okf MCP server. Search for Checkout Sessions, read the most relevant concepts, inspect neighbors if needed, and explain the minimum backend flow with source URLs.
```

Expected tool-call sequence:

```text
ToolSearch or MCP server discovery
bundle_summary
search_concepts({ "query": "Checkout Sessions", "limit": 5 })
read_concept({ "id": "<best-result-id>" })
get_neighbors({ "id": "<best-result-id>", "depth": 1 })
final answer citing source_resource from read_concept output
```

Troubleshooting:

- Run `npx -y okfit doctor stripe --client claude-code` for a setup report.
- `spawn npx ENOENT`: install Node.js >=20 and ensure `npx` is on `PATH`.
- Server pending: run `/mcp`; approve project-scoped `.mcp.json` if prompted.
- Unknown source name: run `npx -y okfit sources` and confirm the source exists in the same `OKFIT_HOME`.
- Stale source: run `npx -y okfit check stripe`; use `update stripe` for an immediate refresh.
- Output too large: lower `--max-result-chars`, or ask the agent to search before reading concepts.
- Already installed globally: use `"command": "okfit"` and args `["serve", "stripe", "--mcp", "--auto-refresh"]`.

## Claude Desktop Or Cursor

Claude Desktop and Cursor use MCP server JSON. Add this entry to `claude_desktop_config.json`, `.cursor/mcp.json`, or any client that accepts `mcpServers` JSON:

```bash
npx -y okfit init stripe https://docs.stripe.com/checkout --client cursor
```

```json
{
  "mcpServers": {
    "stripe-okf": {
      "command": "npx",
      "args": ["-y", "okfit", "serve", "stripe", "--mcp", "--auto-refresh"]
    }
  }
}
```

Exact command represented by the config:

```bash
npx -y okfit serve stripe --mcp --auto-refresh
```

Blocking refresh variant:

```json
{
  "mcpServers": {
    "stripe-okf": {
      "command": "npx",
      "args": [
        "-y",
        "okfit",
        "serve",
        "stripe",
        "--mcp",
        "--auto-refresh",
        "--refresh-mode",
        "blocking"
      ]
    }
  }
}
```

Restart the client after editing config.

Example prompt:

```text
Use stripe-okf. Find concepts about MCP tools, read the relevant concept, then tell me which source URL supports the answer.
```

Troubleshooting:

- Run `npx -y okfit doctor stripe --client cursor` for a setup report.
- Desktop cannot find `npx`: replace `"command": "npx"` with the full path from `which npx`.
- Server exits immediately: run the exact command in a terminal and fix source or bundle validation errors.
- No okfit tools visible: restart the client after config changes.
- Source cache elsewhere: add `"env": { "OKFIT_HOME": "/absolute/path/to/.okfit" }`.
- Already installed globally: use `"command": "okfit"` and args `["serve", "stripe", "--mcp", "--auto-refresh"]`.

## Codex

Codex supports stdio MCP servers through `config.toml`.

User config path:

```text
~/.codex/config.toml
```

Trusted project config path:

```text
.codex/config.toml
```

Add:

```bash
npx -y okfit init stripe https://docs.stripe.com/checkout --client codex
```

```toml
[mcp_servers.stripe_okf]
command = "npx"
args = ["-y", "okfit", "serve", "stripe", "--mcp", "--auto-refresh"]
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
```

If you need a non-default source cache:

```toml
[mcp_servers.stripe_okf]
command = "npx"
args = ["-y", "okfit", "serve", "stripe", "--mcp", "--auto-refresh"]
env = { OKFIT_HOME = "/absolute/path/to/.okfit" }
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
```

Exact command represented by the config:

```bash
npx -y okfit serve stripe --mcp --auto-refresh
```

CLI alternative:

```bash
codex mcp add stripe_okf -- npx -y okfit serve stripe --mcp --auto-refresh
codex mcp --help
```

In Codex TUI, inspect active servers:

```text
/mcp
```

Example prompt:

```text
Use the stripe_okf MCP server. Search for the concept about progressive disclosure, read it, then explain how okfit keeps agent context small.
```

Expected tool-call sequence:

```text
MCP server initialization
bundle_summary
search_concepts({ "query": "progressive disclosure agent context" })
read_concept({ "id": "<best-result-id>", "max_chars": 6000 })
get_neighbors({ "id": "<best-result-id>", "depth": 1 })
final answer with citations
```

Troubleshooting:

- Run `npx -y okfit doctor stripe --client codex` for a setup report.
- Config ignored: project `.codex/config.toml` loads only for trusted projects; use user config if unsure.
- Server startup timeout: increase `startup_timeout_sec` if first `npx` install or first source load is slow.
- Tool timeout: increase `tool_timeout_sec` for large bundles or blocking refresh mode.
- Source not found: check `OKFIT_HOME` and run `npx -y okfit sources`.
- Need current server list: run `/mcp` in TUI.
- Already installed globally: use `command = "okfit"` and `args = ["serve", "stripe", "--mcp", "--auto-refresh"]`.

## Generic MCP Stdio

Use this JSON for clients that accept Claude-style `mcpServers` config:

```bash
npx -y okfit init stripe https://docs.stripe.com/checkout --client generic
```

```json
{
  "mcpServers": {
    "stripe-okf": {
      "command": "npx",
      "args": ["-y", "okfit", "serve", "stripe", "--mcp", "--auto-refresh"],
      "env": {}
    }
  }
}
```

Exact command:

```bash
npx -y okfit serve stripe --mcp --auto-refresh
```

For a direct bundle path instead of a registered source:

```json
{
  "mcpServers": {
    "docs-okf": {
      "command": "npx",
      "args": ["-y", "okfit", "serve", "./docs-okf", "--mcp"],
      "env": {}
    }
  }
}
```

Expected protocol flow:

```text
client starts subprocess
client sends initialize
server returns capabilities and instructions
client sends initialized
client calls tools/list
agent calls bundle_summary
agent calls search_concepts
agent calls read_concept
agent optionally calls get_neighbors
agent answers with source_resource citations
```

Example prompt:

```text
Use stripe-okf. Search for OKF bundle structure, read the most relevant concepts, and explain the generated files.
```

Troubleshooting:

- Run `npx -y okfit doctor stripe --client generic` for a setup report.
- stdout has logs: okfit must write only MCP JSON-RPC messages to stdout; logs belong on stderr.
- Client cannot start process: use absolute `command` path, and set `OKFIT_HOME` when using a non-default source cache.
- `tools/list` empty: confirm `okfit serve` was started with `--mcp`.
- Search returns weak matches: run `npx -y okfit inspect <bundle>` for bundle paths or `npx -y okfit check <source>` for registered sources.
- Agent reads too much: ask it to call `search_concepts` first and `read_concept` with `max_chars`.
- Already installed globally: use `"command": "okfit"` and args `["serve", "stripe", "--mcp", "--auto-refresh"]`.

## Available okfit MCP Tools

```text
search_concepts(query, source?, type?, tags?, limit?)
read_concept(id, source?, max_chars?)
get_neighbors(id, source?, depth?)
list_types(source?)
list_tags(source?)
bundle_summary(source?)
```

Recommended answering pattern:

```text
1. Start with bundle_summary for scope, validation, and freshness metadata.
2. Use search_concepts for discovery.
3. Read only top matching concepts.
4. Use get_neighbors when relationship context matters.
5. Cite source_resource from read_concept output.
```
