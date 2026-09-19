import { type Action, type Change } from "../action";
import { type Manifest, type Settings } from "../manifest";
import { type Reconciler } from "../reconciler";
import { sealer, type Seal } from "../secret";
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

type ProjectResponse = { id: number; name: string } & ProjectSettingsSnapshot;

const projectsPath = "/api/v2/projects";

const projectPath = (key: string): string => `${projectsPath}/${key}`;

const settingsKeys = (settings: Settings): (keyof Settings)[] =>
  Object.keys(settings) as (keyof Settings)[];

const settingsParams = (settings: Settings, seal: Seal): Record<string, Value> => {
  const params: Record<string, Value> = {};

  for (const key of settingsKeys(settings)) {
    const value = settings[key];

    if (value !== undefined) {
      params[key] = seal(`settings/${key}`, value);
    }
  }

  return params;
};

/**
 * 値が変わらない項目も落とさず、`field` はリクエストのキー名のまま置く（PO-11）。
 * `settings.useWiki` のように表示用の名前を付けると、`request.params` と
 * 突き合わせられなくなる。突き合わせられることが PO-11 の理由そのものである。
 */
const changesOf = (
  params: Record<string, Value>,
  current: ProjectSettingsSnapshot & { name?: Value },
): Change[] =>
  Object.entries(params).map(([field, after]) => ({
    field,
    before: current[field as keyof Settings] ?? null,
    after,
  }));

const differs = (changes: Change[]): boolean =>
  changes.some(({ before, after }) => before !== after);

export const projectReconciler: Reconciler<ProjectDesired, ProjectSnapshot> = {
  kind: "project",
  phase: 1,

  async read(ctx) {
    if (!ctx.snapshot.project.exists) {
      return { exists: false };
    }

    const project = (await ctx.get(projectPath(ctx.projectKey))) as ProjectResponse;

    return { exists: true, id: project.id, name: project.name, settings: project };
  },

  plan(desired, snapshot, ctx) {
    const seal = sealer(ctx.isSecret);

    if (snapshot.exists) {
      const params = {
        name: seal("name", desired.name),
        ...settingsParams(desired.settings, seal),
      };
      const changes = changesOf(params, { ...snapshot.settings, name: snapshot.name });

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
          request: { method: "PATCH", path: projectPath(desired.key), params },
          changes,
          writeRequest: true,
        },
      ];
    }

    const params = {
      key: seal("key", desired.key),
      name: seal("name", desired.name),
      ...settingsParams(desired.settings, seal),
    };

    const create: Action = {
      id: `project/create/${desired.key}`,
      phase: 1,
      kind: "project",
      op: "create",
      name: desired.key,
      request: { method: "POST", path: projectsPath, params },
      provides: [{ kind: "project", name: desired.key }],
      changes: changesOf(params, {}),
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
      writeRequest: false,
    };

    return [create, refresh];
  },
};
