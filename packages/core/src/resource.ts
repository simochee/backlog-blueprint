export const RESOURCE_KINDS = [
  "project",
  "issueType",
  /**
   * 余った既定課題種別の枠を `issueType` の名前空間で指さない。位置でしか指せない枠が
   * 利用者の付けた名前と重なり、黙って別の枠を書き換える（§2.1 / §4.1）。
   */
  "issueTypeSlot",
  "status",
  "category",
  "milestone",
  "customField",
  "projectTeam",
  "projectMember",
  "projectAdministrator",
  "webhook",
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export type Op = "create" | "update" | "delete" | "reorder" | "refresh" | "noop";

export type Phase = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
