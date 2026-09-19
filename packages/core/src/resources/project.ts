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

const settingsChanges = (
  desired: Settings,
  current: ProjectSettingsSnapshot,
  seal: Seal,
): Change[] =>
  settingsKeys(desired)
    .filter((key) => current[key] !== desired[key])
    .map((key) => ({
      field: `settings.${key}`,
      before: current[key] ?? null,
      after: seal(`settings/${key}`, desired[key] ?? null),
    }));

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
      const changes = [
        ...(snapshot.name === desired.name
          ? []
          : [{ field: "name", before: snapshot.name, after: seal("name", desired.name) }]),
        ...settingsChanges(desired.settings, snapshot.settings, seal),
      ];

      if (changes.length === 0) {
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
          request: {
            method: "PATCH",
            path: projectPath(desired.key),
            params: { name: seal("name", desired.name), ...settingsParams(desired.settings, seal) },
          },
          changes,
          writeRequest: true,
        },
      ];
    }

    const create: Action = {
      id: `project/create/${desired.key}`,
      phase: 1,
      kind: "project",
      op: "create",
      name: desired.key,
      request: {
        method: "POST",
        path: projectsPath,
        params: {
          key: seal("key", desired.key),
          name: seal("name", desired.name),
          ...settingsParams(desired.settings, seal),
        },
      },
      provides: [{ kind: "project", name: desired.key }],
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
