import { describe, expect, it } from "vitest";

import { fixedManifest, fixedPlanContext } from "../../test-utils/src/index";
import { seedResolutions, type ResourceSnapshots } from "./plan";
import { resolveRequest } from "./ref";
import { customFieldsReconciler } from "./resources/custom-fields";

const snapshots = (overrides: Partial<ResourceSnapshots> = {}): ResourceSnapshots => ({
  projectKey: "PROJ_A",
  project: { exists: true, id: 100, name: "プロジェクトA", settings: {} },
  issueTypes: { source: "project", issueTypes: [{ id: 101, name: "タスク", color: "#7ea800" }] },
  statuses: { source: "project", statuses: [{ id: 1, name: "未対応", color: "#ed8077" }] },
  categories: [{ id: 21, name: "インフラ" }],
  milestones: [{ id: 31, name: "v1.0" }],
  customFields: { customFields: [], issueTypes: [] },
  access: {
    teams: [],
    members: [],
    administrators: [],
    spaceUsers: [{ id: 11, name: "鈴木 花子", roleType: 2 }],
    spaceTeams: [{ id: 21, name: "開発チーム", members: [] }],
  },
  webhooks: [],
  ...overrides,
});

describe("解決表の初期登録", () => {
  it("既存リソースは名前から ID を引けるようになる", () => {
    const resolutions = seedResolutions(snapshots());

    expect(resolutions.get("project:PROJ_A")).toBe(100);
    expect(resolutions.get("issueType:タスク")).toBe(101);
    expect(resolutions.get("status:未対応")).toBe(1);
    expect(resolutions.get("category:インフラ")).toBe(21);
    expect(resolutions.get("milestone:v1.0")).toBe(31);
  });

  it("チームと利用者はマニフェストが ID を直に書くので登録しない", () => {
    expect(
      [...seedResolutions(snapshots()).keys()].some((key) =>
        ["projectTeam:", "projectMember:", "projectAdministrator:"].some((kind) =>
          key.startsWith(kind),
        ),
      ),
    ).toBe(false);
  });

  it("未作成のプロジェクトでは何も登録されない", () => {
    const resolutions = seedResolutions(
      snapshots({
        project: { exists: false },
        issueTypes: { source: "defaults", slots: 4 },
        statuses: { source: "defaults" },
        categories: [],
        milestones: [],
        access: {
          teams: [],
          members: [],
          administrators: [],
          spaceUsers: [],
          spaceTeams: [],
        },
      }),
    );

    expect([...resolutions.keys()]).toEqual([]);
  });

  it("既存の課題種別を指すカスタム属性が、この登録だけで解決できる", () => {
    const manifest = fixedManifest({
      issueTypes: [{ name: "タスク", color: "#7ea800" }],
      customFields: [{ name: "環境", type: "text", applicableIssueTypes: ["タスク"] }],
    });
    const [action] = customFieldsReconciler.plan(
      manifest.customFields,
      { customFields: [], issueTypes: [] },
      fixedPlanContext({ manifest }),
    );
    const resolved = resolveRequest(
      action?.request ?? { method: "POST", path: "", params: {} },
      seedResolutions(snapshots()),
    );

    expect(resolved.resolved).toBe(true);
    expect(resolved.resolved && resolved.value.params.applicableIssueTypes).toEqual([101]);
  });
});
