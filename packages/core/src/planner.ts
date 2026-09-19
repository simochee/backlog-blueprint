import { type Action } from "./action";
import { asRecord, requiredNumber } from "./api-response";
import { type Diagnostic } from "./diagnostic";
import { type Manifest } from "./manifest";
import { seedResolutions, type ResourceSnapshots } from "./plan";
import { type PlanContext, type ReadContext } from "./reconciler";
import { type ResolutionTable } from "./resolution";
import { resultingOrder, type ResourceOrder } from "./resulting-order";
import { accessReconciler } from "./resources/access";
import { categoriesReconciler } from "./resources/categories";
import { customFieldsReconciler } from "./resources/custom-fields";
import { issueTypesReconciler } from "./resources/issue-types";
import { milestonesReconciler } from "./resources/milestones";
import { projectReconciler } from "./resources/project";
import { statusesReconciler } from "./resources/statuses";
import { webhooksReconciler } from "./resources/webhooks";
import { type RateLimit, type Snapshot } from "./snapshot";
import { authenticateExecutor } from "./validation/auth-stage";
import { blocksNextStage, orderDiagnostics } from "./validation/gate";
import { failureDetail, failureStatus } from "./validation/http-failure";
import { type Environment } from "./validation/expand-stage";
import { validatePlan } from "./validation/plan-stage";
import { validateManifest, type SchemaStage } from "./validation/pipeline";
import { unconfirmedIssueCount, validateAgainstSnapshot } from "./validation/snapshot-stage";

const RATE_LIMIT_PATH = "/api/v2/rateLimit";

const projectPath = (projectKey: string): string => `/api/v2/projects/${projectKey}`;

const issueCountPath = (projectId: number): string =>
  `/api/v2/issues/count?projectId[]=${projectId}`;

const readUpdateRateLimit = async (get: ReadContext["get"]): Promise<RateLimit> => {
  const body = asRecord(await get(RATE_LIMIT_PATH));
  const update = asRecord(asRecord(body["rateLimit"])["update"]);

  return {
    limit: requiredNumber(update, "limit"),
    remaining: requiredNumber(update, "remaining"),
    reset: requiredNumber(update, "reset"),
  };
};

/**
 * 404 を投げない `get` を用意しない（§7.0）。404 を情報として読むのはフェーズ0の
 * この1箇所だけで、他のすべての GET では 404 は本物の失敗である。送信層に
 * 「どの 404 が情報か」を判断させると、その知識が core と送信層に分かれる。
 */
const readProjectId = async (
  get: ReadContext["get"],
  projectKey: string,
): Promise<number | undefined> => {
  try {
    return requiredNumber(asRecord(await get(projectPath(projectKey))), "id");
  } catch (error) {
    if (failureStatus(error) === 404) {
      return undefined;
    }

    throw error;
  }
};

export type SpaceSnapshotResult = { diagnostics: Diagnostic[]; snapshot?: Snapshot };

export type SpaceSnapshotInput = {
  get: ReadContext["get"];
  projectKey: string;
  executor: Snapshot["executor"];
};

export const readSpaceSnapshot = async ({
  get,
  projectKey,
  executor,
}: SpaceSnapshotInput): Promise<SpaceSnapshotResult> => {
  const updateRateLimit = await readUpdateRateLimit(get);
  const projectId = await readProjectId(get, projectKey);

  if (projectId === undefined) {
    return { diagnostics: [], snapshot: { executor, updateRateLimit, project: { exists: false } } };
  }

  try {
    const issueCount = requiredNumber(asRecord(await get(issueCountPath(projectId))), "count");

    return {
      diagnostics: [],
      snapshot: { executor, updateRateLimit, project: { exists: true, id: projectId, issueCount } },
    };
  } catch (error) {
    /**
     * 取得できなかったことを握りつぶして先へ進めない（VP-5）。破壊的操作を止める
     * 唯一のゲートなので、確認できたうえで0件のときだけ通す。
     */
    return { diagnostics: [unconfirmedIssueCount(projectKey, failureDetail(error))] };
  }
};

const readResourceSnapshots = async (ctx: ReadContext): Promise<ResourceSnapshots> => ({
  projectKey: ctx.projectKey,
  project: await projectReconciler.read(ctx),
  issueTypes: await issueTypesReconciler.read(ctx),
  statuses: await statusesReconciler.read(ctx),
  categories: await categoriesReconciler.read(ctx),
  milestones: await milestonesReconciler.read(ctx),
  customFields: await customFieldsReconciler.read(ctx),
  access: await accessReconciler.read(ctx),
  webhooks: await webhooksReconciler.read(ctx),
});

