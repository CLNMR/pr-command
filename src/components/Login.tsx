import {useState} from 'react'
import {Button, Flash, FormControl, Heading, Text, TextInput} from '@primer/react'
import {MarkGithubIcon} from '@primer/octicons-react'
import {signInWithGitHub, signOutReason, storeToken} from '../auth'
import {firebaseEnabled, ORG} from '../config'

export function Login({onToken}: {onToken: (token: string) => void}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pat, setPat] = useState('')
  const [reason] = useState(signOutReason)

  async function login() {
    setBusy(true)
    setError(null)
    try {
      onToken(await signInWithGitHub())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <img src="/icon.svg" width={48} height={48} alt="" />
      <Heading as="h1" className="login-title">
        PR Command
      </Heading>
      <Text className="muted">Your open pull requests in {ORG}.</Text>
      {reason && !error && <Flash variant="warning">Signed out automatically. {reason}</Flash>}
      {error && <Flash variant="danger">{error}</Flash>}
      {firebaseEnabled ? (
        <Button variant="primary" size="large" leadingVisual={MarkGithubIcon} onClick={login} loading={busy} block>
          Sign in with GitHub
        </Button>
      ) : (
        <form
          className="login-pat"
          onSubmit={e => {
            e.preventDefault()
            if (!pat.trim()) return
            storeToken(pat.trim())
            onToken(pat.trim())
          }}
        >
          <Flash variant="warning">Firebase is not configured. Use a GitHub token with repo scope for local development.</Flash>
          <FormControl>
            <FormControl.Label>GitHub token</FormControl.Label>
            <TextInput type="password" value={pat} onChange={e => setPat(e.target.value)} block autoFocus />
          </FormControl>
          <Button type="submit" variant="primary" block>
            Continue
          </Button>
        </form>
      )}
    </div>
  )
}
