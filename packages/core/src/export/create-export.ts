import { type Diagnostic } from "../diagnostic";
import { type ManifestInput } from "../manifest";
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
import { projectDoesNotExist } from "./diagnostics";
import { serializeManifest } from "./serialize";
import { toManifest, type WebhookVariable } from "./to-manifest";

export type CreateExportOptions = {
  projectKey: string;
  get: ReadContext["get"];
  /** 実行中のツールの版。`$schema` の URL に入る（EX-15） */
  version: string;
};

export type ProjectExport = {
  projectKey: string;
  /** stdout に書く完成品（EX-17）。呼び出し側は加工しない */
  yaml: string;
  /** EX-18 (1) の往復テストと Web UI（EX-20）のために持つ */
  manifest: ManifestInput;
  /** CL-8 の案内に使う。0 なら案内は出ない */
  issueCount: number;
  /** EX-4 の案内に使う。空なら案内は出ない */
  webhookVariables: WebhookVariable[];
};

/**
 * `CreatePlanResult` と同じ形にする。`export` も `plan` も「診断を出して止まったか、
 * 結果が揃ったか」の2つしかないので、呼び出し側が同じ分岐で書ける。
 * `export` が予約語なので名前は `exported` になる。
 */
export type CreateExportResult = { diagnostics: Diagnostic[]; exported?: ProjectExport };

/** GET は X-2 のとおり間隔を空けない。 */
export const createExport = async ({
  projectKey,
  get,
  version,
}: CreateExportOptions): Promise<CreateExportResult> => {
  const auth = await authenticateExecutor(get);

  if (auth.executor === undefined || blocksNextStage(auth.diagnostics)) {
    return { diagnostics: auth.diagnostics };
  }

  const projectId = await readProjectId(get, projectKey);

  if (projectId === undefined) {
    return { diagnostics: [projectDoesNotExist(projectKey)] };
  }

  /**
   * 失敗を捕まえない（EX-3）。`export` は課題件数でゲートしないので、読めなかった
   * ときに VP-5 の文言を借りると「ゲートで止めた」という意味が付く。
   */
  const issueCount = await readIssueCount(get, projectId);

  /**
   * 書き込みをしない `export` にも更新系の残量を読ませる。`Snapshot` から
   * `updateRateLimit` を省略可能にすれば1回の GET は減るが、reconciler の
   * `ReadContext` が弱まり、X-4 の待ち時間を計算する側が「無いかもしれない値」を
   * 扱うことになる。GET 1回のほうが安い。
   */
  const updateRateLimit = await readUpdateRateLimit(get);
  const snapshot: Snapshot = {
    executor: auth.executor,
    updateRateLimit,
    project: { exists: true, id: projectId, issueCount },
  };
  const snapshots = await readResourceSnapshots({ projectKey, snapshot, get });
  const { diagnostics, manifest, webhookVariables } = toManifest(snapshots);

  if (manifest === undefined) {
    return { diagnostics };
  }

  return {
    diagnostics,
    exported: {
      projectKey,
      yaml: serializeManifest(manifest, { version }),
      manifest,
      issueCount,
      webhookVariables,
    },
  };
};
