import { type BacklogClient } from "@backlog-blueprint/backlog-client";
import { execute, type Plan } from "@backlog-blueprint/core";

import { foldExecutionEvent, idleProgress, type ApplyRun } from "./progress";

export type ApplyInput = {
  plan: Plan;
  space: string;
  /** 呼び出し時点で掴んだクライアント（WU-37）。途中で接続を差し替えても、残りはここへ送る */
  client: BacklogClient;
};

/**
 * 実行を画面の外に置く。`for await` を含む関数は React Compiler が扱えず、抱えている
 * 部品ごと素通しになる（App 全体が最適化の対象から外れる）。ここに出せば、記録を進める
 * 手続きと、それを描く部品とが別々に読める。
 */
export const runApply = async (
  { plan, space, client }: ApplyInput,
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
      get: client.get,
      send: client.send,
    })) {
      progress = foldExecutionEvent(progress, event);
      show({ ...base, progress });
    }
  } catch (error) {
    show({ ...base, progress, failure: error });
  }
};
