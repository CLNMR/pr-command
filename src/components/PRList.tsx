import {useEffect, useRef} from 'react'
import {RelativeTime} from '@primer/react'
import {
  AlertIcon,
  ClockIcon,
  DependabotIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  SyncIcon,
} from '@primer/octicons-react'
import type {PR} from '../github'

function StatusIcon({pr}: {pr: PR}) {
  switch (pr.status) {
    case 'attention':
      return <AlertIcon className="fg-danger" aria-label="Needs attention" />
    case 'merge-agent':
      return <SyncIcon className="fg-attention spin" aria-label="Merge agent working" />
    case 'agent':
      return <DependabotIcon className="fg-attention" aria-label="With agent" />
    case 'queued':
      return <ClockIcon className="fg-done" aria-label="Queued to merge" />
    default:
      return pr.isDraft ? (
        <GitPullRequestDraftIcon className="fg-muted" aria-label="Draft" />
      ) : (
        <GitPullRequestIcon className="fg-success" aria-label="Open" />
      )
  }
}

function Row({pr, selected, pending, onSelect}: {pr: PR; selected: boolean; pending: boolean; onSelect: () => void}) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({block: 'nearest'})
  }, [selected])
  return (
    <button ref={ref} className={`pr-row${selected ? ' selected' : ''}`} onClick={onSelect} aria-current={selected}>
      <span className="pr-row-icon">
        <StatusIcon pr={pr} />
      </span>
      <span className="pr-row-main">
        <span className="pr-row-title">{pr.title}</span>
        <span className="pr-row-meta">
          {pr.repo} #{pr.number} · <RelativeTime date={new Date(pr.updatedAt)} /> ·{' '}
          <span className="fg-success">+{pr.additions}</span> <span className="fg-danger">−{pr.deletions}</span>
          {(pending || pr.sessions.length > 0) && (
            <span className="pr-row-agent" title="Claude sessions">
              {' '}
              · <DependabotIcon size={12} /> {pending ? '…' : pr.sessions.length}
            </span>
          )}
        </span>
      </span>
    </button>
  )
}

interface Props {
  toDecide: PR[]
  withAgent: PR[]
  inFlight: PR[]
  selectedKey: string | null
  pending: Set<string>
  onSelect: (pr: PR) => void
}

function Section({title, prs, selectedKey, pending, onSelect}: {title: string; prs: PR[]} & Omit<Props, 'toDecide' | 'withAgent' | 'inFlight'>) {
  if (prs.length === 0) return null
  return (
    <>
      <h2 className="list-heading">
        {title} <span className="Counter">{prs.length}</span>
      </h2>
      {prs.map(pr => (
        <Row
          key={pr.key}
          pr={pr}
          selected={pr.key === selectedKey}
          pending={pending.has(pr.key)}
          onSelect={() => onSelect(pr)}
        />
      ))}
    </>
  )
}

export function PRList({toDecide, withAgent, inFlight, selectedKey, pending, onSelect}: Props) {
  return (
    <nav className="pr-list" aria-label="Pull requests">
      <h2 className="list-heading">
        To decide <span className="Counter">{toDecide.length}</span>
      </h2>
      {toDecide.length === 0 && <p className="empty">Nothing left to decide. 🎉</p>}
      {toDecide.map(pr => (
        <Row
          key={pr.key}
          pr={pr}
          selected={pr.key === selectedKey}
          pending={pending.has(pr.key)}
          onSelect={() => onSelect(pr)}
        />
      ))}
      <Section title="With agent" prs={withAgent} selectedKey={selectedKey} pending={pending} onSelect={onSelect} />
      <Section title="Merging" prs={inFlight} selectedKey={selectedKey} pending={pending} onSelect={onSelect} />
    </nav>
  )
}
