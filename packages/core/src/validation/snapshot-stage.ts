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
import { SPACE_ADMINISTRATOR_ROLE_TYPE } from "./auth-stage";

/**
 * 位置を持たせない（DG-5）。S6 の判定はマニフェストだけでは成り立たず、行を指しても
 * 「そこを直せ」にならない場合がある。
 */
const snapshotDiagnostic = (
  id: string,
  path: string,
  message: string,
  hint: string,
): Diagnostic => ({ id, severity: "error", stage: "snapshot", path, message, hint });

/**
 * 既定かどうかを名前で判定しない。表示名はスペースの言語で変わり、ID は変わらない
 * （API 制約「ステータス」）。
 */
const DEFAULT_STATUS_IDS = new Set(DEFAULT_STATUSES_JA.map(({ id }) => id));

const FIRST_STATUS_ID = 1;
const IN_PROGRESS_STATUS_ID = 2;
const RESOLVED_STATUS_ID = 3;
const LAST_STATUS_ID = 4;

const nameList = (statuses: ExistingStatus[]): string =>
  statuses.map(({ name }) => name).join(", ");

/**
 * 日英2組の表を引くのは未作成のプロジェクトだけにする。既存プロジェクトの実名は
 * スナップショットにあり、表と食い違いうる（API 制約「既定リソースの表示名」）。
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
 * スキーマの `required` に入れない。既定には `color` を書けず（V-A6a）、どれが既定かは
 * ID でしか判定できない（K-5）。
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
 * 「未対応が先頭」を名前で判定しない。表示名が日本語以外のスペースで成り立たない
 * （API 制約「ステータス」）。
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

  // 既定が決まらないまま V-A6a / V-A26 / V-A14 を走らせない。既定を指すべき指摘が
  // 利用者の自作ステータスに付き、直しようのないエラーになる。
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
 * 「確認できなかった」は `Snapshot` で表せず（VP-5）、判定は取得する側が行う。
 * 文言を件数0でない場合と同じ場所に置くためだけに公開する。
 */
export const unconfirmedIssueCount = (projectKey: string, detail: string): Diagnostic =>
  snapshotDiagnostic(
    "V-B3",
    "key",
    `the issue count of ${projectKey} could not be confirmed: ${detail}`,
    "only projects whose issue count is confirmed to be zero can be targeted",
  );

const spaceMembers = (manifest: Manifest, access: AccessSnapshot): Diagnostic[] => {
  const userIds = new Set(access.spaceUsers.map(({ id }) => id));
  const teamIds = new Set(access.spaceTeams.map(({ id }) => id));

  return [
    ...(["members", "administrators"] as const).flatMap((section) =>
      manifest.access[section].flatMap((id, index) =>
        userIds.has(id)
          ? []
          : [
              snapshotDiagnostic(
                "V-B4",
                `access/${section}/${index}`,
                `no user with the id ${id} exists in this space`,
                "copy the numeric user id from the Users pane of the Web UI, or from export",
              ),
            ],
      ),
    ),
    ...manifest.access.teams.flatMap((id, index) =>
      teamIds.has(id)
        ? []
        : [
            snapshotDiagnostic(
              "V-B5",
              `access/teams/${index}`,
              `no team with the id ${id} exists in this space`,
              "copy the id from the Teams pane of the Web UI, or from export. this tool does not create teams",
            ),
          ],
    ),
  ];
};

const spaceAdministrators = (manifest: Manifest, access: AccessSnapshot): Diagnostic[] => {
  const administrators = new Map(
    access.spaceUsers
      .filter(({ roleType }) => roleType === SPACE_ADMINISTRATOR_ROLE_TYPE)
      .map(({ id, name }) => [id, name || `#${id}`]),
  );

  return manifest.access.administrators.flatMap((id, index) => {
    const name = administrators.get(id);

    return name === undefined
      ? []
      : [
          snapshotDiagnostic(
            "V-B11",
            `access/administrators/${index}`,
            `"${name}" (${id}) is a space administrator, and a space administrator cannot be a project administrator`,
            `remove ${id} from access.administrators. to keep them in the project, write ${id} under access.members instead: a space administrator can operate the project without joining it`,
          ),
        ];
  });
};

/**
 * 省略された `subtaskingEnabled` を `false` と見なさない（K-3）。送らなければ現状が保たれる
 * ので、現状を持たない S4 には置けない。
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

  // 未作成のプロジェクトで省略されたときも通さない。送らないキーの値を決めるのは Backlog で、
  // ツールはその既定を持たない（K-3）。
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
  ...spaceAdministrators(manifest, snapshots.access),
  ...statusDiagnostics(manifest, snapshots.statuses),
  ...grandchildIssues(manifest, snapshots.project),
];
