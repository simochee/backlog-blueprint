import { describe, expect, it } from "vitest";

import {
  fixedManifest,
  fixedResourceSnapshots,
  fixedSnapshot,
} from "../../../test-utils/src/index";
import { type ManifestInput, type Settings } from "../manifest";
import { type ExistingCustomField } from "../resources/custom-fields";
import { type ResourceSnapshots } from "../plan";
import { type ProjectSettingsSnapshot, type ProjectSnapshot } from "../resources/project";
import { DEFAULT_STATUSES_EN, DEFAULT_STATUSES_JA } from "../resources/statuses";
import { type Snapshot } from "../snapshot";
import { validateAgainstSnapshot } from "./snapshot-stage";

const defaultStatuses = DEFAULT_STATUSES_JA.map(({ name }) => ({ name }));

const englishStatuses = DEFAULT_STATUSES_EN.map(({ name }) => ({ name }));

const validate = (
  manifest: Partial<ManifestInput>,
  overrides: { snapshot?: Partial<Snapshot>; snapshots?: Partial<ResourceSnapshots> } = {},
) =>
  validateAgainstSnapshot({
    manifest: fixedManifest({ statuses: defaultStatuses, ...manifest }),
    snapshot: fixedSnapshot(overrides.snapshot),
    snapshots: fixedResourceSnapshots({
      statuses: { source: "project", statuses: DEFAULT_STATUSES_JA },
      ...overrides.snapshots,
    }),
  });

const idsOf = (
  manifest: Partial<ManifestInput>,
  overrides: { snapshot?: Partial<Snapshot>; snapshots?: Partial<ResourceSnapshots> } = {},
) => validate(manifest, overrides).map(({ id }) => id);

const SPACE_USERS = [
  { id: 9, userId: "suzuki", roleType: 2, name: "鈴木", mailAddress: "suzuki@example.com" },
  { id: 10, userId: "tanaka", roleType: 2, name: "田中", mailAddress: "tanaka@example.com" },
  { id: 11, userId: "tanaka2", roleType: 2, name: "田中", mailAddress: "tanaka2@example.com" },
];

const hintFor = (written: string) =>
  validate(
    { access: { members: [written] } },
    {
      snapshots: {
        access: {
          teams: [],
          members: [],
          administrators: [],
          spaceUsers: SPACE_USERS,
          spaceTeams: [],
        },
      },
    },
  )[0]?.hint;

describe("対象プロジェクトの課題件数（V-B3）", () => {
  it("課題が1件あるプロジェクトは V-B3 で中断する", () => {
    expect(idsOf({}, { snapshot: { project: { exists: true, id: 100, issueCount: 1 } } })).toEqual([
      "V-B3",
    ]);
  });

  it("課題件数を件数とプロジェクトキーの両方で伝える", () => {
    const [diagnostic] = validate(
      {},
      { snapshot: { project: { exists: true, id: 100, issueCount: 43 } } },
    );

    expect(diagnostic?.message).toContain("PROJ_A");
    expect(diagnostic?.message).toContain("43");
  });

  it("課題が0件のプロジェクトは通す", () => {
    expect(idsOf({})).toEqual([]);
  });

  it("未作成のプロジェクトには課題が存在しないので通す", () => {
    expect(
      idsOf(
        {},
        {
          snapshot: { project: { exists: false } },
          snapshots: { project: { exists: false }, statuses: { source: "defaults" } },
        },
      ),
    ).toEqual([]);
  });
});

