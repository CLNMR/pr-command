import {DEFAULT_REPOS} from './config'

const REPOS_KEY = 'pr-command:repos'

export function loadRepos(): string[] {
  try {
    const raw = localStorage.getItem(REPOS_KEY)
    if (raw) return JSON.parse(raw) as string[]
  } catch {
    // fall back to the default
  }
  return DEFAULT_REPOS
}

export function saveRepos(repos: string[]) {
  try {
    localStorage.setItem(REPOS_KEY, JSON.stringify(repos))
  } catch {
    // private mode: setting lasts for this tab only
  }
}
