import { type BacklogClient } from "@backlog-blueprint/backlog-client";
import { execute, type Plan } from "@backlog-blueprint/core";

import { foldExecutionEvent, idleProgress, type ApplyRun } from "./progress";

type ApplyInput = { plan: Plan; space: string; client: BacklogClient };

/** App の中に書かない。`for await` を含む関数は React Compiler が扱えず、App ごと最適化から外れる */
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
