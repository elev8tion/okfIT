import os from "node:os";
import path from "node:path";

export interface OkfitHomeOptions {
  okfitHome?: string;
  env?: {
    OKFIT_HOME?: string;
  };
}

export function resolveOkfitHome(options: OkfitHomeOptions = {}): string {
  const configured = options.okfitHome ?? options.env?.OKFIT_HOME ?? process.env.OKFIT_HOME;
  if (configured && configured.trim() !== "") return path.resolve(configured);
  return path.join(os.homedir(), ".okfit");
}
