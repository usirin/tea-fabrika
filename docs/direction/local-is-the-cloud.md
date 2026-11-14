---
state: "decided 2026-10-25; the lint check that enforces it is planned in Tier 1's P12; walked 2026-11-08; 0042 added 2026-11-09, its lint rule is ticket 506"
summary: "Everything on Cloudflare also runs on the laptop from the same code and Alchemy stack: ledger server, a project's host, the key relay, the key store. One command moves a project. A cloud piece lands with its local twin in the same pull request, and tests run on the local one. In `next/`, whatever starts or talks to the local runtime goes through Alchemy, never Miniflare or workerd directly ([0042](../../.decisions/0042-platform-pieces-go-through-alchemy.md))."
---

# The laptop runs the same setup as Cloudflare, one command apart

**Decided 2026-10-25.** Walked at Tier 1's start (owner, 2026-11-08): checking local and cloud setup together; nothing new to decide, and the check is planned in Tier 1's P12. Everything fabrika runs on Cloudflare also runs on the
laptop, from the same code and the same Alchemy stack. That covers the ledger
server, a project's host, the relay that adds a key, and where keys are kept.
Moving a project between the two is one command. The laptop setup never falls
behind: a cloud piece lands with its local twin in the same pull request, and
the tests run on the local one.

**Added 2026-10-30:** design from local Miniflare first. Start each design question from
what local workerd can and can't do (its restarts, no self-eviction, its connection
limits), then check that Cloudflare does the same. Never design for a Cloudflare-only
feature and back-fill local. Never `Alchemy.remote()`.

**Added 2026-11-09 (owner,
[0042](../../.decisions/0042-platform-pieces-go-through-alchemy.md)):** in `next/`, the local
side goes through Alchemy just as the cloud side does. Everything that starts or talks to the
local runtime (the local instance in `next/apps/fabrika/src/local-instance.ts` and
`next/packages/libfabrika/src/node/dev/dev.ts`, and any test helper that boots an instance) uses
`alchemy` and `@alchemy.run/cloudflare-runtime`, never Miniflare or workerd directly. "Local
Miniflare" above means the local runtime Alchemy runs: the installed runtime package drives
workerd itself, and `next/` has no `miniflare` import. The instance's start already goes this way.
What does not yet: 16 lines that reach the workerd process by `ps`, `process.kill` or a plain
`fetch`, listed in 0042 with the gap behind each. A gap is patched locally with its upstream
issue, as the lifecycle hook already is
([alchemy issue 3184](https://github.com/alchemy-run/alchemy/issues/3184)). The gaps 0042 lists
are patched without an issue, by its amendment of 2026-11-09.

```ts
// A sketch. One stack, two places. Only the command differs.
//   fabrika up --local    alchemy dev: workerd and Docker on the laptop, no Cloudflare account
//   fabrika up --cloud    alchemy deploy: the same resources on Cloudflare
const ledger = Cloudflare.Worker("ledger", {main: "./server.ts", env: {PROJECT, PERSON, INDEX}});
const host = Cloudflare.DurableObject("Host"); // sleeps when idle (the archived tea-host note, changed 2026-10-25)
const job = Cloudflare.Container("job", {schedulingPolicy: "durable_object", dockerfile: "./job/Dockerfile"}); // one per job, Docker on the laptop
// Never `.pipe(Alchemy.remote())`: a resource with no local twin fails `pnpm lint`.
```

## Why

- **Switching is a choice, not a move.** Solo work stays on the laptop. A
  shared project, or jobs that run with the laptop closed, go to Cloudflare.
  Either way it is the same project, the same programs and the same tsh.
- **The laptop is where we test and where work goes on offline.** If the local
  setup is a weaker copy, tests pass on something nobody runs, and the cloud
  setup fails in ways no test saw.
- **Phoenix shows the cost of one remote piece.** Its database is marked
  remote, so every dev session there needs Cloudflare credentials, while its
  Worker and Durable Objects run locally (`apps/web/alchemy.run.ts` in
  kamp-us/phoenix). One exception made all of dev depend on the cloud. It was
  not a free choice: when phoenix set it up, Alchemy needed it to keep its
  state. Alchemy's 2.0 betas have `Alchemy.localState()`, a store in a local
  folder that needs no account (experiment 147), so we have no reason to
  repeat it.

## How it is kept

- **One stack file, two instances.** The local instance runs Workers and Durable
  Objects in workerd with no account (experiments 145 and 146) and containers
  in Docker, which is how Cloudflare's own dev mode runs them.
- **Make falling behind impossible, not discouraged.** A check in `pnpm lint`
  fails on a stack resource with no local provider. CI runs the tests against
  the local instance. The check is planned in Tier 1's P12.
- **Moving a project:** stop, copy in `pos` order, check by hash, switch. That
  is the move [the ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md)
  leans to, measured in experiment 145.

## What it costs, and what is still open

- Every cloud feature needs its local twin in the same change, even when the
  local one is plain.
- Some Cloudflare parts have no local twin today: where a container is placed,
  how far it is from its Durable Object, and the real cold start. Those are
  measured live, and the local instance says it cannot show them.
- Open: whether `alchemy dev` runs a Durable Object's container locally
  (experiment 148), and whether container snapshots have a local twin.
  Lean: the rule holds either way, and a missing twin is built by us, not
  skipped. 80% sure that Alchemy's local stage covers every piece we need
  today. The doubt is the container, which experiment 148 settles.
- What would change it: a cloud piece whose local twin costs more to build
  and keep than the piece itself, used by one project only.
