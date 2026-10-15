import {useRef, useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {Button, Checkbox, CheckboxGroup, Dialog, FormControl, Spinner, Textarea, TextInput} from '@primer/react'
import {KeybindingHint} from '@primer/react/experimental'
import {ORG} from '../config'
import {fetchRepoCandidates, type PR} from '../github'

function hint(keys: string, variant: 'normal' | 'onPrimary' = 'normal') {
  return (
    <span className="kbd-hint">
      {' '}
      <KeybindingHint keys={keys} variant={variant} size="small" />
    </span>
  )
}

export function CloseDialog({pr, onConfirm, onCancel}: {pr: PR; onConfirm: () => void; onCancel: () => void}) {
  return (
    <Dialog
      title="Close pull request?"
      subtitle={`${pr.repo} #${pr.number}`}
      onClose={onCancel}
      footerButtons={[
        {content: <>Cancel{hint('Escape')}</>, onClick: onCancel},
        {content: <>Close PR{hint('Enter')}</>, buttonType: 'danger', onClick: onConfirm, autoFocus: true},
      ]}
    >
      {pr.title}
    </Dialog>
  )
}

export function AgentDialog({
  pr,
  onStart,
  onCancel,
}: {
  pr: PR
  onStart: (instruction: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const submit = () => text.trim() && onStart(text.trim())
  return (
    <Dialog
      title="Start a Claude session"
      subtitle={`${pr.repo} #${pr.number} · ${pr.headRefName}`}
      width="large"
      initialFocusRef={inputRef}
      onClose={onCancel}
      footerButtons={[
        {content: <>Cancel{hint('Escape')}</>, onClick: onCancel},
        {content: <>Start session{hint('Mod+Enter', 'onPrimary')}</>, buttonType: 'primary', onClick: submit},
      ]}
    >
      <FormControl>
        <FormControl.Label>What should Claude do on this branch?</FormControl.Label>
        <Textarea
          ref={inputRef}
          block
          rows={6}
          resize="vertical"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <FormControl.Caption>
          The session runs in claude.ai/code and pushes to {pr.headRefName}. A link appears here once it has started.
        </FormControl.Caption>
      </FormControl>
    </Dialog>
  )
}

export function ReposDialog({
  repos,
  onSave,
  onCancel,
}: {
  repos: string[]
  onSave: (repos: string[]) => void
  onCancel: () => void
}) {
  const candidates = useQuery({queryKey: ['repo-candidates'], queryFn: fetchRepoCandidates})
  const [selected, setSelected] = useState(() => new Set(repos))
  const [extra, setExtra] = useState('')
  const counts = new Map((candidates.data ?? []).map(c => [c.name, c.count]))
  const names = [...new Set([...repos, ...counts.keys(), ...selected])].sort((a, b) => a.localeCompare(b))
  const toggle = (name: string) =>
    setSelected(s => {
      const next = new Set(s)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  const save = () => onSave([...selected].sort())

  return (
    <Dialog
      title="Repositories"
      subtitle={`Which ${ORG} repos to show PRs from. Saved on this device.`}
      onClose={onCancel}
      footerButtons={[
        {content: <>Cancel{hint('Escape')}</>, onClick: onCancel},
        {content: <>Save{hint('Mod+Enter', 'onPrimary')}</>, buttonType: 'primary', onClick: save},
      ]}
    >
      <div
        className="repo-settings"
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            save()
          }
        }}
      >
        {candidates.isLoading && <Spinner size="small" />}
        <CheckboxGroup>
          <CheckboxGroup.Label visuallyHidden>Repositories</CheckboxGroup.Label>
          {names.map(name => (
            <FormControl key={name}>
              <Checkbox checked={selected.has(name)} onChange={() => toggle(name)} />
              <FormControl.Label>
                {name} <span className="muted">· {counts.get(name) ?? 0} open</span>
              </FormControl.Label>
            </FormControl>
          ))}
          <CheckboxGroup.Caption>Nothing selected shows every repo in {ORG}.</CheckboxGroup.Caption>
        </CheckboxGroup>
        <form
          className="repo-add"
          onSubmit={e => {
            e.preventDefault()
            const name = extra.trim().replace(new RegExp(`^${ORG}/`), '')
            if (name) setSelected(s => new Set(s).add(name))
            setExtra('')
          }}
        >
          <TextInput
            aria-label="Add repository"
            placeholder="Add another repo…"
            value={extra}
            onChange={e => setExtra(e.target.value)}
            block
          />
          <Button type="submit">Add</Button>
        </form>
      </div>
    </Dialog>
  )
}
