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
  mergeRuns: Session[] // merge agent workflow runs, newest first
  sessionError: {at: string; body: string} | null
  headOid: string
  preview: Preview | null
}

/**
 * Preview deployment by aya's Preview Deploy workflow, which reacts to a "/deploy-preview"
 * comment and answers with a "## Preview Deployment" comment.
 */
export interface Preview {
  state: 'deploying' | 'ready' | 'failed'
  at: string // when it was requested
  url: string | null
  /** Head commit when it was requested. Unknown for previews requested outside the app. */
  sha: string | null
  /** The branch has commits the preview doesn't include. */
  stale: boolean
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
const MERGE_ATTEMPT = '<!-- pr-command:merge-attempt -->'
const RUN_LINK_RE = /\[Workflow run\]\((https:\/\/[^)\s]+)\)/
const PREVIEW_TRIGGER = '/deploy-preview'
const PREVIEW_MARKER_RE = /<!-- pr-command:preview (\{.*?\}) -->/
const PREVIEW_RESULT = '## Preview Deployment'
const PREVIEW_URL_RE = /\*\*Frontend:\*\* (https:\/\/\S+)/
// Firebase preview channels expire after 7 days (--expires 7d in preview-deploy.yml).
const PREVIEW_TTL = 7 * 24 * 3600_000
// A build takes ~4 minutes. Without a result by then, it failed without reacting (e.g. no write access).
const PREVIEW_TIMEOUT = 20 * 60_000
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
  headRefName baseRefName headRefOid
  headCommit: commits(last: 1) { nodes { commit { committedDate } } }
  repository { name defaultBranchRef { name } }
  labels(first: 20) { nodes { name color } }
  autoMergeRequest { enabledAt }
  commits { totalCount }
  comments(last: 40) { nodes { body createdAt reactionGroups { content reactors { totalCount } } } }
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
  headRefOid: string
  headCommit: {nodes: {commit: {committedDate: string}}[]}
  repository: {name: string; defaultBranchRef: {name: string} | null}
  labels: {nodes: {name: string; color: string}[]}
  autoMergeRequest: {enabledAt: string} | null
  commits: {totalCount: number}
  comments: {nodes: RawComment[]}
}

interface RawComment {
  body: string
  createdAt: string
  reactionGroups: {content: string; reactors: {totalCount: number}}[]
}

function derivePreview(raw: RawPR): Preview | null {
  let trigger: RawComment | null = null
  let result: RawComment | null = null
  for (const c of raw.comments.nodes) {
    if (c.body.startsWith(PREVIEW_RESULT)) result = c
    else if (c.body.includes(PREVIEW_TRIGGER)) trigger = c
  }
  if (!trigger) return null
  const age = Date.now() - new Date(trigger.createdAt).getTime()
  if (age > PREVIEW_TTL) return null
  let sha: string | null = null
  const m = trigger.body.match(PREVIEW_MARKER_RE)
  if (m) {
    try {
      sha = (JSON.parse(m[1]) as {sha: string}).sha
    } catch {
      // malformed marker
    }
  }
  const url = result && result.createdAt > trigger.createdAt ? (result.body.match(PREVIEW_URL_RE)?.[1] ?? null) : null
  const reactions = trigger.reactionGroups
  const reacted = (r: string) => reactions.some(g => g.content === r && g.reactors.totalCount > 0)
  const state = url ? 'ready' : reacted('CONFUSED') || age > PREVIEW_TIMEOUT ? 'failed' : 'deploying'
  // Without the commit, fall back to commit dates: anything committed after the request is new.
  const headDate = raw.headCommit.nodes[0]?.commit.committedDate ?? ''
  const stale = sha ? sha !== raw.headRefOid : headDate > trigger.createdAt
  return {state, at: trigger.createdAt, url, sha, stale}
}

function toPR(raw: RawPR): PR {
  const labels = raw.labels.nodes
  const sessions: Session[] = []
  const mergeRuns: Session[] = []
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
    } else if (c.body.includes(MERGE_ATTEMPT)) {
      const run = c.body.match(RUN_LINK_RE)
      if (run) mergeRuns.push({url: run[1], at: c.createdAt})
    } else if (c.body.includes(SESSION_ERROR)) {
      sessionError = {at: c.createdAt, body: c.body.replace(SESSION_ERROR, '').trim()}
    }
  }
  sessions.reverse() // newest first
  mergeRuns.reverse()
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
    mergeRuns,
    sessionError,
    headOid: raw.headRefOid,
    preview: derivePreview(raw),
  }
}

/** GitHub's error message if the token is rejected, null if it still works (or GitHub is just flaky). */
export async function checkToken(): Promise<string | null> {
  try {
    await request('GET', '/user')
    return null
  } catch (e) {
    return e instanceof GitHubError && e.status === 401 ? e.message : null
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

/**
 * Takes the PR out of the merge queue: turns off auto-merge, removes the labels and stops a
 * running merge agent. The merge workflow leaves PRs without the label alone.
 */
export async function unmarkMergeable(pr: PR) {
  await gql(`mutation($id: ID!) { disablePullRequestAutoMerge(input: {pullRequestId: $id}) { clientMutationId } }`, {
    id: pr.id,
  }).catch(() => {}) // auto-merge wasn't on
  await removeLabels(pr, [LABEL_READY, LABEL_MERGE_AGENT])
  const runId = pr.status === 'merge-agent' ? pr.mergeRuns[0]?.url.match(/\/actions\/runs\/(\d+)/)?.[1] : undefined
  if (runId) {
    // Best effort: the run may have finished already.
    await request('POST', `/repos/${ORG}/${pr.repo}/actions/runs/${runId}/cancel`).catch(() => {})
  }
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
 * Asks aya's Preview Deploy workflow for a preview of the branch. The marker records the head
 * commit, so the app can tell later whether the branch has moved on since.
 */
export async function deployPreview(pr: PR) {
  await request('POST', `/repos/${ORG}/${pr.repo}/issues/${pr.number}/comments`, {
    body: `${PREVIEW_TRIGGER}\n\n<!-- pr-command:preview ${JSON.stringify({sha: pr.headOid})} -->`,
  })
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
