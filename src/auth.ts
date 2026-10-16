import {initializeApp} from 'firebase/app'
import {getAuth, GithubAuthProvider, signInWithPopup, signOut as fbSignOut} from 'firebase/auth'
import {firebaseConfig, firebaseEnabled} from './config'

// Firebase only brokers the GitHub OAuth login. The GitHub access token it hands
// back at sign-in is what the app uses for every API call; Firebase does not keep
// it, so it lives in localStorage. Classic OAuth app tokens do not expire.
const TOKEN_KEY = 'pr-command:github-token'
const SIGNED_IN_AT_KEY = 'pr-command:signed-in-at'
// Why the app last signed out on its own, shown on the login screen.
const SIGNOUT_REASON_KEY = 'pr-command:signout-reason'

const auth = firebaseEnabled ? getAuth(initializeApp(firebaseConfig)) : null

export function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function storeToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(SIGNED_IN_AT_KEY, String(Date.now()))
    localStorage.removeItem(SIGNOUT_REASON_KEY)
  } catch {
    // Private mode: token only lives for this tab.
  }
}

export async function signInWithGitHub(): Promise<string> {
  if (!auth) throw new Error('Firebase is not configured (see .env.example)')
  const provider = new GithubAuthProvider()
  provider.addScope('repo')
  provider.addScope('read:org')
  const result = await signInWithPopup(auth, provider).catch((e: {code?: string; message?: string}) => {
    throw new Error(`Sign-in failed (${e.code ?? 'unknown'}): ${e.message ?? e}`)
  })
  const token = GithubAuthProvider.credentialFromResult(result)?.accessToken
  if (!token) throw new Error('GitHub did not return an access token')
  storeToken(token)
  return token
}

/** Remembers why the app signed out on its own: token kind, age and GitHub's message. */
export function recordSignOutReason(message: string) {
  try {
    const token = localStorage.getItem(TOKEN_KEY) ?? ''
    const at = Number(localStorage.getItem(SIGNED_IN_AT_KEY))
    const age = at ? `${((Date.now() - at) / 3_600_000).toFixed(1)} h after sign-in` : 'sign-in time unknown'
    const kind = token.slice(0, 4) || 'none'
    const when = new Date().toLocaleString()
    localStorage.setItem(SIGNOUT_REASON_KEY, `${when}: GitHub rejected the token (${message}); token ${kind}…, ${age}.`)
  } catch {
    // ignore
  }
}

export function signOutReason(): string | null {
  try {
    return localStorage.getItem(SIGNOUT_REASON_KEY)
  } catch {
    return null
  }
}

export async function signOut() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore
  }
  if (auth) await fbSignOut(auth)
}
