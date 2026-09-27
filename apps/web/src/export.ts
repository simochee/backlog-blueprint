import {
  createExport,
  hasError,
  type Diagnostic,
  type ProjectExport,
  type ReadContext,
} from "@backlog-blueprint/core";

import { TOOL } from "./plan";

export type ExportAttempt = {
  diagnostics: Diagnostic[];
  failure?: unknown;
  exported?: ProjectExport;
};

/** 止まったときに途中までの Yaml を渡さない。半端なマニフェストがエディタに入る（WU-30 / EX-17） */
export const prepareExport = async (
  projectKey: string,
  get: ReadContext["get"],
): Promise<ExportAttempt> => {
  const { diagnostics, exported } = await createExport({
    projectKey: projectKey.trim(),
    get,
    version: TOOL.version,
  });

  return exported === undefined || hasError(diagnostics)
    ? { diagnostics }
    : { diagnostics, exported };
};
