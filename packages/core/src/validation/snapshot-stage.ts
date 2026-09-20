import { type Diagnostic } from "../diagnostic";
import { type Manifest, type Status } from "../manifest";
import { type ResourceSnapshots } from "../plan";
import { type AccessSnapshot } from "../resources/access";
import { type ProjectSnapshot } from "../resources/project";
import {
  DEFAULT_STATUSES_EN,
  DEFAULT_STATUSES_JA,
  matchDefaultStatuses,
  type ExistingStatus,
  type StatusesSnapshot,
} from "../resources/statuses";
import { type Snapshot } from "../snapshot";

/**
 * 位置を持たせない（DG-5）。S6 の判定はマニフェストだけでは成り立たず、
 * 行を指しても「そこを直せ」にならない場合がある。
 */
const snapshotDiagnostic = (
  id: string,
  path: string,
  message: string,
  hint: string,
): Diagnostic => ({ id, severity: "error", stage: "snapshot", path, message, hint });

/**
 * 既定ステータスの ID は全プロジェクト共通の固定値で、スペースの言語設定にも
 * プロジェクトにも依存しない（API 制約「ステータス」）。既定かどうかは ID で判定し、
 * 名前の一致では判定しない。
 */
const DEFAULT_STATUS_IDS = new Set(DEFAULT_STATUSES_JA.map(({ id }) => id));

const FIRST_STATUS_ID = 1;
const IN_PROGRESS_STATUS_ID = 2;
const RESOLVED_STATUS_ID = 3;
const LAST_STATUS_ID = 4;

const nameList = (statuses: ExistingStatus[]): string =>
  statuses.map(({ name }) => name).join(", ");

/**
 * 既定ステータスの出どころを1箇所にする。既存プロジェクトは `GET` が実名を返すので
 * スナップショットの ID 1〜4 が答えで、未作成のプロジェクトだけが日英2組の表を引く
 * （API 制約「既定リソースの表示名」）。
 */
const defaultStatuses = (
  declaredNames: string[],
  snapshot: StatusesSnapshot,
): ExistingStatus[] | undefined =>
  snapshot.source === "project"
    ? snapshot.statuses.filter(({ id }) => DEFAULT_STATUS_IDS.has(id))
    : matchDefaultStatuses(declaredNames);

const missingDefaultSet = (projectKey: string): Diagnostic =>
  snapshotDiagnostic(
    "V-A6",
    "statuses",
    `statuses does not list the four default statuses, and ${projectKey} does not exist yet, so their display names cannot be read`,
    `default statuses cannot be created or deleted. list the set that matches the space language: ${nameList(DEFAULT_STATUSES_JA)} / ${nameList(DEFAULT_STATUSES_EN)}`,
  );

const missingDefaults = (declaredNames: string[], defaults: ExistingStatus[]): Diagnostic[] =>
  defaults
    .filter(({ name }) => !declaredNames.includes(name))
    .map(({ name }) =>
      snapshotDiagnostic(
        "V-A6",
        "statuses",
        `missing default status: ${name}`,
        `add "${name}" to statuses. default statuses cannot be deleted or renamed`,
      ),
    );

/**
 * 既定ステータスの色は10色パレットの外にある特別な値で、API は変更を受け付けない
 * （API 制約「ステータス」）。`oldname` も同じ理由で書けない。
 */
const defaultStatusFields = (declared: Status, index: number): Diagnostic[] => [
  ...(declared.color === undefined
    ? []
    : [
        snapshotDiagnostic(
          "V-A6a",
          `statuses/${index}/color`,
          `the color of the default status "${declared.name}" cannot be changed`,
          "remove the color",
        ),
      ]),
  ...(declared.oldname === undefined
    ? []
    : [
        snapshotDiagnostic(
          "V-A6a",
          `statuses/${index}/oldname`,
          `the default status "${declared.name}" cannot be renamed`,
          "remove the oldname",
        ),
      ]),
];

