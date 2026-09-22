#!/usr/bin/env node
import { createBacklogClient } from "@backlog-blueprint/backlog-client";
import { createExport } from "@backlog-blueprint/core";

import { processIo } from "./io";
import { createOutput } from "./output";
import { buildPlan } from "./plan";
import { runCli } from "./program";

/**
 * 描画（`packages/core/src/output/`）と S5〜S7 を含む計画の組み立ては core が持つ。
 * CLI が持つのは「受け取り方と見せ方」だけで（CLI と Web UI の設計 §1 前文）、
 * 同じ描画と同じ計画を Web UI も使う（NFR-6）。
 */
process.exitCode = await runCli(process.argv.slice(2), {
  io: processIo(),
  output: createOutput(),
  buildPlan,
  createExport,
  createClient: createBacklogClient,
});
