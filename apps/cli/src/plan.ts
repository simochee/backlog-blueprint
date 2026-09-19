import { buildPlan as buildCorePlan } from "@backlog-blueprint/core";

import { type BuildPlan } from "./ports";

/**
 * core が返す `Plan` を CLI が描画に渡す形へ移し替えるだけ。プロジェクトの
 * 名前とキーはマニフェスト側の値で、存在するかどうかだけがスナップショット由来
 * （plan の出力仕様 §2.1）。
 */
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
