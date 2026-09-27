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
 * 各 reconciler に登録させない。自分のスナップショットしか知らない reconciler が他フェーズの
 * ために解決表を書くことになり、reconciler どうしが互いを知らない形（§6）が崩れる（§3.2）。
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

  // 未作成のプロジェクトの既定ステータスは登録しない。計画が選んだ表示名の組は推測でしかなく、
  // 実名は RF-1 の `refresh` が登録する（API 制約「既定リソースの表示名」）。
  if (snapshots.statuses.source === "project") {
    for (const { id, name } of snapshots.statuses.statuses) {
      put(`status:${name}`, id);
    }
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

  return resolutions;
};
