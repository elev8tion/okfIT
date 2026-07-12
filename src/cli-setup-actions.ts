import path from "node:path";
import pc from "picocolors";
import {
  buildActivationPacket,
  renderActivationSetupMarkdown,
  withActivationMetadata,
  writeActivationPacketFiles
} from "./activation.js";
import {
  activationInputForResolution,
  inspectorReportForResolution,
  resolveCliTargets
} from "./cli-targets.js";
import {
  printCrawlProgress,
  printJson,
  printSetupReport
} from "./cli-presenters.js";
import { renderInspectorHtml } from "./inspector-html.js";
import {
  registeredRecord,
  registerWebsiteSource
} from "./source-lifecycle.js";
import {
  resolveBundleDir,
  resolveOkfitHome,
  validateSourceName
} from "./source-store.js";
import { importPathIntoHub } from "./hub.js";
import {
  setupReportForRecord
} from "./setup-diagnostics.js";

export async function runSetupCommand(
  target: string,
  options: any,
  cliPath: string
): Promise<void> {
  const name = options.name;
  if (!name) {
    console.error(pc.red("Error: --name is required for setup."));
    process.exitCode = 1;
    return;
  }
  try {
    validateSourceName(name);
  } catch (e: any) {
    console.error(pc.red(e.message));
    process.exitCode = 1;
    return;
  }

  const isUrl = /^https?:\/\//i.test(target);
  const json = !!options.json;
  const force = !!options.force;
  const client = options.client ?? "generic";
  const outDir = options.out ?? "okfit-activation";
  const probe = options.probe !== false;

  try {
    let record: any;
    let bundleDir: string;

    if (isUrl) {
      // 1. Register + crawl
      console.log(pc.cyan("1/4"), "Registering and crawling website source...");
      const { manifest, result } = await registerWebsiteSource(name, target, options, {
        onProgress: printCrawlProgress
      });
      if (result.status !== "fresh") {
        console.error(pc.red(`Crawl did not complete successfully: ${result.status}`));
        process.exitCode = 1;
        return;
      }
      bundleDir = resolveBundleDir(manifest);
      record = await registeredRecord(name);
    } else {
      // Local path: direct import
      console.log(pc.cyan("1/4"), "Importing local path into hub...");
      const res = await importPathIntoHub(target, {
        name,
        force,
        include: options.include,
        exclude: options.exclude
      });
      bundleDir = res.record.bundleDir;
      record = res.record;
    }

    // 2. Activation packet
    console.log(pc.cyan("2/4"), "Building activation packet...");
    const resolution = await resolveCliTargets([name], { all: false });
    const report = await inspectorReportForResolution(resolution);
    const activationInput = activationInputForResolution(resolution);
    const packet = await buildActivationPacket({
      ...activationInput,
      report,
      client,
      outDir,
      proofTask: options.task,
      okfitHome: resolveOkfitHome()
    });
    const reportWithMeta = withActivationMetadata(report, packet);
    await writeActivationPacketFiles(
      packet,
      {
        inspectorHtml: renderInspectorHtml(reportWithMeta),
        setupMarkdown: renderActivationSetupMarkdown(packet)
      },
      { force, protectedInputPaths: activationInput.protectedInputPaths }
    );

    // 3. Import to hub (for URL path it is already done; for local it was done above)
    if (isUrl) {
      console.log(pc.cyan("3/4"), "Importing bundle into hub...");
      await importPathIntoHub(bundleDir, { name, force });
    } else {
      console.log(pc.cyan("3/4"), "Local import complete.");
    }

    // 4. Optional MCP probe
    let setupReport: any = null;
    if (probe) {
      console.log(pc.cyan("4/4"), "Verifying MCP endpoint...");
      setupReport = await setupReportForRecord({
        record,
        client,
        maxAge: options.maxAge,
        probeTimeoutSeconds: options.probeTimeout ?? 5,
        cliPath
      });
    } else {
      console.log(pc.cyan("4/4"), "Skipping MCP probe (--no-probe).");
    }

    const payload = {
      status: "ready",
      name,
      bundleDir,
      activationDir: packet.outDir,
      command: packet.setup.command,
      firstPrompt: packet.setup.firstPrompt,
      setupReport: setupReport ? setupReport : undefined
    };

    if (json) {
      printJson(payload);
    } else {
      console.log(pc.green(`\n✓ agents can now use '${name}'`));
      console.log(`Bundle: ${bundleDir}`);
      console.log(`Activation: ${packet.outDir}`);
      if (packet.setup.command) {
        console.log("\nMCP launch command:");
        console.log(`  ${packet.setup.command.display}`);
      }
      if (packet.setup.firstPrompt) {
        console.log("\nFirst prompt:");
        console.log(packet.setup.firstPrompt);
      }
      console.log("\nNext:");
      console.log(`  okfit hub`);
      console.log(`  okfit serve ${name} --mcp`);
    }

    if (setupReport && setupReport.status === "failed") {
      process.exitCode = 1;
    }
  } catch (error: any) {
    if (json) {
      printJson({ status: "failed", error: { message: error?.message ?? "Setup failed." } });
    } else {
      console.error(pc.red(error?.message ?? "Setup failed."));
    }
    process.exitCode = 1;
  }
}
