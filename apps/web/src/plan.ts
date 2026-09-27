import {
  buildPlan,
  orderDiagnostics,
  type Diagnostic,
  type Manifest,
  type Plan,
  type PlanReport,
  type ReadContext,
} from "@backlog-blueprint/core";

import toolPackage from "../../cli/package.json";

/** web 自身の package.json を名乗らない。private で版を持たず、npm に出る版と揃わない（D-2） */
export const TOOL = { name: toolPackage.name, version: toolPackage.version };

export const PASTED = "(pasted)";

export type PreparedPlan = { plan: Plan; report: PlanReport };

export type PlanAttempt = { diagnostics: Diagnostic[]; failure?: unknown; prepared?: PreparedPlan };

type PreparePlanInput = {
  manifest: Manifest;
  get: ReadContext["get"];
  space: string;
  source: string;
  staticDiagnostics: Diagnostic[];
};

/** エディタで出た診断を捨てない。警告がそこで消えると計画の `Warnings:` から落ちる */
export const preparePlan = async ({
  manifest,
  get,
  space,
  source,
  staticDiagnostics,
}: PreparePlanInput): Promise<PlanAttempt> => {
  const built = await buildPlan({ manifest, get });
  const diagnostics = orderDiagnostics([...staticDiagnostics, ...built.diagnostics]);

  if (built.plan === undefined) {
    return { diagnostics };
  }

  const { plan } = built;

  return {
    diagnostics,
    prepared: {
      plan,
      report: {
        tool: TOOL,
        space,
        manifest: { path: source },
        project: {
          key: plan.manifest.key,
          name: plan.manifest.name,
          exists: plan.snapshot.project.exists,
        },
        diagnostics,
        actions: plan.actions,
        resultingOrder: plan.order,
      },
    },
  };
};

export const projectUrl = (space: string, projectKey: string): string =>
  `https://${space}/projects/${projectKey}`;
