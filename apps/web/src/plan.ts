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

/**
 * Web UI と CLI は同じツールの別の配り方で、版も揃えて出す（要件定義 §7.1 / D-2）。
 * `@backlog-blueprint/web` は private で版を持たないので、出力が名乗るのは npm に出る側の
 * 名前と版にする。
 */
export const TOOL = { name: toolPackage.name, version: toolPackage.version };

/** 貼り付けられたテキストにはファイル名が無い。ドラッグ&ドロップで読んだときだけ名前がある */
export const PASTED = "(pasted)";

export type PreparedPlan = { plan: Plan; report: PlanReport };

export type PlanAttempt = { diagnostics: Diagnostic[]; failure?: unknown; prepared?: PreparedPlan };

export type PreparePlanInput = {
  manifest: Manifest;
  get: ReadContext["get"];
  space: string;
  source: string;
  staticDiagnostics: Diagnostic[];
};

/**
 * S5〜S7 を走らせる（検証パイプライン §4 の Web Plan / Apply）。エディタで出た診断を持ち込むのは、
 * 警告がそこで消えると計画の `Warnings:` から落ちるため。
 */
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
