---
date: "2026-11-05"
scripts: "none"
summary: "Both versions; reading GitHub's and git's docs, today's key walls with file and line, and public Copilot commits. It works free with no second server: each person's host keeps its own key of the one shared app in the keychain, mints a 1-hour token pinned to its own installation, one repo, `contents` and `pull_requests` write, and builds each commit through GitHub's API with no author, so GitHub signs it as the bot (Verified); a `git push` would be unsigned. The bot's email uses the bot user's id, not the app's (`github-actions`: app 15368, bot 41898282), which fixes the note's sketch. The shared app is public and owned by a free org both people own, so each makes their own key (up to 25 per app). Any key mints for any installation and GitHub cannot tie a key to one: the host pins its own, each person picks repos, keys revoke alone, the ledger records the key's fingerprint. The bot can never approve its own pull requests; the host has no review or merge call. The person meets setup once, then nothing. One `Fabrika-Input` line per input; git allows the repeat. Lean 75%; the doubts are how the co-author shows, whether an app manager can make a key, and file modes through the API, each settled by one test commit. No model, $0. 2026-11-06, the first real app, `fabrikalfa`: the bot pushes only its own branches under the repo's rules, an unsigned commit shows no badge, one signed with a step key shows \"Unverified\", and a step's signature in a git note checks from a fresh clone."
---

# How should agents commit and push as the fabrika bot, with the person as co-author?

Read 2026-11-05. **This is reading only.** No GitHub App was made, no key, no setting changed, no
model, $0. It builds on [agents commit as a bot](../docs/direction/agents-commit-as-a-bot.md)
(proposed, merged in pull request 389), which decided that agents commit as a GitHub App's bot with the
person as `Co-authored-by`. On 2026-11-05 the owner also decided there is **one shared fabrika
bot**: one GitHub App for both people who share a ledger, not one per person. Neither is argued
again here. Both versions: the GitHub facts hold for each, and the code it reads is today's
(`packages/fabrika`, `packages/pipeline`, main at `5d07cfcf`).

**The answer.** It works with free GitHub features and no second server.

- The host on each person's laptop holds that person's own private key of the shared app, in the
  system keychain, outside every sandbox. Once an hour it signs a 10-minute JWT and trades it for
  an installation token, pinned to its own person's installation, one repo, and two permissions.
- The host builds each commit through GitHub's API, not `git push`, with no author field. GitHub
  then authors it as the bot and signs it, so it shows **Verified**. The person rides along in a
  `Co-authored-by` trailer the host writes.
- The app is owned by a free organization both people own, and set to public so it installs on
  their personal repos. Each person makes their own key on the app's page, so no key ever passes
  between people.
- What GitHub cannot limit: any key of an app can mint a token for every installation of that app.
  The host pins its own installation, each person picks the repos the bot may touch, and a key is
  revoked alone. Past that, the two people trust each other's laptops, as they already do with
  each other's agents in the shared ledger.

**How sure: 75%.** The doubt is three things no doc settles and one test commit would: that the
co-author shows the way the owner expects, that an org's app manager can make their own key, and
how much work it is for the host to turn a local commit into API calls.