/**
 * 依存グラフを作らず、要件定義 §6 のフェーズ順に並べたフラットな全順序にする（C-3）。
 * 順序を宣言から計算させると、§6 の表とコードの対応が失われる。
 */
const planActions = (
  manifest: Manifest,
  snapshots: ResourceSnapshots,
  ctx: PlanContext,
): Action[] => [
  ...projectReconciler.plan(
    { key: manifest.key, name: manifest.name, settings: manifest.settings },
    snapshots.project,
    ctx,
  ),
  ...issueTypesReconciler.plan(manifest.issueTypes, snapshots.issueTypes, ctx),
  ...statusesReconciler.plan(manifest.statuses, snapshots.statuses, ctx),
  ...categoriesReconciler.plan(manifest.categories, snapshots.categories, ctx),
  ...milestonesReconciler.plan(manifest.milestones, snapshots.milestones, ctx),
  ...customFieldsReconciler.plan(manifest.customFields, snapshots.customFields, ctx),
  ...accessReconciler.plan(manifest.access, snapshots.access, ctx),
  ...webhooksReconciler.plan(manifest.webhooks, snapshots.webhooks, ctx),
];

export type Plan = {
  manifest: Manifest;
  snapshot: Snapshot;
  snapshots: ResourceSnapshots;
  actions: Action[];
  resolutions: ResolutionTable;
  /** 適用後に実際どう並ぶか（plan の出力仕様 §1.4）。V-A15 が判定するのと同じ値 */
  order: ResourceOrder;
};

export type CreatePlanOptions = {
  text: string;
  schemaStage: SchemaStage;
  get: ReadContext["get"];
  env?: Environment;
};

/**
 * `plan` が空なのは、どこかのステージがエラーを出して先へ進まなかったことを意味する
 * （VG-2）。適用できる計画と、描画だけできる計画を区別しない。
 */
export type CreatePlanResult = { diagnostics: Diagnostic[]; plan?: Plan };

export const createPlan = async ({
  text,
  schemaStage,
  get,
  env,
}: CreatePlanOptions): Promise<CreatePlanResult> => {
  const validation = validateManifest({ text, schemaStage, env });
  const diagnostics = [...validation.diagnostics];
  const { manifest } = validation;

  if (manifest === undefined) {
    return { diagnostics: orderDiagnostics(diagnostics) };
  }

  const auth = await authenticateExecutor(get);

  diagnostics.push(...auth.diagnostics);

  if (auth.executor === undefined || blocksNextStage(auth.diagnostics)) {
    return { diagnostics: orderDiagnostics(diagnostics) };
  }

  const projectKey = manifest.key;
  const space = await readSpaceSnapshot({ get, projectKey, executor: auth.executor });
  const { snapshot } = space;

  diagnostics.push(...space.diagnostics);

  if (snapshot === undefined) {
    return { diagnostics: orderDiagnostics(diagnostics) };
  }

  const snapshots = await readResourceSnapshots({ projectKey, snapshot, get });

  diagnostics.push(...validateAgainstSnapshot({ manifest, snapshot, snapshots }));

  if (blocksNextStage(diagnostics)) {
    return { diagnostics: orderDiagnostics(diagnostics) };
  }

  /**
   * `seedResolutions` を `plan()` の前に必ず呼ぶ（§3.2）。既存プロジェクトの
   * `applicableIssueTypes` が指す課題種別は、変更が無ければどの Action の `provides`
   * にも現れないので、ここで登録しないと適用の実行時に未解決参照で中断する。
   */
  const resolutions = seedResolutions(snapshots);
  const actions = planActions(manifest, snapshots, {
    manifest,
    snapshot,
    isSecret: (path) => validation.expandedPaths.has(path),
  });

  const order = resultingOrder(manifest, snapshots, actions);

  diagnostics.push(...validatePlan({ manifest, snapshot, snapshots, actions, order }));

  if (blocksNextStage(diagnostics)) {
    return { diagnostics: orderDiagnostics(diagnostics) };
  }

  return {
    diagnostics: orderDiagnostics(diagnostics),
    plan: { manifest, snapshot, snapshots, actions, resolutions, order },
  };
};
