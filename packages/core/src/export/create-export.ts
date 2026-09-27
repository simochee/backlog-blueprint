import { type Diagnostic } from "../diagnostic";
import { type ManifestInput, PROJECT_KEY_PATTERN } from "../manifest";
import {
  readIssueCount,
  readProjectId,
  readResourceSnapshots,
  readUpdateRateLimit,
} from "../planner";
import { type ReadContext } from "../reconciler";
import { type Snapshot } from "../snapshot";
import { authenticateExecutor } from "../validation/auth-stage";
import { blocksNextStage } from "../validation/gate";
import { invalidProjectKey, projectDoesNotExist } from "./diagnostics";
import { serializeManifest } from "./serialize";
import { toManifest } from "./to-manifest";

export type CreateExportOptions = {
  projectKey: string;
  get: ReadContext["get"];
  version: string;
};

export type ProjectExport = {
  projectKey: string;
  yaml: string;
  /** `yaml` から読み戻せても落とさない。EX-18 (1) の往復テストと Web UI（EX-20）が使う */
  manifest: ManifestInput;
  issueCount: number;
};

/** `CreatePlanResult` と形を揃え、呼び出し側が同じ分岐で書けるようにする。`export` は予約語 */
export type CreateExportResult = { diagnostics: Diagnostic[]; exported?: ProjectExport };

const isProjectKey = (value: string): boolean => new RegExp(PROJECT_KEY_PATTERN).test(value);

/** GET は X-2 のとおり間隔を空けない。 */
export const createExport = async ({
  projectKey,
  get,
  version,
}: CreateExportOptions): Promise<CreateExportResult> => {
  // 呼び出し側に移さない（EX-3 / CL-7）。`projectKey` は `read*` が URL のパスに埋める値で、
  // 外へ出すと呼び出し側ごとに同じ検査が要る（NFR-6）。
  if (!isProjectKey(projectKey)) {
    return { diagnostics: [invalidProjectKey(projectKey)] };
  }

  const auth = await authenticateExecutor(get);

  if (auth.executor === undefined || blocksNextStage(auth.diagnostics)) {
    return { diagnostics: auth.diagnostics };
  }

  const projectId = await readProjectId(get, projectKey);

  if (projectId === undefined) {
    return { diagnostics: [projectDoesNotExist(projectKey)] };
  }

  // 失敗を捕まえない（EX-3）。`export` は課題件数でゲートしないので、VP-5 の文言を借りると
  // 「ゲートで止めた」という意味が付く。
  const issueCount = await readIssueCount(get, projectId);

  // 書き込まなくても更新系の残量を読む。`updateRateLimit` を省略可能にすると、X-4 の待ち時間を
  // 計算する側が「無いかもしれない値」を扱うことになる。GET 1回のほうが安い。
  const updateRateLimit = await readUpdateRateLimit(get);
  const snapshot: Snapshot = {
    executor: auth.executor,
    updateRateLimit,
    project: { exists: true, id: projectId, issueCount },
  };
  const snapshots = await readResourceSnapshots({ projectKey, snapshot, get });
  const { diagnostics, manifest, accessLabels } = toManifest(snapshots);

  if (manifest === undefined) {
    return { diagnostics };
  }

  return {
    diagnostics,
    exported: {
      projectKey,
      yaml: serializeManifest(manifest, { version, accessLabels }),
      manifest,
      issueCount,
    },
  };
};