describe("access が指す相手の存在（V-B4 / V-B5）", () => {
  it("スペースに居ないユーザー ID を書くと V-B4 で中断する", () => {
    expect(idsOf({ access: { members: ["suzuki"] } })).toEqual(["V-B4"]);
  });

  it("管理者に書いたユーザー ID もスペースの利用者として確かめる", () => {
    expect(idsOf({ access: { administrators: ["suzuki"] } })).toEqual(["V-B4"]);
  });

  it("メールアドレスを書いた場合は、その持ち主のログイン ID を名指す", () => {
    expect(hintFor("suzuki@example.com")).toBe(
      'that is the email address of "suzuki"; write the login id instead',
    );
  });

  it("メールアドレスの大文字小文字は問わない", () => {
    expect(hintFor("Suzuki@Example.COM")).toBe(
      'that is the email address of "suzuki"; write the login id instead',
    );
  });

  it("表示名を書いた場合も、その持ち主のログイン ID を名指す", () => {
    expect(hintFor("鈴木")).toBe(
      'that is the display name of "suzuki"; write the login id instead',
    );
  });

  it("表示名が複数人で重なっているときは1人に決めつけず候補を挙げる", () => {
    expect(hintFor("田中")).toBe(
      '2 users share that display name ("tanaka", "tanaka2"); write one of their login ids',
    );
  });

  it("誰の表示名でもメールアドレスでもない値には、何を書くべきかだけを言う", () => {
    expect(hintFor("nobody@example.com")).toBe(
      "write the login id shown in Backlog, not an email address or a display name",
    );
  });

  it("スペースに無いチーム名を書くと V-B5 で中断する", () => {
    expect(idsOf({ access: { teams: ["開発チーム"] } })).toEqual(["V-B5"]);
  });

  it("存在するユーザーとチームは通す", () => {
    expect(
      idsOf(
        { access: { members: ["suzuki"], teams: ["開発チーム"] } },
        {
          snapshots: {
            access: {
              teams: [],
              members: [],
              administrators: [],
              spaceUsers: [{ id: 9, userId: "suzuki", roleType: 2 }],
              spaceTeams: [{ id: 3, name: "開発チーム", members: [] }],
            },
          },
        },
      ),
    ).toEqual([]);
  });

  it("居ない相手は1件目で止めずにすべて挙げる", () => {
    expect(idsOf({ access: { members: ["suzuki"], teams: ["開発チーム"] } })).toEqual([
      "V-B4",
      "V-B5",
    ]);
  });
});

const space = (users: { id: number; userId: string; roleType: number }[]) => ({
  snapshots: {
    access: { teams: [], members: [], administrators: [], spaceUsers: users, spaceTeams: [] },
  },
});

describe("管理者にできる役割（V-B11）", () => {
  const YAMADA = { id: 1, userId: "yamada", roleType: 1 };

  const SATO = { id: 2, userId: "sato", roleType: 1 };

  const SUZUKI = { id: 3, userId: "suzuki", roleType: 2 };

  it("スペース管理者を administrators に書くと V-B11 で中断する", () => {
    expect(idsOf({ access: { administrators: ["yamada"] } }, space([YAMADA]))).toEqual(["V-B11"]);
  });

  it("スペース管理者を members に書くのは通す", () => {
    expect(idsOf({ access: { members: ["yamada"] } }, space([YAMADA]))).toEqual([]);
  });

  it("一般ユーザーを administrators に書くのは通す", () => {
    expect(idsOf({ access: { administrators: ["suzuki"] } }, space([SUZUKI]))).toEqual([]);
  });

  it("スペース管理者が複数居れば全員挙げる", () => {
    const diagnostics = validate(
      { access: { administrators: ["yamada", "suzuki", "sato"] } },
      space([YAMADA, SATO, SUZUKI]),
    );

    expect(diagnostics.map(({ id, path }) => [id, path])).toEqual([
      ["V-B11", "access/administrators/0"],
      ["V-B11", "access/administrators/2"],
    ]);
  });

  it("members に書き直す道を案内する", () => {
    const [diagnostic] = validate({ access: { administrators: ["yamada"] } }, space([YAMADA]));

    expect(diagnostic?.message).toContain("yamada");
    expect(diagnostic?.hint).toContain("access.members");
  });
});

