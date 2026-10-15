import {initializeApp} from 'firebase/app'
import {getAuth, GithubAuthProvider, signInWithPopup, signOut as fbSignOut} from 'firebase/auth'
import {firebaseConfig, firebaseEnabled} from './config'

// Firebase only brokers the GitHub OAuth login. The GitHub access token it hands
// back at sign-in is what the app uses for every API call; Firebase does not keep
// it, so it lives in localStorage. Classic OAuth app tokens do not expire.
const TOKEN_KEY = 'pr-command:github-token'

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
  } catch {
    // Private mode: token only lives for this tab.
  }
}

export async function signInWithGitHub(): Promise<string> {
  if (!auth) throw new Error('Firebase is not configured (see .env.example)')
  const provider = new GithubAuthProvider()
  provider.addScope('repo')
  provider.addScope('read:org')
  const result = await signInWithPopup(auth, provider)
  const token = GithubAuthProvider.credentialFromResult(result)?.accessToken
  if (!token) throw new Error('GitHub did not return an access token')
  storeToken(token)
  return token
}

export async function signOut() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore
  }
  if (auth) await fbSignOut(auth)
}
