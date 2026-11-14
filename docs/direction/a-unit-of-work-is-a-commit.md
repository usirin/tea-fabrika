---
state: "decided 2026-11-05; fetch signing changed 2026-11-08; hand-run signing dropped 2026-11-13"
summary: "Both versions, `next/` first. An exam change is its own commit by an agent that is not the builder, inside the same pull request. Each step's agent signs its commits with its own key, into a git note on `refs/notes/fabrika` so GitHub shows no \"Unverified\", and CI decides from that signature: no valid signature from a known step key is `stuck: unsigned_commit`, a `build` commit on an exam path `stuck: build_touched_exam`; a trailer is for people only. Each step still records its commit as a `committed` entry (in Tier 1, its `field/` row). Any exam path touched gets the lead's check, and only real loosening asks the owner ([0014](../../.decisions/0014-the-lead-merges-when-every-step-passed.md); it said: asks the owner to read it). Replaces the CI half of nobody writes their own exam. *Changed 2026-11-07: a step signs the link (step, ticket, version, tree before, tree after), not the commit ([experiment 221](../../experiments/221-signed-steps-and-rebases.md)).* *Changed 2026-11-08 (owner): today's tooling signs missing links at fetch in MAIN after checking run bounds and owners; agents still commit, and keys stay out of boxes. A catch-up conflict on exam paths goes through a tests run and is signed tests; other catch-up merges stay lead links (lead).* *Changed 2026-11-13 (owner, [0161](../../.decisions/0161-no-step-signing-by-hand.md)): today's hand-run tooling stops signing; this stays the design for `next/`'s own pipeline.*"
---

# A unit of work is a commit

**Decided by the owner, 2026-11-05.** Both versions, built for `next/` first. It answers Tier 1's
open question 18, and it replaces the CI half of
[nobody writes their own exam](./nobody-writes-their-own-exam.md), which was proposed at 75% and
doubted by its own note. That note's core stays: the builder never touches the exam, and changing
the exam is the owner's call. CI decides from each step's signature; squash merges stay, and each
step signs a link from tree to tree that survives the squash. Changed by the owner, 2026-11-08:
today's tooling signs at fetch in MAIN, after checking the recorded run and file owners. Agents
still commit. This replaces the 2026-11-05 agent-signs call.

*Changed 2026-11-13 (owner, [0161](../../.decisions/0161-no-step-signing-by-hand.md)): today's
hand-run tooling stops signing. A step's commit is a plain commit, and CI no longer decides from a
signature there. The builder still never touches the exam. This note stays the design for `next/`'s
own pipeline.*

*Changed 2026-11-08 (owner): code signs each step's commits, not the step's agent. The lead's
fetch signs them as it pulls a box's branch (`box.sh fetch --sign <step>`), with that step's key.
The key stays one per step, and CI still decides from the signature. Built for today's
tooling by skills friction PR 1a (tracker 321). It said: "each
step's agent signs its commits with its own key".*

*Renamed 2026-11-08 (question 15): the link's `cause` is now `parent`, with `traceId` beside it; a link with `cause` is refused.*

```text
// A sketch. Tier 1's P6, one pull request, two step commits, oldest first, each signed.
a1f0c3e  signed by tests  boundary-rules.json, next/packages/libfabrika/package.json, src/data/log.test.ts
b72d9e4  signed by build  next/packages/libfabrika/src/data/log.ts, src/data/ledger.ts
```

```ts
// What each step's run records, one entry per commit it made. Kept wide; CI does not read it.
{_tag: "committed", step: "tests", sha: "a1f0c3e", by: "agent:test-writer", arrivedAt: "21:02:11", parent: "in-3f9a0c21-7", traceId: "t1"}
{_tag: "committed", step: "build", sha: "b72d9e4", by: "agent:builder",     arrivedAt: "21:40:56", parent: "in-3f9a0c21-9", traceId: "t1"}

// CI walks the pull request's commits and decides from each signature, never from the message.
// `stepKeys` is the repo's allowed-signers file: one public key per step role.
const check = (commit: Commit, stepKeys: StepKeys): Outcome => {
	const step = stepKeys.verify(commit); // ssh-keygen -Y verify on its note in refs/notes/fabrika
	if (step === undefined) return {_tag: "stuck", why: "unsigned_commit", sha: commit.sha};
	if (step === "build" && commit.files.some(isExam))
		return {_tag: "stuck", why: "build_touched_exam", sha: commit.sha};
	return {_tag: "done"};
};
// And the pull request as a whole: any exam path touched asks the owner to read it.
// {_tag: "ask", who: "owner", for: "exam_read", paths: ["boundary-rules.json"]}
```

