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

/**
 * 失敗をここで捕まえない。VP-5 のゲートを持つ `readSpaceSnapshot` だけが V-B3 の診断に
 * 変え、ゲートを持たない `export` はその文言を借りずに素の失敗として扱う（EX-3）。
 */
export const readIssueCount = async (get: ReadContext["get"], projectId: number): Promise<number> =>
  requiredNumber(asRecord(await get(issueCountPath(projectId))), "count");

export const readUpdateRateLimit = async (get: ReadContext["get"]): Promise<RateLimit> => {
  const body = asRecord(await get(RATE_LIMIT_PATH));
  const update = asRecord(asRecord(body["rateLimit"])["update"]);

  return {
    limit: requiredNumber(update, "limit"),
    remaining: requiredNumber(update, "remaining"),
    reset: requiredNumber(update, "reset"),
  };
};

/**
 * 404 を投げない `get` を送信層に用意させない。404 が情報なのはこの1箇所だけで、その知識が
 * core と送信層に分かれる（§7.0）。
 */
export const readProjectId = async (
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
    const issueCount = await readIssueCount(get, projectId);

    return {
      diagnostics: [],
      snapshot: { executor, updateRateLimit, project: { exists: true, id: projectId, issueCount } },
    };
  } catch (error) {
    // 取得できなかったことを握りつぶして先へ進めない。破壊的操作を止める唯一のゲートで
    // ある（VP-5）。
    return { diagnostics: [unconfirmedIssueCount(projectKey, failureDetail(error))] };
  }
};

export const readResourceSnapshots = async (ctx: ReadContext): Promise<ResourceSnapshots> => ({
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

/** 順序を依存グラフから計算させない。要件定義 §6 の表とコードの対応が失われる（C-3）。 */
export const planActions = (
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
  order: ResourceOrder;
};

export type BuildPlanOptions = {
  manifest: Manifest;
  get: ReadContext["get"];
};

export type CreatePlanOptions = {
  text: string;
  schemaStage: SchemaStage;
  get: ReadContext["get"];
  env?: Environment;
};

export type CreatePlanResult = { diagnostics: Diagnostic[]; plan?: Plan };

export const buildPlan = async ({ manifest, get }: BuildPlanOptions): Promise<CreatePlanResult> => {
  const diagnostics: Diagnostic[] = [];
  const auth = await authenticateExecutor(get);

  diagnostics.push(...auth.diagnostics);

  if (auth.executor === undefined || blocksNextStage(auth.diagnostics)) {
    return { diagnostics };
  }

  const projectKey = manifest.key;
  const space = await readSpaceSnapshot({ get, projectKey, executor: auth.executor });
  const { snapshot } = space;

  diagnostics.push(...space.diagnostics);

  if (snapshot === undefined) {
    return { diagnostics };
  }

  const snapshots = await readResourceSnapshots({ projectKey, snapshot, get });

  diagnostics.push(...validateAgainstSnapshot({ manifest, snapshot, snapshots }));

  if (blocksNextStage(diagnostics)) {
    return { diagnostics };
  }

  // 変更の無い既存リソースはどの Action の `provides` にも現れない。登録しないと、それを指す
  // `applicableIssueTypes` が適用の途中で未解決参照として止まる（§3.2）。
  const resolutions = seedResolutions(snapshots);
  const actions = planActions(manifest, snapshots, { manifest, snapshot });
  const order = resultingOrder(manifest, snapshots, actions);

  diagnostics.push(...validatePlan({ manifest, snapshot, snapshots, actions, order }));

  if (blocksNextStage(diagnostics)) {
    return { diagnostics };
  }

  return { diagnostics, plan: { manifest, snapshot, snapshots, actions, resolutions, order } };
};

export const createPlan = async ({
  text,
  schemaStage,
  get,
  env,
}: CreatePlanOptions): Promise<CreatePlanResult> => {
  const validation = validateManifest({ text, schemaStage, env });
  const { manifest } = validation;

  if (manifest === undefined) {
    return { diagnostics: orderDiagnostics(validation.diagnostics) };
  }

  const built = await buildPlan({
    manifest,
    get,
  });

  return {
    ...built,
    diagnostics: orderDiagnostics([...validation.diagnostics, ...built.diagnostics]),
  };
};
