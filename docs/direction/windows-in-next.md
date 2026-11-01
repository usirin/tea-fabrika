# Windows in `next/`

**Proposed 2026-11-01. Nothing here was run on Windows.** This is about `next/`. The
[Windows trial](https://github.com/usirin/tea-fabrika/issues/256) ran today's version
only. The claims about `next/` come from reading the first slice and from a simulation on
a Mac.

```ts
// A sketch. One brain, many hosts. Only `has` differs.
{key: "ed25519:mac...", has: ["git", "files", "agents"]}  // a Mac's hands
{key: "ed25519:win...", has: ["git", "files"]}            // Windows hands, Tier 4: no agents yet
{key: "ed25519:wsl...", has: ["git", "files", "agents"]}  // WSL2 hands, Tier 5: own key, own Approve
{key: "ed25519:tab...", tab: "t1", has: ["screen"]}       // a tab on Windows: free by design
```

## The answer

The brain and the programs name no OS, so most of what failed in the trial never reaches
them. The OS only matters in hands and at a client's edge. **A tab on Windows should
already work against the cloud brain,** which is what "a browser is always a client" buys.

## What is proposed

- **Words before facts.** Facts live forever, and a Windows PC must not write `touch-id`.
  Rename the capabilities `touch-id` to `check` and `keychain` to `seal`, and record the
  OS in the hello, before PR D of [Tier 1](../plan/tier-1.md) writes real facts. This
  differs from the Tier 1 plan as written, so it needs the owner's word. 75%: a menu may
  want the vendor's name. One walk of the Approve screen settles it.
- **A `next-windows` CI job in the exam pull request.** Not blocking until its first green.
  Standard runners cost nothing in public repositories, and this one skips typecheck and
  lint, whose results do not depend on the OS. 70% on green by PR A. The doubt is Alchemy's
  local stage and Worker Loader on Windows, and the job's first run settles it.
- **`.gitattributes` with `* text=auto eol=lf`.** The plan's byte-for-byte fixtures break on
  a CRLF checkout. One line, 95%.
- **One way to stop a brain: the child watches a pipe.** It ends when its stdin ends, on
  every OS, in place of process groups and signals. 75%: a descendant may outlive its
  leader. The job's kill step settles it.
- **Agents stay off on native Windows until an experiment says so.** `has` already carries
  this: a job that needs `agents` never goes to hands without it, and the box must fail
  rather than run with no box. WSL2 hands come first, as one more host. 85% on WSL2. 55% on
  native. Running the same law suite there settles it.
- **Today's version:** fix only what daily use needs. Most of the trial's issues go away
  when `next/` replaces those parts.

**Where it lands, a first sorting:** the words, the CI job, the attributes and the stop in
Tier 1. A Windows person's own check and Electron in Tier 3, if the second person uses
Windows. Windows hands in Tier 4. Agents in Tier 5.

**Why:** old hellos never get the OS back, and a law can pass while checking nothing. The
slice's `layers.test.ts` does exactly that on Windows paths, in a simulation.

**What it costs:** about 320 lines and 3 to 5 agent hours in Tier 1, a guess at 50%.

**How sure:** 70% on the shape. The doubt is everything a real run would show.

## What it cannot tell us

- Anything from a real Windows run. The numbers above are reading, one path simulation and
  one line-ending probe.
- Whether workerd dies with its parent on Windows, and whether Alchemy's local stage works
  there.
- How real a box on native Windows is.
- Who uses Windows daily. That decides how far the Windows work moves up, and it is the
  owner's call.
