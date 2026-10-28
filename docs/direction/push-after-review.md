# Nothing is pushed before review

Decided 2026-10-24.

```ts
// A sketch of the order. Build ends with a local commit, not a pushed branch.
{fact: "built", ticket: "demlik-1", task: 1, commit: "a1b2c3…"}             // build, in its box
{fact: "reviewed", ticket: "demlik-1", task: 1, commit: "a1b2c3…", ok: true} // review reads that commit, in its box
// The code stays in a git repo on this machine. The ledger holds only the hash.
// Only then, the push program, in its own box. Its push Cmds are marked `outside`,
// so the host does them with its GitHub key. (Was "outside any box"; corrected 2026-10-27.)
// leak check → push that commit → open the PR → CI → final review → merge

// Today: draft → checks → push → open the PR → review → CI → ship
```

## What was decided

- **Build pushes nothing.** It ends with its change as a commit in a git repo
  on the user's own machine. The push and the PR open (`build_push` and
  `build_open` in `packages/pipeline/src/stages/build/machine.ts`) move to
  after review.
- **The change never goes on the ledger. Only its commit hash does**
  (decided 2026-10-24). The ledger is shared: it syncs to other people's
  machines, so code on it would leave this machine before anyone reviewed it.
  The [ledger note](./ledger-behind-a-service.md) already keeps code out of
  the ledger.
  - This is the claim-check pattern: keep the big thing in its own store and
    pass a small reference to it
    ([Microsoft](https://learn.microsoft.com/en-us/azure/architecture/patterns/claim-check)).
  - A git commit hash names the exact files, so the push sends the very commit
    review read. Only a commit with a passing `reviewed` fact can be pushed.
- **Review reads that commit in its own box.** It reads it from the local
  repo, so it no longer needs the code host to see a change.
- **After review passes, a leak check runs before the push.** The commit must
  hold none of the app's own keys as text. GitHub's push protection does the
  same kind of check for secrets it knows
  ([GitHub](https://docs.github.com/en/code-security/secret-scanning/working-with-secret-scanning-and-push-protection)).
  Ours runs before GitHub sees anything.
- **A red CI goes back to build.** The new commit is reviewed again before the
  next push.
- **This fits [done is per criterion](./done-is-per-criterion.md).** Each task
  is already reviewed as it lands, with local tests and no CI. Now that review
  also comes before the push. The final review of the plan's own criteria can
  still come after CI, since by then every pushed line was reviewed once.

## Why

- **A push cannot be taken back.** On a public repo it is public at once.
  GitHub's own advice for a secret that got pushed is to revoke or change it
  first; rewriting history comes after, if at all
  ([GitHub](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)).
- **Review is the first reader that judges the change.** Putting it before the
  push means nothing leaves that nobody has read.
- **It is the box rule carried one step further.** Code that comes out of a box
  runs only in a box ([programs run in a box](./programs-run-in-a-box.md)).
  Now it also leaves the machine only after a check.

**Cost:**

- Build and ship are reordered. The push and the PR open move out of build.
- Review reads a local commit instead of a PR from `CodeHost`.
- The hosted build changes. Today it saves the change as a binary patch on the
  ledger, so another machine with no copy of the code can take over after a
  crash (`packages/pipeline/src/hosted/build.ts`, experiment 104). Now a crash
  is picked up on the same machine, where the commit still is. If another
  machine takes over, it cannot see the commit and runs build again. Each
  person's agents run on their own machine
  ([programs run in a box](./programs-run-in-a-box.md)), so that case should be
  rare.
- CI runs after review, so a red CI costs one more review round. Build's own
  checks in its box catch most of that first.

**How sure: 80%.** The doubt: review has not been walked yet, so its shape may
change. Whatever it becomes, some check has to read the change before it goes
out. The review walk settles it.

## Still open

- **Who pushes and opens the PR:** ship, or a step the parent runs between
  review and ship.
  *Answered 2026-10-27:* a new small program, push, between review and
  merge ([a ticket runs from the app](./a-ticket-runs-from-the-app.md),
  section 8).
- **Where the local repo lives** and how build's and review's boxes see it:
  for example a folder per job, mounted into build's box and mounted read-only
  into review's.
- **What the leak check looks for** beyond the app's own keys.
- **Whether review wants CI's answer before it judges.** Today's review stops
  on red checks first (`packages/pipeline/src/stages/review/gate.ts`).

## What would change it

- A review that cannot judge a change without CI's results.
- A leak check that blocks too often on harmless text.

## What it cannot tell us

Nothing has run in this order yet.
