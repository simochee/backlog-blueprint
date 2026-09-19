export type ResourceKind =
  | 'project'
  | 'issueType'
  | 'status'
  | 'category'
  | 'milestone'
  | 'customField'
  | 'projectTeam'
  | 'projectMember'
  | 'projectAdministrator'
  | 'webhook'

export type Op = 'create' | 'update' | 'delete' | 'reorder' | 'refresh' | 'noop'

export type Phase = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
