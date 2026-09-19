export const RESOURCE_KINDS = [
  'project',
  'issueType',
  'status',
  'category',
  'milestone',
  'customField',
  'projectTeam',
  'projectMember',
  'projectAdministrator',
  'webhook',
] as const

export type ResourceKind = (typeof RESOURCE_KINDS)[number]

export type Op = 'create' | 'update' | 'delete' | 'reorder' | 'refresh' | 'noop'

export type Phase = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