```ts
// A sketch, both versions. The host, once an hour and once per commit. No agent sees any of it.
// Names follow GitHub's REST and GraphQL docs; `keychain` and `Push` are made up here.
const jwt = signRS256(keychain.read("fabrika-app-key"), {
	iat: now - 60, // GitHub: set 60 seconds in the past
	exp: now + 9 * 60, // GitHub: no more than 10 minutes ahead
	iss: CLIENT_ID, // the shared app's client id, the same in both hosts
});
const {token, expires_at} = POST(`/app/installations/${MY_INSTALLATION}/access_tokens`, jwt, {
	repository_ids: [push.repo], // this repo only
	permissions: {contents: "write", pull_requests: "write"}, // nothing else
}); // lives 1 hour; MY_INSTALLATION is this person's, pinned in the host's settings

// One commit, made by GitHub, so it is signed and authored by the bot.
graphql(token, "createCommitOnBranch", {
	branch: {repositoryNameWithOwner: push.repo, branchName: `fabrika/${push.run}`},
	expectedHeadOid: push.remoteHead, // refused if the branch moved
	fileChanges: {additions: push.added, deletions: push.deleted}, // from the agent's worktree
	message: {
		headline: "map: take a ticket from a pipe",
		body: [
			"Co-authored-by: <the person> <ID+login@users.noreply.github.com>",
			"Fabrika-Agent: agents/github:<member>/claude",
			"Fabrika-Input: in-3f9a12c0-41", // one line per input that went into it (section 9)
			"Fabrika-Input: in-3f9a12c0-44",
		].join("\n"),
	},
});
// On GitHub: author fabrika[bot] <BOT_USER_ID+fabrika[bot]@users.noreply.github.com>,
// committer GitHub, Verified, and the person shown as co-author.
```

## The question

How should agents commit and push as one shared GitHub App bot, with the person as co-author,
using only free GitHub features and no second server? The rules it is held to: no new paid
accounts; a design that needs a second server fails; no agent approves or merges (AGENTS.md); and
"Secure and simple": say when a person meets each step and how often.

## 1. Identity: who GitHub says made the commit

