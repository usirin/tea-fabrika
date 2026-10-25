# Nothing is pushed before review

Decided 2026-10-24.

```ts
// A sketch of the order. Build ends with a patch on the ledger, not a branch.
{fact: "built", ticket: "demlik-1", task: 1, patch: "sha256:…"}             // build, in its box
{fact: "reviewed", ticket: "demlik-1", task: 1, patch: "sha256:…", ok: true} // review reads that patch, in its box
// Only then, outside any box:
// leak check → push → open the PR → CI → final review → ship

// Today: draft → checks → push → open the PR → review → CI → ship
```

## What was decided

- **Build pushes nothing.** It ends with its change saved as a patch on the
  ledger. The hosted build already returns the change this way
  (`packages/pipeline/src/hosted/build.ts`). The push and the PR open
  (`build_push` and `build_open` in
  `packages/pipeline/src/stages/build/machine.ts`) move to after review.
- **Review reads that patch in its own box.** It reads it from the ledger, so
  it no longer needs the code host to see a change.
- **After review passes, a leak check runs before the push.** The patch must
  hold none of the app's own keys as text. GitHub's push protection does the
  same kind of check for secrets it knows
  ([GitHub](https://docs.github.com/en/code-security/secret-scanning/working-with-secret-scanning-and-push-protection)).
  Ours runs before GitHub sees anything.
- **A red CI goes back to build.** The new patch is reviewed again before the
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
- Review reads a patch from the ledger instead of a PR from `CodeHost`.
- CI runs after review, so a red CI costs one more review round. Build's own
  checks in its box catch most of that first.

**How sure: 80%.** The doubt: review has not been walked yet, so its shape may
change. Whatever it becomes, some check has to read the change before it goes
out. The review walk settles it.

## Still open

- **Who pushes and opens the PR:** ship, or a step the parent runs between
  review and ship.
- **What the leak check looks for** beyond the app's own keys.
- **Whether review wants CI's answer before it judges.** Today's review stops
  on red checks first (`packages/pipeline/src/stages/review/gate.ts`).

## What would change it

- A review that cannot judge a change without CI's results.
- A leak check that blocks too often on harmless text.

## What it cannot tell us

Nothing has run in this order yet.
