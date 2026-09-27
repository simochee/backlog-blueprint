#!/usr/bin/env node
import { createBacklogClient } from "@backlog-blueprint/backlog-client";
import { createExport } from "@backlog-blueprint/core";

import { processIo } from "./io";
import { createOutput } from "./output";
import { buildPlan } from "./plan";
import { runCli } from "./program";

process.exitCode = await runCli(process.argv.slice(2), {
  io: processIo(),
  output: createOutput(),
  buildPlan,
  createExport,
  createClient: createBacklogClient,
});