describe("既定ステータス（V-A6 / V-A6a）", () => {
  it("既定ステータスを1つ省いたマニフェストは V-A6 で中断する", () => {
    const missing = defaultStatuses.filter(({ name }) => name !== "処理済み");

    expect(idsOf({ statuses: missing })).toEqual(["V-A6"]);
  });

  it("省かれた既定ステータスの名前をそのまま伝える", () => {
    const [diagnostic] = validate({ statuses: defaultStatuses.slice(0, 3) });

    expect(diagnostic?.message).toContain("完了");
  });

  it("未作成のプロジェクトでは日本語の組でも英語の組でも通す", () => {
    const asNewProject = {
      snapshot: { project: { exists: false } as const },
      snapshots: {
        project: { exists: false } as const,
        statuses: { source: "defaults" } as const,
      },
    };

    expect(idsOf({ statuses: englishStatuses }, asNewProject)).toEqual([]);
    expect(idsOf({ statuses: defaultStatuses }, asNewProject)).toEqual([]);
  });

  it("未作成のプロジェクトでどちらの組にも一致しないと V-A6 で中断する", () => {
    const [diagnostic] = validate(
      { statuses: [...defaultStatuses.slice(0, 3), { name: "レビュー中" }] },
      {
        snapshot: { project: { exists: false } },
        snapshots: { project: { exists: false }, statuses: { source: "defaults" } },
      },
    );

    expect(diagnostic?.id).toBe("V-A6");
    expect(diagnostic?.hint).toContain("Closed");
  });

  it("既定ステータスに色を書くと V-A6a で中断する", () => {
    expect(
      idsOf({
        statuses: [{ name: "未対応", color: "#ea2c00" }, ...defaultStatuses.slice(1)],
      }),
    ).toEqual(["V-A6a"]);
  });

  it("既定ステータスに oldname を書くと V-A6a で中断する", () => {
    expect(
      idsOf({
        statuses: [{ name: "未対応", oldname: "新規" }, ...defaultStatuses.slice(1)],
      }),
    ).toEqual(["V-A6a"]);
  });
});

describe("カスタムステータスの色（V-A26）", () => {
  const withCustom = (custom: { name: string; color?: string }) => [
    ...defaultStatuses.slice(0, 3),
    custom,
    ...defaultStatuses.slice(3),
  ];

  it("カスタムステータスに色を書かないと V-A26 で中断する", () => {
    expect(idsOf({ statuses: withCustom({ name: "レビュー中" }) })).toEqual(["V-A26"]);
  });

  it("色を書いたカスタムステータスは通す", () => {
    expect(idsOf({ statuses: withCustom({ name: "レビュー中", color: "#3b9dbd" }) })).toEqual([]);
  });

  it("色が要るのはカスタムステータスだけで、既定ステータスには書かせない", () => {
    expect(
      idsOf({
        statuses: [{ name: "未対応", color: "#3b9dbd" }, ...defaultStatuses.slice(1)],
      }),
    ).toEqual(["V-A6a"]);
    expect(idsOf({ statuses: defaultStatuses })).toEqual([]);
  });

  it("色を書いていないカスタムステータスは1件目で止めずにすべて挙げる", () => {
    expect(
      idsOf({
        statuses: [
          ...defaultStatuses.slice(0, 3),
          { name: "レビュー中" },
          { name: "検証中" },
          ...defaultStatuses.slice(3),
        ],
      }),
    ).toEqual(["V-A26", "V-A26"]);
  });

  it("どのステータスに何を足すのかを名前で伝える", () => {
    const [diagnostic] = validate({ statuses: withCustom({ name: "レビュー中" }) });

    expect(diagnostic).toMatchObject({
      id: "V-A26",
      severity: "error",
      stage: "snapshot",
      path: "statuses/3/color",
    });
    expect(diagnostic?.message).toContain("レビュー中");
    expect(diagnostic?.hint).toContain("レビュー中");
  });

  it("未作成のプロジェクトでもカスタムステータスには色が要る", () => {
    expect(
      idsOf(
        { statuses: withCustom({ name: "レビュー中" }) },
        {
          snapshot: { project: { exists: false } },
          snapshots: { project: { exists: false }, statuses: { source: "defaults" } },
        },
      ),
    ).toEqual(["V-A26"]);
  });
});

