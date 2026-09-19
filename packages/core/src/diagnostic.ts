export type Diagnostic = {
  id: string
  severity: 'error' | 'warning'
  stage: 'syntax' | 'expand' | 'schema' | 'semantic' | 'auth' | 'snapshot' | 'plan'
  path: string
  line?: number
  column?: number
  message: string
  hint?: string
}
