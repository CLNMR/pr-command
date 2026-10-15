import {LABEL_AGENT, LABEL_ATTENTION, LABEL_MERGE_AGENT, LABEL_READY, MERGE_METHOD, ORG, WORKFLOW_FILE} from './config'

let token = ''
export function setToken(t: string) {
  token = t
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const data = await res.json()
      if (data.message) message = `${data.message} (${res.status})`
    } catch {
      // keep status text
    }
    throw new GitHubError(message, res.status)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const data = await request<{data?: T; errors?: {message: string}[]}>('POST', '/graphql', {query, variables})
  if (data.errors?.length) throw new GitHubError(data.errors.map(e => e.message).join('; '), 200)
  return data.data as T
}

// ---------- Types ----------

export type PRStatus = 'attention' | 'merge-agent' | 'queued' | 'agent' | 'open'

export interface Session {
  url: string
  at: string
}

export interface PR {
  id: string
  key: string // "repo#number"
  number: number
  title: string
  url: string
  body: string
  bodyHTML: string
  isDraft: boolean
  additions: number
  deletions: number
  changedFiles: number
  commitCount: number
  createdAt: string
  updatedAt: string
  headRefName: string
  baseRefName: string
  repo: string
  defaultBranch: string
  labels: {name: string; color: string}[]
  autoMerge: boolean
  status: PRStatus
  sessions: Session[]
  sessionError: {at: string; body: string} | null
}

export interface Commit {
  oid: string
  shortOid: string
  headline: string
  url: string
  date: string
  author: string
}

export interface Viewer {
  login: string
  avatarUrl: string
}

// ---------- Comment markers written by the univelop/.github workflows ----------

const SESSION_RE = /<!-- pr-command:session (\{.*?\}) -->/
const SESSION_ERROR = '<!-- pr-command:session-error -->'
const WARNING_BLOCK_RE = /<!-- pr-command:warning:start -->[\s\S]*?<!-- pr-command:warning:end -->\s*/g

function deriveStatus(labels: string[]): PRStatus {
  if (labels.includes(LABEL_ATTENTION)) return 'attention'
  if (labels.includes(LABEL_MERGE_AGENT)) return 'merge-agent'
  if (labels.includes(LABEL_READY)) return 'queued'
  if (labels.includes(LABEL_AGENT)) return 'agent'
  return 'open'
}

// ---------- Queries ----------

const PR_FIELDS = `
  id number title url body bodyHTML isDraft additions deletions changedFiles createdAt updatedAt
  headRefName baseRefName
  repository { name defaultBranchRef { name } }
  labels(first: 20) { nodes { name color } }
  autoMergeRequest { enabledAt }
  commits { totalCount }
  comments(last: 40) { nodes { body createdAt } }
`

interface RawPR {
  id: string
  number: number
  title: string
  url: string
  body: string
  bodyHTML: string
  isDraft: boolean
  additions: number
  deletions: number
  changedFiles: number
  createdAt: string
  updatedAt: string
  headRefName: string
  baseRefName: string
  repository: {name: string; defaultBranchRef: {name: string} | null}
  labels: {nodes: {name: string; color: string}[]}
  autoMergeRequest: {enabledAt: string} | null
  commits: {totalCount: number}
  comments: {nodes: {body: string; createdAt: string}[]}
}

function toPR(raw: RawPR): PR {
  const labels = raw.labels.nodes
  const sessions: Session[] = []
  let sessionError: PR['sessionError'] = null
  for (const c of raw.comments.nodes) {
    const m = c.body.match(SESSION_RE)
    if (m) {
      try {
        const data = JSON.parse(m[1]) as {url: string}
        sessions.push({url: data.url, at: c.createdAt})
      } catch {
        // malformed marker
      }
    } else if (c.body.includes(SESSION_ERROR)) {
      sessionError = {at: c.createdAt, body: c.body.replace(SESSION_ERROR, '').trim()}
    }
  }
  sessions.reverse() // newest first
  if (sessionError && sessions[0] && sessions[0].at > sessionError.at) sessionError = null
  let status = deriveStatus(labels.map(l => l.name))
  // The last session failed to start: nothing is running, so the PR needs a decision again.
  if (status === 'agent' && sessionError) status = 'open'
  return {
    id: raw.id,
    key: `${raw.repository.name}#${raw.number}`,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    body: raw.body,
    bodyHTML: raw.bodyHTML,
    isDraft: raw.isDraft,
    additions: raw.additions,
    deletions: raw.deletions,
    changedFiles: raw.changedFiles,
    commitCount: raw.commits.totalCount,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    repo: raw.repository.name,
    defaultBranch: raw.repository.defaultBranchRef?.name ?? 'main',
    labels,
    autoMerge: Boolean(raw.autoMergeRequest),
    status,
    sessions,
    sessionError,
  }
}

export async function fetchViewer(): Promise<Viewer> {
  const data = await gql<{viewer: Viewer}>(`query { viewer { login avatarUrl } }`)
  return data.viewer
}