describe("ステータスの並び（V-A14）", () => {
  it("未対応が先頭でないと中断する", () => {
    expect(
      idsOf({
        statuses: [{ name: "処理中" }, { name: "未対応" }, { name: "処理済み" }, { name: "完了" }],
      }),
    ).toEqual(["V-A14"]);
  });

  it("処理中が処理済みより後ろにあると中断する", () => {
    expect(
      idsOf({
        statuses: [{ name: "未対応" }, { name: "処理済み" }, { name: "処理中" }, { name: "完了" }],
      }),
    ).toEqual(["V-A14"]);
  });

  it("完了が末尾でないと中断する", () => {
    expect(
      idsOf({ statuses: [...defaultStatuses, { name: "レビュー中", color: "#3b9dbd" }] }),
    ).toEqual(["V-A14"]);
  });

  it("制約を満たす並びは通す", () => {
    expect(
      idsOf({
        statuses: [
          ...defaultStatuses.slice(0, 3),
          { name: "レビュー中", color: "#3b9dbd" },
          { name: "完了" },
        ],
      }),
    ).toEqual([]);
  });

  it("既定ステータスが欠けているときは並びを判定しない", () => {
    expect(idsOf({ statuses: [{ name: "完了" }, { name: "未対応" }, { name: "処理中" }] })).toEqual(
      ["V-A6"],
    );
  });
});

const existing = (settings: ProjectSettingsSnapshot = {}) =>
  ({ exists: true, id: 100, name: "プロジェクトA", settings }) satisfies ProjectSnapshot;

const settingsOf = (settings: Settings, project: ProjectSnapshot) =>
  idsOf({ settings }, { snapshots: { project } });

describe("孫課題の設定（V-A12）", () => {
  it("子課題を明示的に無効にして孫課題を有効にするとエラーになる", () => {
    expect(
      settingsOf({ grandchildIssueEnabled: true, subtaskingEnabled: false }, existing()),
    ).toEqual(["V-A12"]);
  });

  it("どちらも有効ならエラーにならない", () => {
    expect(
      settingsOf({ grandchildIssueEnabled: true, subtaskingEnabled: true }, existing()),
    ).toEqual([]);
  });

  it("子課題の設定を省いても、現状が有効ならエラーにならない", () => {
    expect(
      settingsOf({ grandchildIssueEnabled: true }, existing({ subtaskingEnabled: true })),
    ).toEqual([]);
  });

  it("子課題の設定を省いて現状も無効ならエラーになる", () => {
    const [diagnostic] = validate(
      { settings: { grandchildIssueEnabled: true } },
      { snapshots: { project: existing({ subtaskingEnabled: false }) } },
    );

    expect(diagnostic).toMatchObject({
      id: "V-A12",
      severity: "error",
      stage: "snapshot",
      path: "settings/grandchildIssueEnabled",
    });
    expect(diagnostic?.message).toContain("PROJ_A");
  });

  it("未作成のプロジェクトでは、子課題の設定を省くとエラーになる", () => {
    expect(settingsOf({ grandchildIssueEnabled: true }, { exists: false })).toEqual(["V-A12"]);
  });

  it("未作成のプロジェクトには、現状が無効だとは言わず、読めないと言う", () => {
    const [diagnostic] = validate(
      { settings: { grandchildIssueEnabled: true } },
      { snapshots: { project: { exists: false } } },
    );

    expect(diagnostic?.message).toContain("does not exist yet");
    expect(diagnostic?.message).not.toContain("is not enabled on");
  });

  it("孫課題を有効にしていなければ何も判定しない", () => {
    expect(settingsOf({ subtaskingEnabled: false }, existing())).toEqual([]);
  });

  it("位置情報は持たない", () => {
    const [diagnostic] = validate(
      { settings: { grandchildIssueEnabled: true } },
      { snapshots: { project: { exists: false } } },
    );

    expect(diagnostic).not.toHaveProperty("line");
  });
});

describe("適用課題種別の絞り", () => {
  const limited: ExistingCustomField = {
    id: 10,
    name: "影響範囲",
    typeId: 5,
    applicableIssueTypes: [1],
  };

  it("絞りの解除は止めない", () => {
    expect(
      idsOf(
        { customFields: [{ name: "影響範囲", type: "singleList", items: ["大"] }] },
        {
          snapshots: {
            customFields: { customFields: [limited], issueTypes: [{ id: 1, name: "タスク" }] },
          },
        },
      ),
    ).toEqual([]);
  });
});
