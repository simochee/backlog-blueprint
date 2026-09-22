import { execute, type Plan } from "@backlog-blueprint/core";

import { foldExecutionEvent, idleProgress, type ApplyRun } from "./progress";
import { transport } from "./transport";

export type ApplyInput = { plan: Plan; space: string };

/**
 * 実行を画面の外に置く。`for await` を含む関数は React Compiler が扱えず、抱えている
 * 部品ごと素通しになる（App 全体が最適化の対象から外れる）。ここに出せば、記録を進める
 * 手続きと、それを描く部品とが別々に読める。
 */
export const runApply = async (
  { plan, space }: ApplyInput,
  show: (run: ApplyRun) => void,
): Promise<void> => {
  const { actions, resolutions, manifest } = plan;
  const base = { resolutions, projectKey: manifest.key, space };

  let progress = idleProgress;

  show({ ...base, progress });

  try {
    for await (const event of execute(actions, {
      projectKey: manifest.key,
      resolutions,
      get: transport.get,
      send: transport.send,
    })) {
      progress = foldExecutionEvent(progress, event);
      show({ ...base, progress });
    }
  } catch (error) {
    show({ ...base, progress, failure: error });
  }
};