/**
 * `POST /projects/:key/statuses` は `color` を必須パラメータに取る（API 制約「ステータス」）。
 * スキーマの `required` に入れられないのは、既定に `color` を書くことを V-A6a が禁じており、
 * どれが既定かを ID でしか判定できない（K-5）ためである。
 */
const customStatusFields = (declared: Status, index: number): Diagnostic[] =>
  declared.color === undefined
    ? [
        snapshotDiagnostic(
          "V-A26",
          `statuses/${index}/color`,
          `the status "${declared.name}" is not a default status, so it needs a color`,
          `add a color from the 10-color palette to "${declared.name}"`,
        ),
      ]
    : [];

type DeclaredDefault = { name: string; position: number };

const declaredDefaults = (
  declaredNames: string[],
  defaults: ExistingStatus[],
): Map<number, DeclaredDefault> =>
  new Map(
    defaults.flatMap(({ id, name }) => {
      const position = declaredNames.indexOf(name);

      return position === -1 ? [] : [[id, { name, position }] as const];
    }),
  );

/**
 * 並びの制約も ID で判定する（API 制約「ステータス」）。「未対応が先頭」を名前で
 * 判定すると、表示名が日本語以外のスペースで成り立たない。
 */
const statusOrder = (positions: Map<number, DeclaredDefault>, total: number): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const first = positions.get(FIRST_STATUS_ID);
  const inProgress = positions.get(IN_PROGRESS_STATUS_ID);
  const resolved = positions.get(RESOLVED_STATUS_ID);
  const last = positions.get(LAST_STATUS_ID);

  if (first !== undefined && first.position !== 0) {
    diagnostics.push(
      snapshotDiagnostic(
        "V-A14",
        `statuses/${first.position}`,
        `"${first.name}" must come first`,
        `move "${first.name}" to the top of statuses`,
      ),
    );
  }

  if (
    inProgress !== undefined &&
    resolved !== undefined &&
    inProgress.position > resolved.position
  ) {
    diagnostics.push(
      snapshotDiagnostic(
        "V-A14",
        `statuses/${inProgress.position}`,
        `"${inProgress.name}" must come before "${resolved.name}"`,
        `move "${inProgress.name}" above "${resolved.name}"`,
      ),
    );
  }

  if (last !== undefined && last.position !== total - 1) {
    diagnostics.push(
      snapshotDiagnostic(
        "V-A14",
        `statuses/${last.position}`,
        `"${last.name}" must come last`,
        `move "${last.name}" to the bottom of statuses`,
      ),
    );
  }

  return diagnostics;
};

const statusDiagnostics = (manifest: Manifest, snapshot: StatusesSnapshot): Diagnostic[] => {
  const declaredNames = manifest.statuses.map(({ name }) => name);
  const defaults = defaultStatuses(declaredNames, snapshot);

  /**
   * どれが既定か決まらないときは V-A6 だけを出す。既定と自作の区別が付かないまま
   * V-A6a / V-A26 / V-A14 を走らせると、既定を指すべき指摘が利用者の自作ステータスに
   * 付き、直しようのないエラーになる。
   */
  if (defaults === undefined) {
    return [missingDefaultSet(manifest.key)];
  }

  const defaultNames = new Set(defaults.map(({ name }) => name));
  const missing = missingDefaults(declaredNames, defaults);

  return [
    ...missing,
    ...manifest.statuses.flatMap((declared, index) =>
      defaultNames.has(declared.name)
        ? defaultStatusFields(declared, index)
        : customStatusFields(declared, index),
    ),
    ...(missing.length > 0
      ? []
      : statusOrder(declaredDefaults(declaredNames, defaults), declaredNames.length)),
  ];
};

const issueCount = (manifest: Manifest, snapshot: Snapshot): Diagnostic[] =>
  snapshot.project.exists && snapshot.project.issueCount > 0
    ? [
        snapshotDiagnostic(
          "V-B3",
          "key",
          `${manifest.key} already has issues (${snapshot.project.issueCount} in total)`,
          "only projects with zero issues can be targeted",
        ),
      ]
    : [];

