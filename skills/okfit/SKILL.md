---
name: okfit
description: Use when a user wants an agent to use docs through okfIT, set up or verify an okfIT MCP docs source, convert docs websites or local Markdown into OKF bundles, operate the local OKFIT Hub, generate activation proof, or answer from an existing okfIT bundle/workspace.
---

# okfIT

## Overview

Use okfIT to turn documentation websites or local Markdown folders into local Open Knowledge Format bundles, then expose them to agents through a read-only MCP server. Use the local OKFIT Hub when the user wants a local dashboard, cross-source memory, global search, graph export, or traceability across imported and registered sources. Prefer `npx -y okfit` in generated commands so clients can launch the published package without a global install.

## Quick Reference

| Goal                                 | Command or action                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Register a docs site and print setup | `npx -y okfit init <name> <url> --client codex --max-pages 100 --max-depth 4`                 |
| Import local Markdown                | `npx -y okfit import ./docs --out ./docs-okf --source-name "Project docs"`                    |
| Prove a source for a task            | `npx -y okfit activate <name-or-bundle> --client codex --task "<task>" --out okfit-activation` |
| Preview readiness and graph          | `npx -y okfit map <name-or-bundle> --out okfit-inspector.html`                                 |
| Diagnose setup                       | `npx -y okfit doctor <name> --client codex`                                                   |
| Serve one source/workspace to MCP    | `npx -y okfit serve <name-or-bundle> --mcp --auto-refresh`                                    |
| Open local Hub dashboard/API         | `npx -y okfit hub`                                                                             |
| Import a bundle into Hub             | `npx -y okfit hub import <path> --name <name>`                                                |
| Search the full local Hub            | `npx -y okfit hub search "<query>"`                                                          |
| Trace a Hub concept                  | `npx -y okfit hub trace <source:concept>`                                                     |
| Serve full local Hub to MCP          | `npx -y okfit hub mcp`                                                                         |

## Setup Workflow

1. Choose a short source name such as `stripe`, `clerk`, or `project-docs`.
2. For a docs website, run `npx -y okfit init <name> <url> --client codex --max-pages 100 --max-depth 4`.
3. For local Markdown, run `import`, then `validate`, then serve the generated bundle path. Only add `--force` after the user explicitly approves overwriting the output directory.
4. When the user wants proof before config changes, run `activate` with `--task` matching their real question. The packet includes `okfit-inspector.html`, `okfit-setup.md`, and `okfit-proof.json`.
5. If setup fails or the MCP client cannot see tools, run `doctor` before editing client config by hand.

## Hub Workflow

Use Hub when the task needs the full local source surface instead of one explicit source or workspace:

```bash
npx -y okfit hub
npx -y okfit hub import <path> --name <name>
npx -y okfit hub search "<query>"
npx -y okfit hub trace <source:concept>
npx -y okfit hub mcp
```

Hub reads registered sources from the active local `OKFIT_HOME` and stores imports under `$OKFIT_HOME/hub/imports`. It is local-first: not a cloud service, not a managed service, and not account-based.

Choose Hub for a local dashboard, cross-source memory, global search, graph export, or traceability across imported/registered sources. Choose normal `serve` when the task needs one explicit source, one local bundle, or one selected workspace.

## MCP Use

When an okfIT MCP server is available, use the tools in this order:

1. `bundle_summary` to inspect validation status, freshness, available sources, and tool expectations.
2. `search_concepts` with the user's task terms. Use `source` filters in multi-source workspaces when the relevant docs source is known.
3. `read_concept` for the most relevant concepts, keeping reads small before expanding.
4. `get_neighbors` when the answer depends on linked concepts, backlinks, prerequisites, or nearby API/reference pages.
5. Cite the source URLs or resource fields surfaced by the concept results.

Start with narrow searches, then broaden only when results are thin. In workspaces and Hub MCP, pass both `source` and `id` to `read_concept` when concept ids are ambiguous.

## Workspaces

Serve multiple registered sources through one MCP server when a task spans a stack:

```bash
npx -y okfit serve stripe clerk --mcp --auto-refresh
```

Then filter searches:

```json
{ "query": "checkout sessions", "source": "stripe", "limit": 5 }
```

Use `source` filters whenever the user names the product, API, framework, or docs source. If the user asks across the stack, search the workspace without a filter first, then use per-source reads for precision.

## Safety Rules

- MCP tools are read-only. Auto-refresh and Hub indexing are server-side/local maintenance for registered sources and imports, not agent-callable write tools.
- Do not use `npx okfit`; use `npx -y okfit` for no-install commands.
- Do not run `serve --mcp` as a normal chatty terminal session. MCP clients launch it as a stdio subprocess.
- Do not bypass crawler safety defaults, private-network protections, or unsafe `--force` guards unless the user explicitly accepts the risk.
- Do not hand-edit client config first when `init`, `activate`, or `doctor` can produce or verify the exact command/config.

## Common Mistakes

| Mistake                            | Fix                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| Treating okfIT like a hosted index  | Keep the workflow local: bundle files, Hub imports, MCP stdio, and source URLs remain inspectable. |
| Reading every concept after search | Read the top matches first, then use neighbors to expand only where needed.           |
| Ignoring workspace source names    | Use `source` filters and source-qualified reads for multi-source bundles.             |
| Skipping proof                     | Use `activate --task` when the user needs confidence before wiring MCP.               |
| Debugging config blindly           | Run `doctor <name> --client codex` and follow its next repair command.                |
