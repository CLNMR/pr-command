import {useCallback, useEffect, useMemo, useState} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {Avatar, Flash, IconButton, Spinner} from '@primer/react'
import {Blankslate} from '@primer/react/experimental'
import {GearIcon, SignOutIcon, SyncIcon} from '@primer/octicons-react'
import {recordSignOutReason, signOut, storedToken} from './auth'
import {ORG} from './config'
import {checkToken, closePR, fetchMyPRs, fetchViewer, GitHubError, markMergeable, setToken, startSession, unmarkMergeable, type PR} from './github'
import {useShortcuts} from './shortcuts'
import {loadRepos, saveRepos} from './settings'
import {Login} from './components/Login'
import {PRList} from './components/PRList'
import {PRDetail} from './components/PRDetail'
import {AgentDialog, CloseDialog, ReposDialog} from './components/Dialogs'
import {KbdButton} from './components/KbdButton'

export function App() {
  const [token, setTokenState] = useState(storedToken)
  const onSignOut = useCallback(() => {
    void signOut()
    setTokenState(null)
  }, [])
  if (!token) return <Login onToken={setTokenState} />
  setToken(token)
  return <Main onSignOut={onSignOut} />
}

// Optimistic overrides survive until the next polls have caught up with GitHub.
const OVERRIDE_TTL = 2 * 60_000
// How long to wait for the workflow to post the session link.
const SESSION_TIMEOUT = 4 * 60_000

type Override = {kind: 'closed' | 'queued' | 'agent' | 'unqueued'; at: number}
type Toast = {id: number; variant: 'default' | 'success' | 'danger' | 'warning'; text: string}

