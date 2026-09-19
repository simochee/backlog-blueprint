export const RESOURCE_KINDS = [
  "project",
  "issueType",
  /**
   * `Action.kind` には現れない。解決表のキーを分けるためだけの種別である（§2.1）。
   * 新規プロジェクトで余った既定課題種別の枠は対応する名前を持たず位置で指すしかなく、
   * 利用者の付けた名前と同じ名前空間に置くと黙って別の枠を書き換える（§4.1）。
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
