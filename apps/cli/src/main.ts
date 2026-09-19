import { createBacklogClient } from "@backlog-blueprint/backlog-client";

import { type Deps } from "./commands";
import { processIo } from "./io";
import { runCli } from "./program";

/**
 * 描画（`packages/core/src/output/`）と S5〜S7 を含む計画の組み立ては注入で受け取る。
 * CLI が持つのは「受け取り方と見せ方」だけで（CLI と Web UI の設計 §1 前文）、
 * 同じ描画と同じ計画を Web UI も使う（NFR-6）。
 */
export const main = (
  argv: string[],
  { output, buildPlan }: Pick<Deps, "buildPlan" | "output">,
): Promise<number> =>
  runCli(argv, { io: processIo(), output, buildPlan, createClient: createBacklogClient });