/** Open PRs by the viewer in the given repos (all org repos if empty). */
export async function fetchMyPRs(repos: string[]): Promise<PR[]> {
  const scope = repos.length ? repos.map(r => `repo:${ORG}/${r}`).join(' ') : `org:${ORG}`
  const q = `is:pr is:open author:@me ${scope} archived:false sort:updated-desc`
  const data = await gql<{search: {nodes: RawPR[]}}>(
    `query($q: String!) { search(query: $q, type: ISSUE, first: 100) { nodes { ... on PullRequest { ${PR_FIELDS} } } } }`,
    {q},
  )
  return data.search.nodes.filter(n => n && n.id).map(toPR)
}

/** Org repos the viewer has open PRs in, with counts (for the repo settings). */
export async function fetchRepoCandidates(): Promise<{name: string; count: number}[]> {
  const data = await gql<{search: {nodes: {repository?: {name: string}}[]}}>(
    `query($q: String!) { search(query: $q, type: ISSUE, first: 100) { nodes { ... on PullRequest { repository { name } } } } }`,
    {q: `is:pr is:open author:@me org:${ORG} archived:false`},
  )
  const counts = new Map<string, number>()
  for (const n of data.search.nodes) {
    if (n.repository) counts.set(n.repository.name, (counts.get(n.repository.name) ?? 0) + 1)
  }
  return [...counts].map(([name, count]) => ({name, count})).sort((a, b) => b.count - a.count)
}

export async function fetchCommits(repo: string, number: number): Promise<Commit[]> {
  const data = await gql<{
    repository: {
      pullRequest: {
        commits: {
          nodes: {
            commit: {
              oid: string
              abbreviatedOid: string
              messageHeadline: string
              url: string
              committedDate: string
              author: {name: string; user: {login: string} | null} | null
            }
          }[]
        }
      }
    }
  }>(
    `query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
        commits(last: 100) { nodes { commit {
          oid abbreviatedOid messageHeadline url committedDate author { name user { login } }
        } } }
      } }
    }`,
    {owner: ORG, repo, number},
  )
  return data.repository.pullRequest.commits.nodes
    .map(({commit: c}) => ({
      oid: c.oid,
      shortOid: c.abbreviatedOid,
      headline: c.messageHeadline,
      url: c.url,
      date: c.committedDate,
      author: c.author?.user?.login ?? c.author?.name ?? 'unknown',
    }))
    .reverse()
}

// ---------- Mutations ----------

export async function closePR(pr: PR) {
  await request('PATCH', `/repos/${ORG}/${pr.repo}/pulls/${pr.number}`, {state: 'closed'})
}

/**
 * Hand the PR over to GitHub: label it, enable native auto-merge (or merge right away
 * if it is already clean). Anything that blocks the merge is picked up by the
 * pr-command merge workflow, which reacts to the label.
 */
export async function markMergeable(pr: PR) {
  if (pr.isDraft) {
    await gql(`mutation($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) { clientMutationId } }`, {
      id: pr.id,
    })
  }

  // Coming back from "needs attention": drop the warning block and the label.
  const cleanedBody = pr.body.replace(WARNING_BLOCK_RE, '')
  if (cleanedBody !== pr.body) {
    await request('PATCH', `/repos/${ORG}/${pr.repo}/pulls/${pr.number}`, {body: cleanedBody})
  }
  await removeLabels(pr, [LABEL_ATTENTION, LABEL_AGENT])

  try {
    await gql(
      `mutation($id: ID!, $method: PullRequestMergeMethod!) {
        enablePullRequestAutoMerge(input: {pullRequestId: $id, mergeMethod: $method}) { clientMutationId }
      }`,
      {id: pr.id, method: MERGE_METHOD},
    )
  } catch (e) {
    // Auto-merge refuses PRs that could be merged right now ("clean status").
    if (e instanceof GitHubError && /clean status/i.test(e.message)) {
      try {
        await gql(
          `mutation($id: ID!, $method: PullRequestMergeMethod!) {
            mergePullRequest(input: {pullRequestId: $id, mergeMethod: $method}) { clientMutationId }
          }`,
          {id: pr.id, method: MERGE_METHOD},
        )
        return
      } catch {
        // e.g. blocked by branch protection: fall through to the label
      }
    }
    // Auto-merge disabled for the repo, conflicts, …: the workflow takes it from here.
  }

  await request('POST', `/repos/${ORG}/${pr.repo}/issues/${pr.number}/labels`, {labels: [LABEL_READY]})
}

async function removeLabels(pr: PR, names: string[]) {
  for (const name of names) {
    if (pr.labels.some(l => l.name === name)) {
      await request('DELETE', `/repos/${ORG}/${pr.repo}/issues/${pr.number}/labels/${encodeURIComponent(name)}`).catch(
        () => {},
      )
    }
  }
}

/**
 * Starts the pr-command workflow, which fires the repo's claude.ai routine, and labels the
 * PR so it waits under "With agent" until you come back and decide.
 */
export async function startSession(pr: PR, instruction: string) {
  try {
    await request('POST', `/repos/${ORG}/${pr.repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
      ref: pr.defaultBranch,
      inputs: {pr: String(pr.number), instruction},
    })
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) {
      throw new Error(`${WORKFLOW_FILE} is not installed on ${pr.repo}'s default branch`)
    }
    throw e
  }
  await request('POST', `/repos/${ORG}/${pr.repo}/issues/${pr.number}/labels`, {labels: [LABEL_AGENT]})
  // The agent is on it now; the warning block stays in the description as context.
  await removeLabels(pr, [LABEL_ATTENTION])
}