- **The bot's email is `<bot user id>+<slug>[bot]@users.noreply.github.com`.** GitHub's
  [email addresses reference](https://docs.github.com/en/account-and-profile/reference/email-addresses-reference)
  gives the `ID+USERNAME@users.noreply.github.com` form and says the ID form keeps commits tied to
  the account after a rename. The ID is the **bot user's** id, not the app's id. Checked:
  `github-actions` is app 15368, but its bot user `github-actions[bot]` is 41898282, and
  41898282 is the number in the email every workflow uses. The sketch in the bot note writes
  `APP_ID+fabrika[bot]`; that is wrong, this pull request fixes the sketch, and the host should
  read the id from `GET /users/fabrika%5Bbot%5D` once.
- **With the API path, the email is not ours to write.** Commits GitHub builds through
  `createCommitOnBranch` are made "as the authenticated user", and the mutation "does not support
  specifying the author or committer"
  ([GraphQL commits reference](https://docs.github.com/en/graphql/reference/commits)). With an
  installation token, that user is the bot. So the address above only matters for a `git push`.
- **The person rides along in a trailer.** One line per person, after a blank line, with an email
  tied to their account, or their noreply address to keep it private
  ([creating a commit with multiple authors](https://docs.github.com/en/pull-requests/committing-changes-to-your-project/creating-and-editing-commits/creating-a-commit-with-multiple-authors)).
  Git reads trailers as `key: value` lines in the last paragraph of the message
  ([git interpret-trailers](https://git-scm.com/docs/git-interpret-trailers)), so
  `Fabrika-Agent` and `Fabrika-Input` sit in the same block.
- **Does it count for the person?** GitHub's profile counts "commits you've made or co-authored"
  ([contributions on your profile](https://docs.github.com/en/account-and-profile/concepts/contributions-on-your-profile)),
  once the commit is on the default branch and the email is the person's
  ([what counts](https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference)).
  No GitHub doc says how the co-author is drawn on the page. GitHub shows co-author avatars beside
  the author, but that is the UI as seen, not a doc; one test commit settles it.
- **How Copilot does it.** GitHub's coding agent commits "with the developer who assigned the issue
  or requested the change to the pull request marked as the co-author", and its commits "appear as
  Verified" ([risks and mitigations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations)).
  Three public Copilot commits from today, read through the API: author
  `198982749+Copilot@users.noreply.github.com`, committer `noreply@github.com`, verified, two of
  three with a `Co-authored-by`. That is the API path below.
- **After a squash merge, main keeps the bot.** Four public squash merges of bot pull requests
  read today: the commit on main is authored by the bot that opened the pull request, committed by
  GitHub, verified. This repo squashes with `COMMIT_MESSAGES` as the body, so the commits'
  `Co-authored-by` lines should land on main too. Seen, not documented; the test commit checks it.

## 2. Tokens with no server

**Yes, a desktop host can mint its own token with no webhook and no server.** Nothing in the token
steps needs GitHub to call us.

| Step | What GitHub says |
|---|---|
| Sign a JWT with the app's private key | Claims `iat`, `exp`, `iss`; `exp` "no more than 10 minutes into the future"; `iss` is the client id (recommended) or app id; `RS256` ([JWT docs](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)) |
| Trade it for an installation token | `POST /app/installations/INSTALLATION_ID/access_tokens`; "will expire after 1 hour" ([installation docs](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)) |
| Narrow the token | `repositories` or `repository_ids` (up to 500), and `permissions`; never more than the installation has ([REST apps](https://docs.github.com/en/rest/apps/apps)) |
| Narrow the app | "Only select repositories" when installing ([installing your own app](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app)) |

- **Least permissions for push and a pull request:** `contents: write` (git data endpoints, and
  merge) and `pull_requests: write` (open a pull request); `metadata: read` comes with every app
  ([permissions for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)).
  Leave out `workflows`: that page lists ref and contents writes under it too, which reads as "a
  change under `.github/workflows` needs it". Without it the bot cannot change CI. Check with
  GitHub's `X-Accepted-GitHub-Permissions` header on the test push.
- **No webhook.** The app's webhook can be set inactive (`hook_attributes.active: false`,
  [manifest docs](https://docs.github.com/en/apps/creating-github-apps/setting-up-a-github-app/creating-a-github-app-from-a-manifest)).
  The host never waits on GitHub; it asks.
- **Pushes from an app token start CI.** A push made with the workflow's own `GITHUB_TOKEN` starts
  no workflow, and GitHub names an installation token as the way to start one
  ([triggering a workflow](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow#triggering-a-workflow-from-a-workflow)).
  So this repo's CI runs on the bot's pull requests as it does today.

**A doubt GitHub itself raises.** GitHub's best practices say a native app "must never ship your
private key with your app" and "should not generate installation access tokens"; it should use
user tokens instead
([best practices](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app)).
That rule is about one key copied into every user's install. Here each person makes their own key
on their own laptop, and fabrika ships none. A user token would not do the job anyway: what it
writes is the person's, with an app badge, which is the very thing the bot note undoes. Said
plainly: this is a use GitHub's guide does not picture.

## 3. One shared app for two people

Settled by the owner: one app. This section says how it works.

- **Who may install it.** A private app "can only be installed on the account that owns the app"
  ([public or private](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private)).
  Both people keep repos on their own accounts, so a shared app is **public**: "any user on GitHub
  can install it". Public is not listed: the GitHub Marketplace is a separate step nobody takes.
  No doc names a cost for either.
- **Who owns it.** If one person's account owns the app, only that person can make keys, so the
  second person's key would be made by the first and sent over: a secret crossing between people.
  A **free organization** owns it instead. Its owners can name "GitHub App managers", who "can
  manage the settings of some or all of the GitHub App registrations"
  ([app managers](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/adding-and-removing-github-app-managers-in-your-organization)).
  With both people as org owners, each makes their own key. That a manager can make a key is not
  in that page; it is where the key button lives. One check settles it.
- **One key per person.** An app holds "up to 25 private keys", GitHub keeps "only the public
  portion", keys do not expire, and each is deleted alone, but never the last one
  ([managing private keys](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps)).
  So each host holds its own key, a lost laptop costs one key, and the other person works on.
- **Any key reaches every installation.** `POST /app/installations/{id}/access_tokens` asks for a
  JWT and nothing more ([REST apps](https://docs.github.com/en/rest/apps/apps)). GitHub has no
  way to tie a key to an installation. So the second person's key can mint a token for the first
  person's repos, with every permission that installation grants.

How the reach is held down, and what is left:

| Limit | Who holds it | What it stops |
|---|---|---|
| "Only select repositories" on each install | Each person, on GitHub | The bot sees only the repos that person picked |
| Two permissions, no `workflows`, no admin | The app's settings, on GitHub | Changing CI, settings, members |
| The host mints only for its own pinned installation, one repo per token | The host's code | An honest host acting in the other person's repos |
| One key per person, revoked alone | Either org owner, on GitHub | A stolen key living on after a lost laptop |
| Each push recorded with the key's fingerprint | The ledger | Not knowing whose host pushed |

- **What still cannot be limited.** A key taken off one laptop mints tokens for both people's
  picked repos. GitHub records the bot, not which key. This is the industry's model:
  [actions/create-github-app-token](https://github.com/actions/create-github-app-token) and Probot
  apps hold one app key per runner and narrow by installation and permissions the same way. The
  two people already answer for their own agents in one ledger
  ([the ledger, section 10](../docs/direction/the-ledger-goes-to-cloudflare.md)); this adds the
  laptops to that trust.
- **A public app can be installed by a stranger.** It gives our keys reach into their repos, not
  theirs into ours. The pinned installation means a host never mints for one.

## 4. Signing: which path shows Verified

- **The API path is verified.** GitHub marks a bot commit verified when "the request is verified
  and authenticated as the GitHub App or bot and contains no custom author information, custom
  committer information, and no custom signature information"
  ([commit signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification)).
  `createCommitOnBranch` commits "are automatically signed by GitHub if supported"
  ([GraphQL commits](https://docs.github.com/en/graphql/reference/commits)). The REST git data
  path (`git/blobs`, `git/trees`, `git/commits` with no `author`, then `git/refs`) fits the same
  rule. Copilot's commits read today are this: committer `noreply@github.com`, verified.
- **A plain `git push` is not.** The commit is made on the laptop; GitHub only stores it. No
  signature means no badge. A bot account has no settings page to add a GPG key to, so the host
  cannot sign it either. And an unsigned commit's author line is only a claim: anyone can write
  `fabrika[bot]` in one.
- **What the API path costs.** The agent still works in a local worktree, and the host turns its
  changes into API calls: the changed files, the expected head, the message. After the call the
  host resets the local branch to GitHub's commit, since the hashes differ. Files go up whole, as
  base64, so a large binary change costs a big request. Tools that do this exist, such as
  [planetscale/ghcommit](https://github.com/planetscale/ghcommit). An installation's API budget is
  5,000 requests an hour or more, far above a lane's commits.

**Lean: the API path, 80%.** Why: it is the only way the bot's commits are proven to come from the
app, and it is what Copilot does. Cost: the host owns a "commit through GitHub" step, about one
file and its test, and loses `git push`'s speed on big changes. The doubt: renames, file modes
(an executable bit) and symlinks in `fileChanges`; the test commit should carry one of each.

## 5. Branch rules, and no agent approval

- **Merging.** `gh api repos/<owner>/tea-fabrika/rules/branches/main --jq length` gives `0`, and
  classic protection says "Branch not protected". So a bot's pull request merges like any other
  today. If a rule is added later, a GitHub App can sit on a ruleset's bypass list
  ([about rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets));
  the bot should not, since it only pushes its own branches.
- **Approving.** There is no separate review permission: creating a review needs
  `pull_requests: write`, the same one that opens a pull request
  ([permissions for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)).
  So the token could approve. What holds it:
  - "Pull request authors cannot approve their own pull requests"
    ([required reviews](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/approving-a-pull-request-with-required-reviews)).
    With one shared bot, every agent pull request has the bot as author, so no agent, either
    person's, can approve any of them. The shared bot makes this wall wider, not narrower.
  - A pull request a person opened is still open to the bot's approval. That wall is code: no
    agent holds the token, and the host has no review or merge call at all.
  - Merge needs `contents: write`, which the bot must have to push. Same wall: no merge call in
    the host. Today's ship step merges with the person's own login, and stays so.
- **What changes for the owner.** Today the owner opens every pull request as themselves and
  cannot approve their own. With the bot as author, the owner can approve an agent's pull
  request. The no-agent-approval rule is unchanged: the approver is a person.

## 6. Where the private key lives

**Today the host has no secret store of its own.** It lends `gh`'s: `hostEnv` passes `USER`, so
`gh` finds its login in the system keychain, plus `GH_CONFIG_DIR`, `GH_TOKEN`, `GITHUB_TOKEN`
(`packages/fabrika/src/agents/claude/env.ts:67-78`). The walls that keep a GitHub key out of a
sandbox:

- `GITHUB_KEYS` names the four token variables, "never handed into a sandbox"
  (`packages/fabrika/src/sandbox/sandbox.ts:90-96`).
- `keysOf` collects their values plus any the host names, and `refuseKeys` refuses a launch that
  carries one in a name, an argument or a lent file (`sandbox.ts:166-200`). The `keys` option is
  for "GitHub keys the host holds outside its environment, such as one gh read from the keychain"
  (`sandbox.ts:242`).
- The builder's sandbox denies reading home (`packages/fabrika/src/agents/claude/sandbox.ts:182`)
  and names the login files (`sandbox.ts:47-56`); the OS sandbox does the same
  (`packages/fabrika/src/sandbox/os.ts:56`). Experiment 77b showed the keychain closed from inside.

**Lean: the system keychain, read by the host alone, 80%.** The PEM goes in as one keychain item
at setup; the host reads it when it signs, holds it as `Redacted`, and hands both the key and each
minted token to `keysOf` so `refuseKeys` looks for them too. Why: it is where `gh` keeps the
person's login today, GitHub calls the key "the single most valuable secret" and wants a vault,
and the keychain is the laptop's vault, free and already there. Cost: one small keychain reader,
per platform. The doubt: Linux has no single keychain, and a laptop with none falls back to a
`0600` file under the host's own home, which the sandboxes already cannot read. No agent ever
sees the key or a token: the agent asks the host to push over the fabrika connection, and the host
pushes.

## 7. What the person meets

| When | Who | What | How often |
|---|---|---|---|
| Making the bot | One org owner | Make a free org, then one click on a page the host opens: GitHub's app manifest flow with the name, two permissions, webhook off, public | Once, ever |
| Joining | Each person | Install the app on their account, pick repos; make their own key on the app's page; the host takes it into the keychain and pins the installation | Once per person |
| A new repo | Each person | Add it to their install's repo list on GitHub | Once per repo |
| Daily work | Nobody | The host mints a token every hour and commits through the API | Never |
| A lost laptop | Either org owner | Delete that one key; make a new one on the new laptop | Rare |

- **The manifest flow needs no second server.** GitHub sends the browser back to `redirect_url`
  with a code, and the host trades it within the hour for the app's id and key with
  `POST /app-manifests/{code}/conversions`
  ([manifest docs](https://docs.github.com/en/apps/creating-github-apps/setting-up-a-github-app/creating-a-github-app-from-a-manifest)).
  The redirect is a browser redirect, so a `localhost` page in the host can take it, as Probot's
  local setup does ([Probot development](https://probot.github.io/docs/development/)). The docs do
  not say `localhost` is allowed; Probot doing it is the evidence. If it fails, the person fills
  GitHub's form by hand once.
- **The second person makes no app.** The manifest flow runs once for the whole bot. The key the
  flow returns goes to the person who ran it; the second person makes their own on the app's page.

## 8. What the switch changes in today's version

Today the lead session and its agents commit as the owner, through the owner's git and `gh`, with
a `Co-Authored-By` line the agent writes itself. Pipeline lanes commit as `fabrika lane
<lane@fabrika.invalid>` (`packages/pipeline/src/stages/pipeline/work.ts:150-156`) and push with the
owner's login.

- Lanes: the made-up lane identity goes; lane commits become the bot's, verified.
- Pull requests from agents are the bot's, so the owner can approve them, and they leave the
  owner's own "my pull requests" list. GitHub's `author:app/<slug>` search finds them.
- The trailers are the host's, not the agent's: `Co-authored-by` for the person, plus which agent
  and which input.
- The owner's login leaves agents' hands for pushes. A Claude Code session the owner starts in a
  terminal keeps committing as the owner until it pushes through the host; nothing breaks meanwhile.
- Changes under `.github/workflows` are the person's to commit, if `workflows` stays out.
- Main's history from here mixes the owner (by hand) and the bot (agents). Old commits stay as they
  are.

## 9. `Fabrika-Input` when several inputs make one commit

One commit often comes from more than one input: the person says "fix #7", then "also the test",
and the agent's work is committed once.

- **Git allows a repeated key.** git's own example carries two `Signed-off-by` lines, and the
  default `trailer.ifExists` is `addIfDifferentNeighbor`: a line is added unless the same key and
  value sit right beside it ([git interpret-trailers](https://git-scm.com/docs/git-interpret-trailers)).
  Checked with git 2.40.1: `in-a-41`, `in-a-44`, `in-a-44` came out as two lines, the neighbor
  repeat dropped, and `git log --format='%(trailers:key=Fabrika-Input,valueonly)'` printed both ids.
- **The industry repeats the line, never a list in one line.** `Co-authored-by` is one line per
  person, `Signed-off-by` one line per signer. A comma list would be a format of our own to parse.

**Lean: one `Fabrika-Input` line per input, every input since the branch's last commit, oldest
first, 80%.** Why: the commit is one write with several causes, and the data rule says a fact that
exists only when it is written goes in now. Keeping only the last input loses "fix #7", which is
the reason the commit exists; the ledger could rebuild it only if it also kept which inputs went
into which commit, which is this same list. Cost: a long session makes a long trailer block. The
doubt: how long, in real use. The push entry records the count, so real lanes say whether a limit
is needed, and what number.

```text
A sketch, both versions. Two inputs, one commit.

map: take a ticket from a pipe

Co-authored-by: <the person> <ID+login@users.noreply.github.com>
Fabrika-Agent: agents/github:<member>/claude
Fabrika-Input: in-3f9a12c0-41
Fabrika-Input: in-3f9a12c0-44
```

- The host writes the lines and drops a repeat itself, not leaning on git's neighbor rule.
- Each id leads to its envelope, which names its sender. If the other person sent one of them, the
  envelope says so; `Co-authored-by` still names the person the agent works for, as decided.

## 10. The first real app, 2026-11-06

The owner made the app that day, so the doubts above could be tried. It is `fabrikalfa` (fabrika
and kalfa, a journeyman), owned by the kamp-us organization and public, with `contents` and
`pull_requests` write and nothing else. It was made through GitHub's manifest flow: a local page
filled in the settings, the owner clicked Create, and a script traded the one-time code for the
app and put its private key in the keychain without printing it. The test key stays in the
keychain until the brain holds it.

| What was tried | What came back |
|---|---|
| A token from the app's key, for one repo | 1 hour, that repo only |
| The bot pushes a `fabrikalfa/test` branch | allowed |
| The bot pushes any other branch, or main | refused by the repo's rules (`GH013`) |
| Who GitHub says made the commit | `fabrikalfa[bot]`, from the bot user's id in the email |
| An unsigned bot commit | `unsigned`, no badge |
| A bot commit signed with a key GitHub does not know | `unknown_key`, shown "Unverified" |
| `main`'s latest squash commit | Verified, committed by GitHub |
| A step's signature in a git note, read back by a fresh clone with no login | the signature checks; one word changed fails |
| A rebase | drops the note; `notes.rewriteRef` carries it, but the signature names the old commit |

The repo's rules, added that day: `main` changes only through a pull request and is never
force-pushed or deleted, and outside `fabrikalfa/*` only people with the admin or write role may
push. A GitHub App is not covered by a role, so the bot is held to its own branches. The rules do
not cover `refs/notes/*`, so the bot can rewrite a note; without a step key it cannot forge one.

*Wrong guess, kept:* "the `fabrika[bot]` login looked free". GitHub reserves an app's name for the
user account of the same name, and a user named `fabrika` exists.

*A first try pushed as the person, not the bot:* git's own credential helpers answered before the
bot's token did. The second try ran git with no global or system config and the token in one
header. A host that pushes for an agent has to do the same.

## Data shape

A fact that exists only at push time goes in the ledger now, on the push entry: the agent, the
person, the input, the installation id, the repo, the branch, the commit GitHub returned, and the
**fingerprint of the key that minted the token** (GitHub shows each key's SHA-256 fingerprint).
With one shared bot, GitHub cannot say whose host pushed; the ledger can. The fingerprint is the
host's own word, so it is recorded, never used to decide. The token itself is never recorded.

## Owner calls

1. Own the shared bot by a free organization both people own, and make the app public so it
   installs on personal repos? Yes or no.
   **Answered (owner, 2026-11-06): kamp-us, public.** Not an organization of only two people:
   kamp-us has more owners, and any owner can make a key. The repo's rules hold what such a key can
   do to the bot's own branches. One bot serves every project the owner runs fabrika on, not
   everyone; a self-hoster makes their own app.
2. Build every bot commit through GitHub's API so it shows Verified, not `git push`? Yes or no.
   **No, for the first version (owner, 2026-11-06).** Agents use plain `git push` (call 4). Main
   still shows Verified, because what lands there is GitHub's own squash commit, which GitHub
   signs. Commits on a pull request's branch carry no GitHub badge. Two ways to badge them were
   turned down: replaying each push through the API, since it rewrites the agent's commits under
   new hashes, and a machine user holding the signing keys, since every person would need a
   second GitHub account and a long-lived token. API commits stay possible later, if branch
   badges come to matter.
3. Leave the `workflows` permission out, so the person commits CI changes? Yes or no.
   *Built without it on 2026-11-06; the owner has not ruled.*
4. Keep the app's private key in the system keychain, read only by the host? Yes or no.
   **Changed to a stand-in token (owner, 2026-11-06).** The real key stays with the host (in
   `next/`, the brain), outside every box. Inside the box, `git` and `gh` see a fake token; a
   proxy at the box's network edge swaps it for a real 1-hour token limited to one repo and one
   branch. Agents keep plain `git push` and `gh`, so people whose agent skills already use them
   move over without change. Section 6's "the agent asks the host to push" is replaced by this.
5. One `Fabrika-Input` line for every input since the branch's last commit? Yes or no.

## Made up here

The keychain item name, the `fabrika/<run>` branch prefix, `push` and its fields, `CLIENT_ID`,
`MY_INSTALLATION`, the app slug `fabrika` (wrong: the name was taken, see section 10), and the shape of the push entry.

## What it cannot tell us

- Nothing was run. No app, key, token or commit was made.
- How GitHub draws a bot commit's co-author, and whether it lands on the person's graph. One test
  commit on a scratch repo shows both.
- Whether an org's app manager can make a key, or only an owner. Making both people owners avoids
  the question.
- Whether `createCommitOnBranch` keeps an executable bit and a symlink. If not, the REST git data
  path does, at a few more calls.
- Whether `localhost` works as the manifest `redirect_url`. Probot says yes in practice; GitHub's
  docs are silent.
- Whether GitHub will one day tie a key to an installation. If it does, the trust between laptops
  in section 3 narrows.
