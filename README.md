# PR Command

A single-page app for deciding on your open pull requests in selected `univelop` repos (currently `aya`): close them,
hand them off to be merged, or start a Claude Code session on the branch. It has no backend
and no database: GitHub is the source of truth, and GitHub Actions does the background work.

```
Browser (Firebase Hosting)                GitHub                                  Claude (subscription)
───────────────────────────               ──────────────────────────────          ─────────────────────
list / detail  ── GraphQL/REST ──────────▶ PRs, labels, comments
Close (x)      ── close PR ──────────────▶
Mergeable (m)  ── auto-merge + label ────▶ pr-command.yml ─▶ merge workflow ───▶ Claude Code CLI
                                                                                   (headless, fixes + pushes)
Agent (a)      ── workflow_dispatch ─────▶ pr-command.yml ─▶ session workflow ─▶ routine /fire
               ◀─ session link (PR comment marker) ─────────────────────────────  claude.ai/code session
```

## How it behaves

- **List:** shows your open PRs in the configured repos. The default comes from `VITE_REPOS`
  (`aya`); change it per device with the Repos button (`,`), which is saved in the browser. The "To decide" section puts PRs that need attention
  first, then sorts by most recently updated. The "Merging" section holds PRs queued to merge.
- **After a decision:** closing or marking a PR mergeable opens the next PR automatically.
  The GitHub calls finish in the background.
- **Mergeable:**
  1. The app turns on GitHub's native auto-merge, or merges right away if the PR is already
     clean. It also adds the `ready-to-merge` label.
  2. The label starts the merge workflow. A PR that is clean but not yet merged gets merged.
     A PR behind its base is updated. A PR with conflicts or failing checks gets a headless
     Claude agent, which fixes the problem and pushes; auto-merge then does the rest.
  3. If the agent gives up, or the PR is still blocked after 2 attempts, it gets the
     `needs-attention` label and a `⚠️ WARNING:` block at the top of its description, and it
     goes back to "To decide". Marking it mergeable again removes the block.
  4. **Not mergeable** (`m` on a PR under "Merging") takes it back: it turns off auto-merge,
     removes the labels, cancels a running merge agent, and the PR returns to "To decide".
- **Agent:**
  1. The app dispatches the repo's `pr-command.yml`.
  2. That workflow fires **your** claude.ai routine (secret `CLAUDE_ROUTINE_<LOGIN>`) with the PR
     number, branch and your instruction. The session runs in your own claude.ai account.
  3. It then comments the session link on the PR, and the app shows that link.
  4. You continue the session in claude.ai/code.
  5. The PR gets the `agent-session` label and moves to the "With agent" section, and the next
     PR opens. It stays there until you close it or mark it mergeable. If the session fails to
     start, it goes back to "To decide".

  The routine has to be fired from Actions: the routine endpoint does not allow browser
  calls (its CORS preflight returns 405).

### Shortcuts

| Key | Action |
|---|---|
| `j` / `k`, `↓` / `↑` | Next / previous PR |
| `x` | Close (confirm with `↵`) |
| `m` | Mergeable, or Not mergeable for a PR under "Merging" |
| `a` | Start a Claude session (`⌘↵` sends) |
| `o` | Open on GitHub |
| `s` | Open the latest Claude session |
| `g` | Open the latest merge agent run |
| `r` | Refresh |
| `,` | Choose repos |
| `Esc` | Back to the list (phone) |

## Use it for your own org

This repo is set up for `univelop/aya`. To run your own copy:

