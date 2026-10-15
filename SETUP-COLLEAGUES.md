# PR Command: setup for univelop colleagues

PR Command (https://pr-command-clnmr.web.app) lists your open PRs in `univelop/aya`. For each
one, you can close it, mark it mergeable (it is then merged in the background), or start a
Claude Code session on its branch.

Closing and merging work as soon as you sign in. To start Claude sessions, the app fires a
**routine in your own claude.ai account**, so the session runs on your subscription and only
you can open it. You need to set this up once (about 10 minutes), then send two values to
Colin, who stores them as a GitHub secret.

## What you need

- A univelop GitHub account (you are listed in `allowed_users` already).
- A Claude plan that includes Claude Code on the web (Pro, Max, Team or Enterprise).

## Your steps

1. **Connect GitHub to Claude Code on the web**
   - Open https://claude.ai/code and sign in.
   - Connect your GitHub account when asked. Make sure `univelop/aya` shows up in the
     repository picker. If it doesn't, the Claude GitHub App needs access to it; ask Colin.

2. **Create your routine** at https://claude.ai/code/routines
   - **Name:** `PR Command (aya)`
   - **Repository:** `univelop/aya`
   - **Environment:** the same one you use for aya sessions (the default is fine if you
     don't have one).
   - **Prompt:** copy this exactly:

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

   - **Trigger:** add an **API trigger**. No schedule is needed.
   - Save it.

3. **Copy the two values**
   - The **routine ID** starts with `trig_`.
   - The **API token** starts with `sk-ant-oat01-`. It is shown only once, so copy it
     right away. If you lose it, generate a new one.

4. **Send them to Colin privately**
   - Use a 1Password share link or another one-time secret link. Don't post the token in
     Slack, Teams, email or GitHub: anyone who has it can start sessions in your account.
   - Send it in exactly this format, with your GitHub login:

     ```json
     {"login": "your-github-login", "id": "trig_…", "token": "sk-ant-oat01-…"}
     ```

5. **Sign in to the app** at https://pr-command-clnmr.web.app
   - Click **Sign in with GitHub**.
   - On GitHub's consent screen, make sure **univelop** shows as granted. If it shows a
     **Request** button instead, click it and tell Colin.

6. **Test it** once Colin confirms the secret is set
   - Open one of your PRs, press `a` (Agent), type something harmless such as "Summarize
     this PR", and press `⌘↵`.
   - Within about a minute, the PR shows a session link (`s` opens it), and it moves to
     **With agent**.
   - If you see an error saying "has no Claude routine set up yet", the secret is missing or
     misspelled. Send Colin the exact error.

## Good to know

- **Mergeable (`m`)** merges once CI is green. If there are conflicts or failing checks, a
  merge agent fixes them first. If it can't, the PR comes back with a ⚠️ WARNING at the top of
  its description.
- **Agent sessions** run in your account. Anything they push to your branch shows as you.
- **To stop**, delete the routine in claude.ai. The app then shows an error when you press
  `a`, and everything else keeps working.

---

## For Colin: adding a colleague's routine

For each `{"login", "id", "token"}` you receive:

```sh
LOGIN=their-github-login
NAME="CLAUDE_ROUTINE_$(tr 'a-z-' 'A-Z_' <<<"$LOGIN")"     # e.g. Flo-Mueller → CLAUDE_ROUTINE_FLO_MUELLER
gh secret set "$NAME" -R univelop/aya
# At the prompt, paste: {"id":"trig_…","token":"sk-ant-oat01-…"}
```

- The prompt keeps the token out of your shell history. Paste the values only there, never
  into chat. Afterwards, delete the share link.
- Check that it's there with `gh secret list -R univelop/aya | grep CLAUDE_ROUTINE_`.
- Your own routine needs a secret too, `CLAUDE_ROUTINE_CLNMR`. Once that exists, the old
  `CLAUDE_ROUTINES` secret is unused and can be deleted:
  `gh secret delete CLAUDE_ROUTINES -R univelop/aya`.
- New org members: add their login to both `allowed_users` lists in
  `aya/.github/workflows/pr-command.yml`.
