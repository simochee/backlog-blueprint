import { type Action, type Change } from "../action";
import { type Manifest, type Settings } from "../manifest";
import { type Reconciler } from "../reconciler";
import { asRecord, requiredNumber, requiredString } from "../api-response";
import { defaultIssueTypeSlotRefs } from "./issue-types";
import { type Value } from "../value";

export type ProjectDesired = Pick<Manifest, "key" | "name" | "settings">;

/**
 * 14 個のキーを並べた定数から拾い直す形にしない。マニフェストのスキーマ定義 §5 と
 * 二重管理になり、片方にキーを足しただけで差分が黙って出なくなる。
 * 比較する相手は書かれたキーだけ（K-3）なので、応答をそのまま持てば足りる。
 */
export type ProjectSettingsSnapshot = Partial<Record<keyof Settings, Value>>;

export type ProjectSnapshot =
  | { exists: false }
  | { exists: true; id: number; name: string; settings: ProjectSettingsSnapshot };

/**
 * 基本設定は14個のキーを並べた定数から拾い直さない（上記）。代わりに、応答のうち
 * スカラー値だけを持つ。マニフェストが書けるのは真偽値と文字列だけ（§5）なので、
 * 入れ子の値を落としても比較できる情報は減らない。
 */
const settingsOf = (record: Record<string, unknown>): ProjectSettingsSnapshot =>
  Object.fromEntries(
    Object.entries(record).filter(
      ([, value]) => typeof value === "boolean" || typeof value === "string",
    ),
  );

const projectsPath = "/api/v2/projects";

const projectPath = (key: string): string => `${projectsPath}/${key}`;

const settingsKeys = (settings: Settings): (keyof Settings)[] =>
  Object.keys(settings) as (keyof Settings)[];

const settingsValues = (settings: Settings): Record<string, Value> => {
  const values: Record<string, Value> = {};

  for (const key of settingsKeys(settings)) {
    const value = settings[key];

    if (value !== undefined) {
      values[key] = value;
    }
  }

  return values;
};

const declaredValues = (desired: ProjectDesired): Record<string, Value> => ({
  name: desired.name,
  ...settingsValues(desired.settings),
});

/**
 * 値が変わらない項目も落とさず、`field` はリクエストのキー名のまま置く（PO-11）。
 * `settings.useWiki` のように表示用の名前を付けると、`request.params` と
 * 突き合わせられなくなる。突き合わせられることが PO-11 の理由そのものである。
 */
const changesOf = (
  values: Record<string, Value>,
  current: ProjectSettingsSnapshot & { name?: Value },
): Change[] =>
  Object.entries(values).map(([field, after]) => ({
    field,
    before: current[field as keyof Settings] ?? null,
    after,
  }));

const differs = (changes: Change[]): boolean =>
  changes.some(({ before, after }) => before !== after);

const paramsOf = (changes: Change[]): Record<string, Value> =>
  Object.fromEntries(changes.map(({ field, after }) => [field, after]));

export const projectReconciler: Reconciler<ProjectDesired, ProjectSnapshot> = {
  kind: "project",
  phase: 1,

  async read(ctx) {
    if (!ctx.snapshot.project.exists) {
      return { exists: false };
    }

    const project = asRecord(await ctx.get(projectPath(ctx.projectKey)));

    return {
      exists: true,
      id: requiredNumber(project, "id"),
      name: requiredString(project, "name"),
      settings: settingsOf(project),
    };
  },

  plan(desired, snapshot, ctx) {
    if (snapshot.exists) {
      const changes = changesOf(declaredValues(desired), {
        ...snapshot.settings,
        name: snapshot.name,
      });

      if (!differs(changes)) {
        return [
          {
            id: `project/noop/${desired.key}`,
            phase: 1,
            kind: "project",
            op: "noop",
            name: desired.key,
            target: snapshot.id,
            writeRequest: false,
          },
        ];
      }

      return [
        {
          id: `project/update/${desired.key}`,
          phase: 1,
          kind: "project",
          op: "update",
          name: desired.key,
          target: snapshot.id,
          request: { method: "PATCH", path: projectPath(desired.key), params: paramsOf(changes) },
          changes,
          writeRequest: true,
        },
      ];
    }

    const changes = changesOf({ key: desired.key, ...declaredValues(desired) }, {});

    const create: Action = {
      id: `project/create/${desired.key}`,
      phase: 1,
      kind: "project",
      op: "create",
      name: desired.key,
      request: { method: "POST", path: projectsPath, params: paramsOf(changes) },
      provides: [{ kind: "project", name: desired.key }],
      changes,
      writeRequest: true,
    };

    /**
     * 取得する path を `request` に持たせない。`HttpRequest` は更新系の3メソッドしか
     * 表せず、GET を通す道が無い（§2.2）。RF-1 が `refresh` を専用の op にしたのは
     * 再取得を Executor の側に1箇所だけ置くためで、ここに GET を生やすと
     * C-2 の例外が reconciler ごとに増やせるものになる。
     */
    const refresh: Action = {
      id: "project/refresh",
      phase: 1,
      kind: "project",
      op: "refresh",
      name: desired.key,
      /**
       * 既定課題種別の枠に与える名前を、枠の位置の順に並べて持つ（§4.1 / RF-1）。
       * 取得した既定は名前を持たないものとして扱うので、i 番目をどの名前で
       * 解決表に載せるかは、計画の側からしか渡せない。
       */
      provides: defaultIssueTypeSlotRefs(ctx.manifest.issueTypes),
      writeRequest: false,
    };

    return [create, refresh];
  },
};