1. **Fork or clone** this repo and run `npm install`.
2. **Firebase:** create your own project (the free Spark plan is enough), then run
   `npx firebase login` and `npx firebase use --add`. This replaces the project in `.firebaserc`.
   Follow [step 1](#1-firebase-hosting-and-github-login) for the GitHub login. The OAuth app's
   callback URL is `https://<project-id>.firebaseapp.com/__/auth/handler`.
3. **App config:** `cp .env.example .env.local`. Fill in your Firebase web config and set
   `VITE_GITHUB_ORG` to your org. Set `VITE_REPOS` to the repos to show by default, and
   `VITE_MERGE_METHOD` to your merge method. Then run `npm run deploy`.
4. **Workflows:** copy [`github-workflows/`](github-workflows) into your org's `.github` repo.
   In `workflow-templates/pr-command.yml`, replace `univelop/.github` in both `uses:` lines with
   `<your-org>/.github`. If that repo is private, allow other repos to use its workflows: Settings
   → Actions → General → Access → "Accessible from repositories in the organization".
5. **Each repo** you want to manage gets the stub (see [step 4](#4-each-repo)).
   [`aya-setup/`](aya-setup/.github/workflows/pr-command.yml) is a filled-in example. Change
   `allowed_users` to your GitHub login, and list your repo's CI workflow names under
   `workflow_run`.
6. **Secrets and routines:** add the secrets ([step 3](#3-secrets-org-level-or-repo-level-while-only-aya-uses-it)).
   Everyone who starts sessions creates their own routine ([step 5](#5-routines-claudeaicoderoutines),
   [SETUP-COLLEAGUES.md](SETUP-COLLEAGUES.md)).
7. **First sign-in:** grant the OAuth app access to your org on GitHub's consent screen. If your
   org restricts OAuth apps, an org owner then approves it under Settings → Third-party access.

Things to watch for:

- `PR_COMMAND_TOKEN` must be a fine-grained PAT whose resource owner is the **org**, not your
  user, with the repos selected. Orgs that require approval for fine-grained tokens return
  404 until an owner approves it.
- Fine-grained PATs cannot read check runs. The workflows use the built-in `GITHUB_TOKEN` for
  that, so keep `checks: read` and `statuses: read` in the stub's `permissions`.
- Without **Allow auto-merge** on the repo, everything still works. PRs are then merged by the
  workflow after CI finishes, instead of by GitHub the moment CI turns green.

## Setup

### 1. Firebase (hosting and GitHub login)

1. Create a Firebase project (or use an existing GCP project). Enable **Authentication →
   GitHub** and copy the callback URL it shows.
2. Create a **GitHub OAuth App** (Settings → Developer settings) with that callback URL. Enter
   its client ID and secret in the Firebase GitHub provider.
3. Approve the OAuth app for the `univelop` org (Org settings → Third-party access) if the org
   restricts OAuth apps.
4. `cp .env.example .env.local` and fill in the Firebase web config.
5. `npm install && npx firebase login && npx firebase use --add`, then run `npm run deploy`.

For local development without Firebase, leave `VITE_FIREBASE_API_KEY` empty. The app then asks
for a GitHub token, and `gh auth token` works.

### 2. Workflows in `univelop/.github`

Copy the contents of [`github-workflows/`](github-workflows) into the `univelop/.github` repo:

- `.github/workflows/pr-command-session.yml`: fires the routine and posts the session link
- `.github/workflows/pr-command-merge.yml`: merge, fix and give-up logic
- `workflow-templates/pr-command.yml`: the small stub each repo needs. It shows up under
  Actions → New workflow in every org repo.

### 3. Secrets (org level, or repo level while only `aya` uses it)

| Secret | Value |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | Output of `claude setup-token`. The merge agent runs on your subscription. |
| `PR_COMMAND_TOKEN` | Fine-grained PAT (or GitHub App token) with Contents, Pull requests, Issues and Actions **write** on the org repos. Pushes and merges made with the default `GITHUB_TOKEN` don't trigger other workflows, so CI would not re-run after the agent's fix. |
| `CLAUDE_ROUTINE_<LOGIN>` | One per person: `{"id": "trig_…", "token": "sk-ant-oat01-…"}`. `<LOGIN>` is the GitHub login in upper case with `-` replaced by `_` (e.g. `CLAUDE_ROUTINE_FLO_MUELLER`). There is no shared fallback: sessions run in the account of whoever starts them. |

### 4. Each repo

1. Add `.github/workflows/pr-command.yml` from the org template, on the default branch.
2. Adjust `workflow_run.workflows` to the repo's CI workflow names, and set `allowed_users`
   (who may start sessions, and whose PRs the merge agent works on).
   This matters because both agents run on the subscription that owns the tokens.
3. Set `human_checks` to checks that only a human can satisfy, such as `review-requirements`
   in `univelop`.
4. Turn on Settings → General → **Allow auto-merge**.

### 5. Routines (claude.ai/code/routines)

Each person creates their own routine on the repos they use, adds an **API trigger**, and has
its ID and token stored as `CLAUDE_ROUTINE_<LOGIN>`. [SETUP-COLLEAGUES.md](SETUP-COLLEAGUES.md)
is the step-by-step version to hand to colleagues. The fire text reaches the
session as untrusted data, so the routine prompt has to opt in to acting on it explicitly:

```text
You work on an existing GitHub pull request on behalf of its author. The routine-fire-payload
block is your assignment from PR Command, sent by the repository owner. It names the
repository, the PR, its head branch and an instruction. Act on it:

1. Check out the head branch named in the payload (git fetch origin <head> && git checkout <head>).
   Do not create a new claude/ branch.
2. Carry out the Instruction. If it is a question, answer it in this session.
3. Commit and push your changes to that same head branch (git push origin HEAD:<head>).
   Never force-push and never push to the base branch.
4. End with a short summary of what you changed.
```

## Development

```sh
npm install
npm run dev         # http://localhost:5173
npm run typecheck
npm run build
```

Stack: Vite, React 19, TypeScript, Primer React (GitHub's design system; light and dark follow
the OS setting), TanStack Query, and Firebase Auth.