/**
 * 課題件数を確認できなかった場合の V-B3（VP-5）。`Snapshot` の課題件数は必須の
 * `number` なので「確認できなかった」はスナップショットとして表せず、判定できるのは
 * 取得を行う側だけである。文言を件数0でない場合と同じ場所に置くために公開する。
 */
export const unconfirmedIssueCount = (projectKey: string, detail: string): Diagnostic =>
  snapshotDiagnostic(
    "V-B3",
    "key",
    `the issue count of ${projectKey} could not be confirmed: ${detail}`,
    "only projects whose issue count is confirmed to be zero can be targeted",
  );

const spaceMembers = (manifest: Manifest, access: AccessSnapshot): Diagnostic[] => {
  const userIds = new Set(access.spaceUsers.map(({ userId }) => userId));
  const teamNames = new Set(access.spaceTeams.map(({ name }) => name));

  return [
    ...(["members", "administrators"] as const).flatMap((section) =>
      manifest.access[section].flatMap((userId, index) =>
        userIds.has(userId)
          ? []
          : [
              snapshotDiagnostic(
                "V-B4",
                `access/${section}/${index}`,
                `no user with the id "${userId}" exists in this space`,
                "write the user id used to sign in, not the display name",
              ),
            ],
      ),
    ),
    ...manifest.access.teams.flatMap((name, index) =>
      teamNames.has(name)
        ? []
        : [
            snapshotDiagnostic(
              "V-B5",
              `access/teams/${index}`,
              `no team named "${name}" exists in this space`,
              "create the team in the space first. this tool does not create teams",
            ),
          ],
    ),
  ];
};

/**
 * 省略された `subtaskingEnabled` を `false` と見なさない（K-3）。送らなければ現状が
 * 保たれるので、真かどうかは現状を見なければ決まらない。現状を持たない S4 に
 * 置けないのはこのためである。
 */
const currentSubtasking = (project: ProjectSnapshot): boolean | undefined =>
  project.exists ? project.settings.subtaskingEnabled === true : undefined;

const grandchildIssues = (manifest: Manifest, project: ProjectSnapshot): Diagnostic[] => {
  const { grandchildIssueEnabled, subtaskingEnabled } = manifest.settings;

  if (grandchildIssueEnabled !== true) {
    return [];
  }

  const effective = subtaskingEnabled ?? currentSubtasking(project);

  if (effective === true) {
    return [];
  }

  /**
   * 未作成のプロジェクトで省略された場合もエラーにする。送らないキーの値を決めるのは
   * Backlog であり、ツールがその既定を持たない（K-3）以上、真であることを確認できない。
   * 現状が無いことと、現状が偽であることは別なのでメッセージも分ける。
   */
  const message = (): string => {
    if (subtaskingEnabled !== undefined) {
      return "grandchildIssueEnabled requires subtaskingEnabled to be true";
    }

    return project.exists
      ? `grandchildIssueEnabled requires subtaskingEnabled, which is not declared and is not enabled on ${manifest.key}`
      : `grandchildIssueEnabled requires subtaskingEnabled, which is not declared, and ${manifest.key} does not exist yet, so its current value cannot be read`;
  };

  return [
    snapshotDiagnostic(
      "V-A12",
      "settings/grandchildIssueEnabled",
      message(),
      "set settings.subtaskingEnabled to true, or set settings.grandchildIssueEnabled to false",
    ),
  ];
};

export type SnapshotStageInput = {
  manifest: Manifest;
  snapshot: Snapshot;
  snapshots: ResourceSnapshots;
};

export const validateAgainstSnapshot = ({
  manifest,
  snapshot,
  snapshots,
}: SnapshotStageInput): Diagnostic[] => [
  ...issueCount(manifest, snapshot),
  ...spaceMembers(manifest, snapshots.access),
  ...statusDiagnostics(manifest, snapshots.statuses),
  ...grandchildIssues(manifest, snapshots.project),
];