- **The unit is the commit, not the pull request.** An exam change is its own commit, made by an
  agent that is not the builder, inside the same pull request.
- **The test writer's commit comes first on the branch,** and it may touch exam paths: a boundary
  row, a ledger line, a catalog line a test needs, an exam test moved to a new bundler.
- **Code signs each step's link with that step's key.** Owner, 2026-11-08: today's `fetch --sign`
  checks the saved run, ticket, bounds and file owners before signing missing notes in MAIN.
  Existing notes and verified person signatures stay unchanged. The SSHSIG shape stays
  `ssh-keygen -Y sign`, namespace `fabrika-step`, the shape the door checks. Mutation still uses
  the tests key; no new role. [A key per client](./a-key-per-client-and-no-github-trust.md)
  already gives every client a key; a step is one more.
- **The signature goes in a git note, not in the commit.** *Changed 2026-11-06, the owner asking
  for no "Unverified" on GitHub.* Each step adds a note on `refs/notes/fabrika` to its commit,
  holding what it signs, the link (its step, the ticket, a version, the tree before and the tree
  after), the key's fingerprint and the signature. *Changed 2026-11-07 (owner, from [experiment
  221](../../experiments/221-signed-steps-and-rebases.md)): a step signs the link, not the commit,
  so a rebase can later carry it by replay, and only a step's newest signature for the ticket
  counts. Tier 1 stays merge-only. It said: "holding what it signs (its step, the commit, its tree,
  its parent)".* GitHub labels a commit signed with a key it does not know "Unverified"
  (`unknown_key`), and a bot account cannot register a key; a commit with nothing in its signature
  slot shows no badge. Tested that day with the bot: the commit showed no badge, a fresh clone with
  no login fetched the note and the signature checked, and a note with one word changed failed.
  gittuf, an OpenSSF project, keeps its signatures in the repo's own refs the same way.
- **CI verifies each commit's signature and maps the key to its step.** A commit with no valid
  signature from a known step key is `stuck: unsigned_commit`. A `build` commit that touches an exam
  path is `stuck: build_touched_exam`.
