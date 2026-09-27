import { declaredOnly, differs, fieldChanges, paramsOf, type Action } from "../action";
import { type Manifest, type Settings } from "../manifest";
import { type Reconciler } from "../reconciler";
import { asRecord, requiredNumber, requiredString } from "../api-response";
import { defaultIssueTypeSlotRefs } from "./issue-types";
import { type Value } from "../value";

export type ProjectDesired = Pick<Manifest, "key" | "name" | "settings">;

export type ProjectSettingsSnapshot = Partial<Record<keyof Settings, Value>>;

export type ProjectSnapshot =
  | { exists: false }
  | { exists: true; id: number; name: string; settings: ProjectSettingsSnapshot };

/**
 * キーの一覧から拾い直さない。スキーマ定義 §5 との二重管理になり、片方にキーを足すと
 * 差分が黙って出なくなる。マニフェストが書けるのは真偽値と文字列だけ（§5）なので、
 * スカラー値だけを持てば比較できる情報は減らない。
 */
const settingsOf = (record: Record<string, unknown>): ProjectSettingsSnapshot =>
  Object.fromEntries(
    Object.entries(record).filter(
      ([, value]) => typeof value === "boolean" || typeof value === "string",
    ),
  );

const projectsPath = "/api/v2/projects";

const projectPath = (key: string): string => `${projectsPath}/${key}`;

/**
 * `field` に `settings.useWiki` のような表示用の名前を付けない。`request.params` と
 * 突き合わせられなくなる（PO-11）。
 */
const declaredValues = (desired: ProjectDesired): Record<string, Value> => ({
  name: desired.name,
  ...declaredOnly(desired.settings),
});

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
      const changes = fieldChanges(declaredValues(desired), {
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

    const changes = fieldChanges({ key: desired.key, ...declaredValues(desired) }, {});

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

    const refresh: Action = {
      id: "project/refresh",
      phase: 1,
      kind: "project",
      op: "refresh",
      name: desired.key,
      // 取得した既定の名前では登録しない。i 番目の枠の名前は計画の側からしか渡せない
      // （§4.1 / RF-1）。
      provides: defaultIssueTypeSlotRefs(ctx.manifest.issueTypes),
      writeRequest: false,
    };

    return [create, refresh];
  },
};
