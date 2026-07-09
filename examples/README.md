# Examples

## Activate And Preview

Preview what your agent will know and generate setup, proof, and Inspector output in one folder:

```bash
npx -y okfit activate stripe --client codex --out okfit-activation
npx -y okfit activate examples/bundles/okfit-docs --client codex --out okfit-activation
```

The activation packet includes `okfit-inspector.html`, `okfit-setup.md`, and `okfit-proof.json`.

Preview only the Inspector when you do not need the setup/proof packet:

```bash
npx -y okfit map stripe --out okfit-inspector.html
npx -y okfit map examples/bundles/okfit-docs --out okfit-inspector.html
```

The Inspector is local static HTML for checking readiness, source freshness, citation URLs, concept relationships, and the MCP sequence before asking an agent to use the bundle.

## bundles/okfit-docs

Purpose: committed offline OKF bundle used by `okfit demo`.

Source command:

```bash
npx -y okfit import examples/local-markdown --out /tmp/okfit-docs --source-name "okfit docs" --force --stable-timestamps
npx -y okfit validate /tmp/okfit-docs
```

Expected concept count:

```text
6
```

Expected validation status:

```text
valid
```

Suggested agent questions:

- Search for crawler security defaults, read the relevant concepts, and cite the source resource.
- Read the MCP setup concept and explain the stdio config.
- Find importer concepts and list supported input formats.

## bundles/stripe-checkout-small

Purpose: small curated Stripe Checkout sample for launch demos when live crawling is flaky. The generated OKF bundle is committed so package users can inspect it without the repo-only source fixture.

Try it:

```bash
npx -y okfit validate examples/bundles/stripe-checkout-small
npx -y okfit activate examples/bundles/stripe-checkout-small --client codex --out stripe-activation
npx -y okfit map examples/bundles/stripe-checkout-small --out stripe-inspector.html
```

Expected concept count:

```text
4
```

Expected validation status:

```text
valid
```

Suggested agent questions:

- Search for Checkout Sessions, read the strongest match, and explain required server parameters.
- Find webhook-related concepts and summarize fulfillment safety notes.
- Use neighbors to move from the quickstart to the API reference and webhook concepts.

## local-markdown

Purpose: deterministic offline input for `okfit import`.

Source command:

```bash
okfit import ./examples/local-markdown --out ./tmp/okfit-docs --force --stable-timestamps
```

Expected concept count:

```text
6
```

Expected validation status:

```text
valid
```

Validate:

```bash
okfit validate ./tmp/okfit-docs
okfit inspect ./tmp/okfit-docs
okfit activate ./tmp/okfit-docs --client codex --out okfit-activation
okfit map ./tmp/okfit-docs --out okfit-inspector.html
```

Serve through MCP:

```bash
okfit serve ./tmp/okfit-docs --mcp
```

Suggested agent questions:

- Search for import workflow concepts, read the best match, and explain how to convert a local Markdown folder into OKF.
- Find concepts tagged `mcp`, read the MCP tools concept, and describe the expected tool-call sequence.
- Read the bundle summary, then identify which concepts are most useful for a first-time okfit user.