- **Every step's run still records the commit it made,** as a `committed` entry: `step`, `sha`,
  `by`, `arrivedAt`, `parent` and `traceId` ([record wide](../../AGENTS.md#before-you-design-anything)). It is
  not what CI decides from. In Tier 1, while the steps run by hand, the step's `field/` row stands
  in.
- **A trailer is for people.** `Step: tests` or `Step: build` at the end of a commit message helps
  someone reading `git log`. Anyone can type one, so CI never reads it.
- **Any pull request that touches an exam path asks the owner to read it,** flagged by path, from
  the one list of exam paths.

## What Tier 1 needs

- **A key per step role that commits:** `tests`, `build`, and `lead` for the lead agent's own
  commits, such as a merge from main. Ed25519, made once.
- **Where the private halves live:** in the lead session's home on the laptop, one file per role,
  never in the repo or box. Owner, 2026-11-08: MAIN's fetch signer opens them. No key is copied or
  printed. A temporary gitdir gives the signer its own detached HEAD; MAIN's checkout and index
  stay put. The signature proves which step run supplied the commit, not which agent typed it.
- **How CI knows the public halves:** one file in the repo in git's allowed-signers format, the
  role as each key's name. It is an exam path, so a change to it asks the owner.
- **Tier 1's P32 builds it,** with planted commits for each answer.

**A person signs too** (decided by the owner, 2026-11-08). A person's own commit on a pull request
passes the commit check like a step's. It walks back p87's "a fourth role" plant.

```text
# allowed_signers, one line per member. A sketch: the id and key are made up.
person:<id> namespaces="git" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI...
```

- **A person signs with git's own SSH commit signing** (`gpg.format ssh`, `commit.gpgsign true`).
  The check reads the commit's signature against their line, with `namespaces="git"`. No note and
  no `pnpm` command for people. *It said first, the same day: a `fabrika-step` line and a
  `pnpm commits sign --person` note; the owner replaced that before it was built.*
- **The key line comes from GitHub's list of the person's signing keys,** copied into a pull
  request the owner approves. GitHub helps find the key and is never trusted for it
  ([a key per client](./a-key-per-client-and-no-github-trust.md)). Added by hand for now; from
  Tier 3, from the ledger's members.
- **Exam files get the lead's check,** and a person's commit is never `build_touched_exam`. Only
  real loosening of a law waits on the owner
  ([0014](../../.decisions/0014-the-lead-merges-when-every-step-passed.md)). *Changed 2026-11-09
  (owner): it said exam files still need the owner's read.*
- Ticket 251 builds it.

## Squash merges stay: each step signs a link from tree to tree

**Decided by the owner, 2026-11-05.** This repo squashes each pull request into one commit on
`main`, and that stays. A squash drops the step commits, and their signatures with them. So each
step also signs a small statement of what it changed, in in-toto's shape (in-toto calls it a link),
and CI checks the chain of links from `main`'s tree to the squash commit's tree.

```ts
// A sketch. What a step signs: the tree before it and the tree after it. The ledger's words.
{_tag: "attested", step: "tests", from: "4b1d0e7", to: "9e02a1c", by: "agent:test-writer",
 key: "SHA256:Tq3...", sig: "-----BEGIN SSH SIGNATURE-----...", arrivedAt: "21:02:11", parent: "in-3f9a0c21-7", traceId: "t1"}
{_tag: "attested", step: "build", from: "9e02a1c", to: "c7a8f55", by: "agent:builder",
 key: "SHA256:Bx9...", sig: "-----BEGIN SSH SIGNATURE-----...", arrivedAt: "21:40:56", parent: "in-3f9a0c21-9", traceId: "t1"}

// CI: the first link starts at the tree where the branch left main, each link starts where the
// last one ended, the last ends at the head's tree, and every `sig` checks against a known step
// key. (Changed 2026-11-11 by 0098: it said main's tree and the squash commit's tree.)
// A gap or a bad signature: {_tag: "stuck", why: "broken_chain"}. A `build` link whose change
// touches an exam path: {_tag: "stuck", why: "build_touched_exam"}.
```

- **A tree, not a commit.** A tree's id depends only on the files, so it survives a squash. The
  commit ids do not.
- **When `main` moved.** The branch is brought up to date by merging `main` in, as a `lead` link from
  the old tree to the merged one. The squash's tree must equal the last link's `to`, so a pull
  request merges only when it is up to date. *Changed 2026-11-07 (owner): in Tier 1 this is the only
  way. A branch catches up by merging `main` in, with no rebases and no native stacks yet. The row
  that first allows a rebase carries each link across it by replay, Gerrit's trivial-rebase check
  ([experiment 221](../../experiments/221-signed-steps-and-rebases.md)).*
  Lead, 2026-11-08: a catch-up merge of main whose conflict touches exam paths is resolved by a
  tests run and signed tests, not lead; every other catch-up merge stays a lead link.
  *Changed 2026-11-11 by [0098](../../.decisions/0098-the-signed-chain-covers-the-branch-not-main.md):
  the chain runs from the tree where the branch left `main` to the head's tree, so a pull request
  behind `main` is not refused and may land without the merge; a merge that is made stays a link.*
- **No transparency-log server.** in-toto's links often go to a Sigstore Rekor server. Ours go to the
  ledger, which is already an append-only log with a referee, the way traces dropped Jaeger for the
  job record ([a job record holds its trace](./a-job-record-holds-its-trace.md)).
- **The notes stay too,** as how git carries each step's proof while the branch is open. The
  chain is what survives the merge.

**In Tier 1, until `next/`'s ledger exists, each link sits in the step's `field/` row.** Tracker
tickets 227 and 228 (a program that shows where a change came from, and one that shows everything
that went into `main`, Tier 2 or later) will read them back, so each row keeps every field the
ledger entry will have, and nothing a later reader would need to trust us for:

| Field | Why a later reader needs it |
|---|---|
| `step`, `from`, `to` | The link itself: which step, which tree before, which tree after |
| `by`, `key` | Who signed, and the key's fingerprint, so it maps to a role in the keys file |
| `sig` | The whole SSHSIG text, with its namespace, so anyone re-checks it with `ssh-keygen -Y verify` and trusts no one |
| `arrivedAt` | When the row was written, the referee's clock while `field/` stands in |
| `parent` | The input that directly started the step, or null in Tier 1, where the lead session starts steps by hand |
| `traceId` | the whole request's id, the same one its spans carry |
| `commit`, `pr`, `base`, `squash` | The step's commit sha, the pull request, `main`'s commit at the start, and the squash commit, so the chain can be walked from `main` |
| `keys` | The commit of the keys file the check used, since a key can be dropped later |

For `traceId`, open: what a hand run writes.

## Why

- **Small changes need fewer pull requests, not more.** Splitting every exam change into its own
  pull request put ten tiny pull requests into Tier 1's plan, each waiting on a read. The commit
  keeps the same line between who wrote what, with no extra merge.
- **A signature can be checked; a claim cannot.** A commit's author and message are whatever the
  committer typed. A signature from the step's own key is checked against a file the owner reads,
  the way the door checks a client's key and never trusts params.
- **The known way.** [in-toto](https://in-toto.io/) has each step of a supply chain sign what it
  produced, and a layout says which step's key may change which files; a verifier checks the
  signatures, not the claims. [SLSA](https://slsa.dev/spec/v1.0/provenance) calls such a record
  provenance. Git has signed commits with SSH keys since 2.34, and its allowed-signers file is the
  same one `ssh-keygen -Y verify` reads. Our check is a small in-toto layout: three keys, one list
  of paths.

## What it changes

- **[Nobody writes their own exam](./nobody-writes-their-own-exam.md):** its CI half ("an exam
  change goes in a pull request of its own"; "a pull request that changes code and its exam together
  fails") is replaced by this check. The build stage's own half, `ask:owner:check_change` on a draft
  that touches the exam, and the one list of exam paths both stay.
- **Tier 1:** the small exam rows fold back into their build pull requests as the test writer's
  commit, and P32 builds this check for `next/` ([the plan](../plan/tier-1.md#how-it-is-built-now)).
- **Today's version:** nothing yet. Its lane already ends `stuck` with `exam_touched` when a builder
  touches the exam. Moving its CI to this check is a later change.

## What it costs

The check: a CI script that lists the pull request's commits, fetches `refs/notes/fabrika`, verifies each signature, reads the
exam paths, and answers. A guess at 200 to 300 lines with its tests, planted commits and keys
included, about 0.5 to 0.8 agent hours at 600 lines an hour. Three keys, made once.

How sure: 85%. The owner decided it. The doubts are in the next section.

## What it cannot tell us

- **A key on the laptop is only as private as the agent's reach.** In Tier 1 every agent of the
  session runs as the same user, so a builder with a shell could read the test writer's key and sign
  as it. The signature proves which key, not which agent, until each step runs in its own box
  (Tier 5). The lead's hand check and `loosening.sh` hold the gap meanwhile (0014). *It said: the
  owner's read of every exam path.*
- **A rebase breaks every proof.** Tested 2026-11-06: a plain rebase drops the note; git's
  `notes.rewriteRef` carries it over, but the signature still names the old commit, so the step
  would have to sign again. A lean, not tried: update a branch by merging main in, as a `lead`
  commit, and never rebase a step's commits. P32's plan settles it. *Changed 2026-11-07 (owner,
  from [experiment 221](../../experiments/221-signed-steps-and-rebases.md)): the note signs the link,
  which names no commit, so a rebase can later carry it by replay. Tier 1 stays merge-only, and P32
  reads a rebased commit as `unsigned_commit` until the replay check is built.*
- **Branch rules do not cover notes.** The bot, or anyone who can push as it, can overwrite or delete
  a note. It cannot forge one without a step key, and a missing proof is `stuck: unsigned_commit`,
  so this fails safe.
- **Whether a tree-to-tree link says enough.** It says what changed, not which tests ran. A link
  that also names the checks it ran is a later field, and adding it later loses those runs.
  *Squash merges were a doubt here; the owner kept them on 2026-11-05, with the links above.*
- **Gaming in the test writer's commit.** The test writer may now change the exam in the same
  pull request it writes tests for. The lead's hand check and `loosening.sh` hold that (0014). *It
  said: the owner's read of every exam path.*
