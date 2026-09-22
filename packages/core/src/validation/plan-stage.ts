import { type Action } from "../action";
import { type Diagnostic } from "../diagnostic";
import { type Manifest } from "../manifest";
import { type ResourceSnapshots } from "../plan";
import { declaredOrder, FIXED_ORDER_SECTIONS, type ResourceOrder } from "../resulting-order";
import { type ResourceKind } from "../resource";
import { type AccessSnapshot } from "../resources/access";
import { type Snapshot } from "../snapshot";
import { type Value } from "../value";
import { ROOT_PATH } from "./source-map";

const planDiagnostic =
  (severity: Diagnostic["severity"]) =>
  (id: string, path: string, message: string, hint: string): Diagnostic => ({
    id,
    severity,
    stage: "plan",
    path,
    message,
    hint,
  });

const error = planDiagnostic("error");

const warning = planDiagnostic("warning");

const ofKind = (actions: Action[], kind: ResourceKind): Action[] =>
  actions.filter((action) => action.kind === kind);

const selfExclusion = (actions: Action[], snapshot: Snapshot): Diagnostic[] => {
  const revoked = ofKind(actions, "projectAdministrator").find(
    (action) => action.op === "delete" && action.target === snapshot.executor.id,
  );

  return revoked === undefined
    ? []
    : [
        error(
          "V-B6",
          "access/administrators",
          `the plan revokes the project administrator role of "${revoked.name}", who is running this`,
          `add "${revoked.name}" to access.administrators`,
        ),
      ];
};

/** 振替先を要求する削除 API は課題種別とステータスの2つだけ（要件定義 §6） */
const SUBSTITUTE_PARAMS: Record<string, string> = {
  substituteIssueTypeId: "issueTypes",
  substituteStatusId: "statuses",
};

/**
 * 振替先が削除対象自身かは、`Ref` の名前が削除対象の名前と一致するかで判定する（§5.2）。
 * 解決表を引いて ID まで確かめる形にはしない。それは未採用の V-C1（参照解決の
 * シミュレーション）を一部だけ持ち込むことになる。
 */
const pointsAtSelf = (action: Action, substitute: Value): boolean => {
  if (typeof substitute === "number") {
    return action.target === substitute;
  }

  return (
    typeof substitute === "object" &&
    substitute !== null &&
    "$ref" in substitute &&
    substitute.$ref.kind === action.kind &&
    substitute.$ref.name === action.name
  );
};

const substitutes = (actions: Action[]): Diagnostic[] =>
  actions
    .filter(({ op }) => op === "delete")
    .flatMap((action) =>
      Object.entries(action.request?.params ?? {}).flatMap(([field, value]) => {
        const section = SUBSTITUTE_PARAMS[field];

        return section === undefined || !pointsAtSelf(action, value)
          ? []
          : [
              error(
                "V-B7",
                section,
                `"${action.name}" is being deleted, and the substitute for it is itself`,
                "declare at least one entry that is not deleted, so that the deletion has a substitute",
              ),
            ];
      }),
    );

const sameOrder = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((name, index) => name === right[index]);

const displayOrder = (manifest: Manifest, order: ResourceOrder): Diagnostic[] => {
  const declared = declaredOrder(manifest);

  return FIXED_ORDER_SECTIONS.flatMap((section) =>
    sameOrder(declared[section], order[section])
      ? []
      : [
          warning(
            "V-A15",
            section,
            `resulting order differs from manifest: ${order[section].join(", ")}`,
            "New items are always appended after existing ones; there is no reorder API.",
          ),
        ],
  );
};

/**
 * 畳まずに警告だけ出す（L-4 / A-4）。書かれた人を黙って落とすと、`members` に
 * 書いたのに個人参加として登録されない食い違いが生まれる。
 */
const teamMembers = (manifest: Manifest, access: AccessSnapshot): Diagnostic[] => {
  const declaredTeams = new Set(manifest.access.teams);
  const joinedThrough = new Map<string, string>();

  for (const team of access.spaceTeams.filter(({ id }) => declaredTeams.has(id))) {
    for (const member of team.members) {
      joinedThrough.set(member.userId, team.name);
    }
  }

  return manifest.access.members.flatMap((userId, index) => {
    const team = joinedThrough.get(userId);

    return team === undefined
      ? []
      : [
          warning(
            "V-A16",
            `access/members/${index}`,
            `"${userId}" already joins the project through the team "${team}"`,
            `remove "${userId}" from access.members to save one request. leaving it there also works`,
          ),
        ];
  });
};

const rateLimit = (snapshot: Snapshot, actions: Action[]): Diagnostic[] => {
  const writes = actions.filter(({ writeRequest }) => writeRequest).length;
  const { limit, remaining } = snapshot.updateRateLimit;

  return writes <= remaining
    ? []
    : [
        warning(
          "V-B8",
          ROOT_PATH,
          `the plan needs ${writes} update requests, but only ${remaining} of ${limit} are left in the current window`,
          "wait for the rate limit to reset before applying, or the run will pause on 429",
        ),
      ];
};

export type PlanStageInput = {
  manifest: Manifest;
  snapshot: Snapshot;
  snapshots: ResourceSnapshots;
  actions: Action[];
  /** 描画に出すものと同じ値で判定する（plan の出力仕様 §1.4） */
  order: ResourceOrder;
};

/**
 * ネットワークを使わない（S7）。`plan()` が純粋関数である（C-2）以上、計画を
 * 根拠にする検証も追加の GET を必要としない。
 */
export const validatePlan = ({
  manifest,
  snapshot,
  snapshots,
  actions,
  order,
}: PlanStageInput): Diagnostic[] => [
  ...selfExclusion(actions, snapshot),
  ...substitutes(actions),
  ...displayOrder(manifest, order),
  ...teamMembers(manifest, snapshots.access),
  ...rateLimit(snapshot, actions),
];
