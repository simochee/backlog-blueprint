import { buildPlan as buildCorePlan } from "@backlog-blueprint/core";

import { type BuildPlan } from "./ports";

export const buildPlan: BuildPlan = async (input) => {
  const { diagnostics, plan } = await buildCorePlan(input);

  if (plan === undefined) {
    return { diagnostics };
  }

  return {
    diagnostics,
    plan: {
      project: {
        key: plan.manifest.key,
        name: plan.manifest.name,
        exists: plan.snapshot.project.exists,
      },
      diagnostics,
      actions: plan.actions,
      resolutions: plan.resolutions,
      resultingOrder: plan.order,
    },
  };
};
