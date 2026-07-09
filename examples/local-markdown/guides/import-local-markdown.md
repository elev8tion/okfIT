# Import Local Markdown

Use `okfit import` when docs already live in a local project checkout, wiki export, Obsidian vault, or static-site source folder.

```bash
okfit import ./examples/local-markdown --out ./tmp/okfit-docs --force
okfit validate ./tmp/okfit-docs
```

Expected result:

```text
Concepts: 6
Validation: valid
Broken links: 0
```

The importer preserves headings, code blocks, and Markdown links. It infers tags from paths and headings, then writes one OKF concept per input file.

Next: [Serve Over MCP](serve-over-mcp.md).