function keyFromHash(hash: string): string | null {
  const m = hash.match(/^#\/([^/]+)\/(\d+)$/)
  return m ? `${decodeURIComponent(m[1])}#${m[2]}` : null
}

function useNarrow() {
  const query = '(max-width: 767px)'
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setNarrow(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return narrow
}

function Main({onSignOut}: {onSignOut: () => void}) {
  const queryClient = useQueryClient()
  const narrow = useNarrow()
  const [hash, setHash] = useState(location.hash)
  const [overrides, setOverrides] = useState<Map<string, Override>>(new Map())
  const [pending, setPending] = useState<Map<string, number>>(new Map())
  const [dialog, setDialog] = useState<null | 'close' | 'agent' | 'repos'>(null)
  const [repos, setRepos] = useState(loadRepos)
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    const onHash = () => setHash(location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const toast = useCallback((variant: Toast['variant'], text: string) => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, {id, variant, text}])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), variant === 'danger' ? 10_000 : 4_000)
  }, [])

  const viewer = useQuery({queryKey: ['viewer'], queryFn: fetchViewer, staleTime: Infinity})
  const prsQuery = useQuery({
    queryKey: ['prs', repos],
    queryFn: () => fetchMyPRs(repos),
    refetchInterval: pending.size > 0 ? 5_000 : 30_000,
  })

  // Sign out only if GitHub confirms that the token is no longer valid, not on a one-off 401.
  const authError = [viewer.error, prsQuery.error].find(e => e instanceof GitHubError && e.status === 401)
  useEffect(() => {
    if (!authError) return
    let cancelled = false
    void checkToken().then(error => {
      if (cancelled) return
      if (error) {
        recordSignOutReason(error)
        onSignOut()
      } else {
        toast('warning', `GitHub returned 401 once (${(authError as Error).message}); still signed in.`)
        void queryClient.invalidateQueries()
      }
    })
    return () => {
      cancelled = true
    }
  }, [authError, onSignOut, toast, queryClient])

  // Resolve pending session starts once the workflow has commented on the PR.
  useEffect(() => {
    if (!prsQuery.data || pending.size === 0) return
    const next = new Map(pending)
    for (const [key, at] of pending) {
      const pr = prsQuery.data.find(p => p.key === key)
      const since = new Date(at - 30_000).toISOString()
      if (!pr || (pr.sessions[0] && pr.sessions[0].at > since) || (pr.sessionError && pr.sessionError.at > since)) {
        next.delete(key)
        if (pr?.sessionError && pr.sessionError.at > since) {
          toast('danger', `${key}: session could not be started`)
          setOverrides(m => {
            const copy = new Map(m)
            copy.delete(key)
            return copy
          })
        } else if (pr) toast('success', `${key}: Claude session started`)
      } else if (Date.now() - at > SESSION_TIMEOUT) {
        next.delete(key)
        toast('warning', `${key}: no session link yet. Check the PR Command workflow run.`)
      }
    }
    if (next.size !== pending.size) setPending(next)
  }, [prsQuery.data, pending, toast])

  const {toDecide, withAgent, inFlight} = useMemo(() => {
    const now = Date.now()
    const prs = (prsQuery.data ?? []).flatMap(pr => {
      const o = overrides.get(pr.key)
      if (!o || now - o.at > OVERRIDE_TTL) return [pr]
      if (o.kind === 'closed') return []
      if (o.kind === 'unqueued') {
        return pr.status === 'queued' || pr.status === 'merge-agent' ? [{...pr, status: 'open' as const}] : [pr]
      }
      if (o.kind === 'agent') {
        return pr.status === 'open' || pr.status === 'attention' ? [{...pr, status: 'agent' as const}] : [pr]
      }
      return pr.status === 'open' || pr.status === 'attention' || pr.status === 'agent'
        ? [{...pr, status: 'queued' as const}]
        : [pr]
    })
    const decide = prs.filter(p => p.status === 'open' || p.status === 'attention')
    // Problems first, then most recently updated (search order).
    decide.sort((a, b) => Number(b.status === 'attention') - Number(a.status === 'attention'))
    return {
      toDecide: decide,
      withAgent: prs.filter(p => p.status === 'agent'),
      inFlight: prs.filter(p => p.status === 'queued' || p.status === 'merge-agent'),
    }
  }, [prsQuery.data, overrides])

  const ordered = useMemo(() => [...toDecide, ...withAgent, ...inFlight], [toDecide, withAgent, inFlight])
  const hashKey = keyFromHash(hash)
  const selected = ordered.find(p => p.key === hashKey) ?? (narrow || hashKey ? null : (ordered[0] ?? null))

  const select = (pr: PR | null) => {
    const target = pr ? `#/${encodeURIComponent(pr.repo)}/${pr.number}` : ''
    if (target) location.hash = target
    else history.replaceState(null, '', location.pathname + location.search)
    setHash(target)
  }

  const move = (delta: number) => {
    if (ordered.length === 0) return
    const idx = selected ? ordered.findIndex(p => p.key === selected.key) : -1
    select(ordered[Math.max(0, Math.min(ordered.length - 1, idx + delta))])
  }

  // Moves the PR out of "To decide" right away and opens the next one there.
  const advance = (pr: PR, kind: Override['kind']) => {
    const rest = toDecide.filter(p => p.key !== pr.key)
    const idx = toDecide.findIndex(p => p.key === pr.key)
    const next = idx >= 0 ? (rest[idx] ?? rest[idx - 1]) : rest[0]
    setOverrides(m => new Map(m).set(pr.key, {kind, at: Date.now()}))
    select(next ?? null)
  }

  const dropOverride = (pr: PR) =>
    setOverrides(m => {
      const copy = new Map(m)
      copy.delete(pr.key)
      return copy
    })

  const decide = (pr: PR, kind: 'closed' | 'queued') => {
    advance(pr, kind)
    const action = kind === 'closed' ? closePR(pr) : markMergeable(pr)
    action
      .then(() => {
        toast('success', kind === 'closed' ? `Closed ${pr.key}` : `${pr.key} queued to merge`)
        void queryClient.invalidateQueries({queryKey: ['prs']})
      })
      .catch((e: Error) => {
        dropOverride(pr)
        toast('danger', `${pr.key}: ${e.message}`)
      })
  }

  // Back to "To decide". The PR stays selected.
  const unqueue = (pr: PR) => {
    setOverrides(m => new Map(m).set(pr.key, {kind: 'unqueued', at: Date.now()}))
    unmarkMergeable(pr)
      .then(() => {
        toast('success', `${pr.key} no longer queued to merge`)
        void queryClient.invalidateQueries({queryKey: ['prs']})
      })
      .catch((e: Error) => {
        dropOverride(pr)
        toast('danger', `${pr.key}: ${e.message}`)
      })
  }

  const startAgent = (pr: PR, instruction: string) => {
    setDialog(null)
    setPending(m => new Map(m).set(pr.key, Date.now()))
    if (pr.status === 'open' || pr.status === 'attention') advance(pr, 'agent')
    startSession(pr, instruction)
      .then(() => {
        toast('default', `${pr.key}: starting Claude session…`)
        void queryClient.invalidateQueries({queryKey: ['prs']})
      })
      .catch((e: Error) => {
        dropOverride(pr)
        setPending(m => {
          const copy = new Map(m)
          copy.delete(pr.key)
          return copy
        })
        toast('danger', `${pr.key}: ${e.message}`)
      })
  }

  const queued = selected && (selected.status === 'queued' || selected.status === 'merge-agent')
  const toggleMergeable = (pr: PR) => (queued ? unqueue(pr) : decide(pr, 'queued'))

  useShortcuts(
    {
      j: () => move(1),
      ArrowDown: () => move(1),
      k: () => move(-1),
      ArrowUp: () => move(-1),
      r: () => void prsQuery.refetch(),
      ',': () => setDialog('repos'),
      ...(selected
        ? {
            x: () => setDialog('close'),
            a: () => setDialog('agent'),
            o: () => window.open(selected.url, '_blank', 'noreferrer'),
            Escape: () => narrow && select(null),
            m: () => toggleMergeable(selected),
            ...(selected.sessions[0] ? {s: () => window.open(selected.sessions[0].url, '_blank', 'noreferrer')} : {}),
            ...(selected.mergeRuns[0] ? {g: () => window.open(selected.mergeRuns[0].url, '_blank', 'noreferrer')} : {}),
          }
        : {}),
    },
    dialog === null,
  )

  const showList = !narrow || !selected
  const showDetail = !narrow || selected

  return (
    <div className="app">
      <header className="app-header">
        <img src="/icon.svg" width={24} height={24} alt="" />
        <span className="app-name">PR Command</span>
        <span className="muted app-org">
          {ORG}/{repos.length ? repos.join(', ') : '*'}
        </span>
        <span className="spacer" />
        {prsQuery.isFetching && <Spinner size="small" />}
        <KbdButton hotkey="r" size="small" leadingVisual={SyncIcon} onClick={() => void prsQuery.refetch()}>
          <span className="refresh-label">Refresh</span>
        </KbdButton>
        <KbdButton hotkey="," size="small" leadingVisual={GearIcon} onClick={() => setDialog('repos')}>
          <span className="refresh-label">Repos</span>
        </KbdButton>
        {viewer.data && <Avatar src={viewer.data.avatarUrl} alt={viewer.data.login} size={24} />}
        <IconButton icon={SignOutIcon} aria-label="Sign out" variant="invisible" size="small" onClick={onSignOut} />
      </header>

      <main className={`layout${narrow ? ' narrow' : ''}`}>
        {showList && (
          <div className="list-pane">
            {prsQuery.isLoading ? (
              <div className="center">
                <Spinner />
              </div>
            ) : prsQuery.error ? (
              <Flash variant="danger">{(prsQuery.error as Error).message}</Flash>
            ) : (
              <PRList
                toDecide={toDecide}
                withAgent={withAgent}
                inFlight={inFlight}
                selectedKey={selected?.key ?? null}
                pending={new Set(pending.keys())}
                onSelect={select}
              />
            )}
          </div>
        )}
        {showDetail && (
          <div className="detail-pane">
            {selected ? (
              <PRDetail
                key={selected.key}
                pr={selected}
                pendingSession={pending.has(selected.key)}
                onBack={() => select(null)}
                onClose={() => setDialog('close')}
                onMergeable={() => toggleMergeable(selected)}
                onAgent={() => setDialog('agent')}
              />
            ) : (
              !prsQuery.isLoading && (
                <Blankslate>
                  <Blankslate.Heading>No pull request selected</Blankslate.Heading>
                  <Blankslate.Description>All decided. Nice.</Blankslate.Description>
                </Blankslate>
              )
            )}
          </div>
        )}
      </main>

      {selected && dialog === 'close' && (
        <CloseDialog
          pr={selected}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null)
            decide(selected, 'closed')
          }}
        />
      )}
      {selected && dialog === 'agent' && (
        <AgentDialog pr={selected} onCancel={() => setDialog(null)} onStart={text => startAgent(selected, text)} />
      )}

      {dialog === 'repos' && (
        <ReposDialog
          repos={repos}
          onCancel={() => setDialog(null)}
          onSave={next => {
            saveRepos(next)
            setRepos(next)
            setDialog(null)
          }}
        />
      )}

      <div className="toasts" aria-live="polite">
        {toasts.map(t => (
          <Flash key={t.id} variant={t.variant}>
            {t.text}
          </Flash>
        ))}
      </div>
    </div>
  )
}
