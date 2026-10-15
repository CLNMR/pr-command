export const ORG: string = import.meta.env.VITE_GITHUB_ORG || 'univelop'
// Repos shown by default; overridable per device in the app's settings.
export const DEFAULT_REPOS: string[] = (import.meta.env.VITE_REPOS ?? 'aya')
  .split(',')
  .map((r: string) => r.trim())
  .filter(Boolean)
export const MERGE_METHOD = (import.meta.env.VITE_MERGE_METHOD || 'SQUASH') as 'SQUASH' | 'MERGE' | 'REBASE'

// Must match the labels and workflow file used in univelop/.github (see github-workflows/).
export const LABEL_READY = 'ready-to-merge'
export const LABEL_ATTENTION = 'needs-attention'
export const LABEL_MERGE_AGENT = 'merge-agent-running'
// Set by the app when it starts a Claude session; cleared when the PR is marked mergeable.
export const LABEL_AGENT = 'agent-session'
export const WORKFLOW_FILE = 'pr-command.yml'

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
}
export const firebaseEnabled = Boolean(firebaseConfig.apiKey)
