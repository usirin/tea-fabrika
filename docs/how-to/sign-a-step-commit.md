# Sign a step's commit

How a step signs what it committed in `next/`, how the lead pushes it, and how the merge reads the
check. Tier 1's P32 built it, from [a unit of work is a commit](../direction/a-unit-of-work-is-a-commit.md).
The laws are p83 to p87 and p89 in [the detail](../plan/tier-1-detail.md#properties).

```sh
pnpm commits sign --step build --ticket 229 --key ~/.fabrika/step-keys/build   # a step, after each commit
pnpm commits push                                                                     # the lead, once the steps are done
```

## The keys, made once by the lead

Each step role that commits needs an Ed25519 key: `tests`, `build` and `lead`. A role may list a
second, distinct key during rotation. No passphrase, since a step signs with no person there.
The comment is the role, so no machine name reaches the repo.

```sh
umask 077
mkdir -p ~/.fabrika/step-keys
for role in tests build lead; do
	ssh-keygen -q -t ed25519 -N "" -C "$role" -f ~/.fabrika/step-keys/"$role"
done
for role in tests build lead; do
	printf '%s namespaces="fabrika-step" %s\n' "$role" \
		"$(cut -d' ' -f1,2 ~/.fabrika/step-keys/"$role".pub)"
done > allowed_signers
```

- Only `allowed_signers`, the public halves, goes in the repo. It is an exam path, so a change to it
  asks the owner.
- Nothing ever prints a private key, and no agent reads one into its output. A step agent's brief
  names one path: its own role's key.

## Your own commits

For `next/`, add your Ed25519 public signing key to `allowed_signers` in a separate pull request
the owner approves. Use `person:<id>` as its principal and `namespaces="git"`. Use one literal id
matching `[A-Za-z0-9._:-]+`. A GitHub signing key can help find the public key; the checked-in line
is what the check trusts. Each person id and each key must appear only once, and a person cannot
reuse a step key.

Then turn on [Git's SSH commit signing](https://git-scm.com/docs/git-config#Documentation/git-config.txt-usersigningKey)
once, using your own signing key's public path:

```sh
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

Your commits need no step note. The check verifies their Git signature against the base's person
keys. Exam changes still ask the owner to read them. A signed merge of `main` counts too.
A person's signed commit is itself a link, from its parent's tree to its own. After the squash, the
lead writes it as a row with `step: "person"`, as for every other link
([a step's links](../../field/README.md#a-steps-links)).
Squash drops the person's signature, so this verification runs on the pull request's commits.

## A step signs

After each commit it makes, before anything is pushed:

```sh
pnpm commits sign --step tests --ticket 229 --key ~/.fabrika/step-keys/tests
```

- It signs the link from the commit's first parent's tree to its tree, with the step, the ticket and
  a `version`: the step's highest for that ticket, plus one. Only the newest counts.
- It adds the note on `refs/notes/fabrika` and prints the link as one JSON line. Keep that line: it
  goes into the step's `field/` row (see [A step's links](../../field/README.md#a-steps-links)).
- It refuses a key that does not verify as the step in `HEAD`'s `allowed_signers`, and adds nothing.
- After the mutation step, a test writer that commits again signs again. Its new link gets the next
  `version`, and must come after the old one on the branch.

## The lead pushes

Step agents commit locally; the lead pushes, notes first, so the check finds every note:

```sh
pnpm commits push
```

It fetches the remote notes into `refs/notes/fabrika-origin`, merges them in, pushes
`refs/notes/fabrika` (once more on a race), then pushes the branch. It never force-pushes. A note
pushed after the branch starts no new run: re-run the job.

**Catch up by merging `main` in, never by rebasing.** A rebased commit's note no longer fits its
trees and reads `unsigned_commit`. The merge is the lead's commit, so the lead session signs it,
most often through `land.ts run` or `catchup.sh` (a lane agent stops at `land.ts ready`, ticket 652):

```sh
git merge --no-edit origin/main
pnpm commits sign --step lead --ticket 229 --key ~/.fabrika/step-keys/lead
```

## What the check answers

| Answer | What to do |
|---|---|
| `done` | nothing: every commit has a valid step note or person signature, and no exam path changed |
| `ask exam_read` | send the owner one line with the paths; merge after the yes, and note it in the `MergeRow` |
| `stuck unsigned_commit` | sign the commit with your listed person key, or add a fitting note with its step's key |
| `stuck build_touched_exam` | a builder changed the exam: the change goes back to the test writer |
| `stuck no_exam_list` | the build commit's parent has no `exam-paths.json` that reads. A commit on top does not clear it, and history is never rewritten: tell the lead, who starts the lane again on a new branch from the last head whose list reads |
| `stuck stale_link` | a step's newest link is not the last of its links on the branch: use it, or sign again |
| `stuck broken_chain` | the branch is behind `main`: merge `main` in, as above |

A pull request that touches no `next/**` and no exam path is "not in scope" and passes.

## The merge reads one run

The lead never reads a check by its name, since any workflow can name a job `commits`. It reads the
run of the file `commits.yaml` on the event's head sha:

```sh
gh run list --workflow commits.yaml --commit <head sha> --json conclusion,event
```

There must be exactly one `pull_request_target` run, with conclusion `success`. None, two, or any
other conclusion is red. The lead also checks that the ticket the check printed is the pull request's
tracker ticket, and writes it in the `MergeRow`.

## After the merge

Copy each step's printed links into its `field/` row, with `pr`, `base`, `squash` and `keys` filled in,
in a log pull request. `keys` and `base` must be commits on `main` before the squash, and the squash
must be on `main`; a keys commit anywhere else counts for nothing, since anyone who can push can make
one that holds their own key. The check walks them there, and blocks that pull request until they reach
the squash commit's tree. On `main`, each push walks every squash since P32's, as advice.

## The pull request that added the check

The workflow runs `main`'s copy, and `main` had none, so that pull request was checked once by hand,
reading the keys file and the exam list from its own head, a flag the workflow never passes:

```sh
pnpm commits check --base origin/main --head HEAD --keys-from head
```
