import { type ResolutionKey, type ResolutionTable } from "./resolution";
import { type AccessSnapshot } from "./resources/access";
import { type CategoriesSnapshot } from "./resources/categories";
import { type CustomFieldsSnapshot } from "./resources/custom-fields";
import { type IssueTypesSnapshot } from "./resources/issue-types";
import { type MilestonesSnapshot } from "./resources/milestones";
import { type ProjectSnapshot } from "./resources/project";
import { type StatusesSnapshot } from "./resources/statuses";
import { type WebhooksSnapshot } from "./resources/webhooks";

export type ResourceSnapshots = {
  projectKey: string;
  project: ProjectSnapshot;
  issueTypes: IssueTypesSnapshot;
  statuses: StatusesSnapshot;
  categories: CategoriesSnapshot;
  milestones: MilestonesSnapshot;
  customFields: CustomFieldsSnapshot;
  access: AccessSnapshot;
  webhooks: WebhooksSnapshot;
};

/**
 * 既存リソースの名前 → ID を、各 reconciler ではなく `plan()` を呼ぶ側がまとめて
 * 登録する（§3.2）。reconciler 側で登録する形にすると、自分のスナップショットしか
 * 知らない reconciler が他フェーズのために解決表を書くことになり、
 * 「reconciler どうしは互いを知らない」（§6）が崩れる。
 *
 * これが無いと、既存プロジェクトの `applicableIssueTypes` が指す課題種別は
 * どの Action の `provides` にも現れず（変更が無ければ `noop` なので）、
 * 適用の実行時に未解決参照で中断する。
 */
export const seedResolutions = (snapshots: ResourceSnapshots): ResolutionTable => {
  const resolutions: ResolutionTable = new Map<ResolutionKey, number>();

  const put = (key: ResolutionKey, id: number): void => {
    resolutions.set(key, id);
  };

  if (snapshots.project.exists) {
    put(`project:${snapshots.projectKey}`, snapshots.project.id);
  }

  if (snapshots.issueTypes.source === "project") {
    for (const { id, name } of snapshots.issueTypes.issueTypes) {
      put(`issueType:${name}`, id);
    }
  }

  for (const { id, name } of snapshots.statuses) {
    put(`status:${name}`, id);
  }

  for (const { id, name } of snapshots.categories) {
    put(`category:${name}`, id);
  }

  for (const { id, name } of snapshots.milestones) {
    put(`milestone:${name}`, id);
  }

  for (const { id, name } of snapshots.customFields.customFields) {
    put(`customField:${name}`, id);
  }

  for (const { id, name } of snapshots.webhooks) {
    put(`webhook:${name}`, id);
  }

  /**
   * チームと利用者はプロジェクトの参加者ではなくスペース全体から登録する。
   * フェーズ7が指すのは「これから参加させる」相手で、プロジェクト側にはまだ居ない。
   */
  for (const { id, name } of snapshots.access.spaceTeams) {
    put(`projectTeam:${name}`, id);
  }

  for (const { id, userId } of snapshots.access.spaceUsers) {
    put(`projectMember:${userId}`, id);
    put(`projectAdministrator:${userId}`, id);
  }

  return resolutions;
};
