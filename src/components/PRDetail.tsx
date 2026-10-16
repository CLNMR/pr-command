import {useQuery} from '@tanstack/react-query'
import {BranchName, Button, Flash, Label, RelativeTime, Spinner, StateLabel} from '@primer/react'
import {
  ArrowLeftIcon,
  CheckIcon,
  CircleSlashIcon,
  DependabotIcon,
  GitCommitIcon,
  LinkExternalIcon,
  PlayIcon,
  SyncIcon,
  XIcon,
} from '@primer/octicons-react'
import {fetchCommits, type PR} from '../github'
import {KbdButton} from './KbdButton'

const STATUS_LABEL: Record<PR['status'], {text: string; variant: 'danger' | 'attention' | 'done'} | null> = {
  attention: {text: 'Needs attention', variant: 'danger'},
  'merge-agent': {text: 'Merge agent working', variant: 'attention'},
  queued: {text: 'Queued to merge', variant: 'done'},
  agent: {text: 'With agent', variant: 'attention'},
  open: null,
}

interface Props {
  pr: PR
  pendingSession: boolean
  onBack: () => void
  onClose: () => void
  onMergeable: () => void
  onAgent: () => void
}

export function PRDetail({pr, pendingSession, onBack, onClose, onMergeable, onAgent}: Props) {
  const commits = useQuery({
    queryKey: ['commits', pr.repo, pr.number, pr.commitCount],
    queryFn: () => fetchCommits(pr.repo, pr.number),
  })
  const status = STATUS_LABEL[pr.status]
  const latestSession = pr.sessions[0]
  const latestMergeRun = pr.mergeRuns[0]
  const decided = pr.status === 'queued' || pr.status === 'merge-agent'

  return (
    <article className="detail">
      <header className="detail-header">
        <div className="detail-topline">
          <Button className="back-button" variant="invisible" size="small" leadingVisual={ArrowLeftIcon} onClick={onBack}>
            PRs
          </Button>
          <StateLabel status={pr.isDraft ? 'draft' : 'pullOpened'} size="small">
            {pr.isDraft ? 'Draft' : 'Open'}
          </StateLabel>
          {status && <Label variant={status.variant}>{status.text}</Label>}
          <span className="muted">
            {pr.repo} #{pr.number}
          </span>
        </div>
        <h1 className="detail-title">{pr.title}</h1>
        <div className="detail-meta">
          <BranchName as="span">{pr.headRefName}</BranchName>
          <span className="muted">→</span>
          <BranchName as="span">{pr.baseRefName}</BranchName>
          <span className="stat">
            <span className="fg-success">+{pr.additions}</span> <span className="fg-danger">−{pr.deletions}</span>
          </span>
          <span className="muted">
            {pr.changedFiles} files · {pr.commitCount} commits · updated <RelativeTime date={new Date(pr.updatedAt)} />
          </span>
        </div>
        <div className="actions">
          <KbdButton hotkey="x" variant="danger" leadingVisual={XIcon} onClick={onClose}>
            Close
          </KbdButton>
          {decided ? (
            <KbdButton hotkey="m" leadingVisual={CircleSlashIcon} onClick={onMergeable}>
              Not mergeable
            </KbdButton>
          ) : (
            <KbdButton hotkey="m" variant="primary" leadingVisual={CheckIcon} onClick={onMergeable}>
              Mergeable
            </KbdButton>
          )}
          <KbdButton hotkey="a" leadingVisual={DependabotIcon} onClick={onAgent}>
            Agent
          </KbdButton>
          <KbdButton hotkey="o" leadingVisual={LinkExternalIcon} href={pr.url} target="_blank" rel="noreferrer">
            GitHub
          </KbdButton>
          {latestSession && (
            <KbdButton hotkey="s" leadingVisual={LinkExternalIcon} href={latestSession.url} target="_blank" rel="noreferrer">
              Session
            </KbdButton>
          )}
          {latestMergeRun && (
            <KbdButton hotkey="g" leadingVisual={PlayIcon} href={latestMergeRun.url} target="_blank" rel="noreferrer">
              Merge run
            </KbdButton>
          )}
        </div>
      </header>

      <div className="detail-body">
        <section className="panel description" aria-label="Description">
          {pr.bodyHTML ? (
            <div className="markdown-body" dangerouslySetInnerHTML={{__html: pr.bodyHTML}} />
          ) : (
            <p className="muted">No description provided.</p>
          )}
        </section>

        <aside className="side">
          {(pendingSession || pr.sessions.length > 0 || pr.sessionError) && (
            <section className="panel">
              <h2 className="panel-heading">Claude sessions</h2>
              {pendingSession && (
                <p className="session-row">
                  <Spinner size="small" /> Starting session…
                </p>
              )}
              {pr.sessionError && (
                <Flash variant="danger" className="session-error">
                  Session could not be started: {pr.sessionError.body.slice(0, 300)}
                </Flash>
              )}
              {pr.sessions.slice(0, 5).map(s => (
                <a key={s.url} className="session-row" href={s.url} target="_blank" rel="noreferrer">
                  <DependabotIcon /> <RelativeTime date={new Date(s.at)} /> <LinkExternalIcon size={12} />
                </a>
              ))}
            </section>
          )}

          {pr.mergeRuns.length > 0 && (
            <section className="panel">
              <h2 className="panel-heading">Merge agent runs</h2>
              {pr.mergeRuns.slice(0, 3).map((r, i) => (
                <a key={r.url + r.at} className="session-row" href={r.url} target="_blank" rel="noreferrer">
                  {i === 0 && pr.status === 'merge-agent' ? <SyncIcon className="spin" /> : <PlayIcon />}{' '}
                  <RelativeTime date={new Date(r.at)} /> <LinkExternalIcon size={12} />
                </a>
              ))}
            </section>
          )}

          <section className="panel commits" aria-label="Commits">
            <h2 className="panel-heading">Commits</h2>
            {commits.isLoading && <Spinner size="small" />}
            {commits.error && <Flash variant="danger">{(commits.error as Error).message}</Flash>}
            <ol className="commit-list">
              {commits.data?.map(c => (
                <li key={c.oid}>
                  <GitCommitIcon className="fg-muted" />
                  <span className="commit-main">
                    <span className="commit-headline">{c.headline}</span>
                    <span className="commit-meta">
                      {c.author} · <RelativeTime date={new Date(c.date)} />
                    </span>
                  </span>
                  <a className="commit-sha" href={c.url} target="_blank" rel="noreferrer">
                    {c.shortOid}
                  </a>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </article>
  )
}
