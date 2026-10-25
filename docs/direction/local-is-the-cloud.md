# The laptop runs the same setup as Cloudflare, one command apart

**Decided 2026-10-25.** Everything fabrika runs on Cloudflare also runs on the
laptop, from the same code and the same Alchemy stack. That covers the ledger
server, a project's host, the relay that adds a key, and where keys are kept.
Moving a project between the two is one command. The laptop setup never falls
behind: a cloud piece lands with its local twin in the same pull request, and
the tests run on the local one.

```ts
// A sketch. One stack, two places. Only the command differs.
//   fabrika up --local    alchemy dev: workerd and Docker on the laptop, no Cloudflare account
//   fabrika up --cloud    alchemy deploy: the same resources on Cloudflare
const ledger = Cloudflare.Worker("ledger", {main: "./server.ts", env: {PROJECT, PERSON, INDEX}});
const host = Cloudflare.Container("host", {schedulingPolicy: "durable_object", dockerfile: "./host/Dockerfile"});
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
  kamp-us/phoenix). One exception made all of dev depend on the cloud.

## How it is kept

- **One stack file, two stages.** The local stage runs Workers and Durable
  Objects in workerd with no account (experiments 145 and 146) and containers
  in Docker, which is how Cloudflare's own dev mode runs them.
- **Make falling behind impossible, not discouraged.** A check in `pnpm lint`
  fails on a stack resource with no local provider. CI runs the tests against
  the local stage. *Proposed:* the check is not built yet.
- **Moving a project:** stop, copy in `pos` order, check by hash, switch. That
  is the move [the ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md)
  leans to, measured in experiment 145.

## What it costs, and what is still open

- Every cloud feature needs its local twin in the same change, even when the
  local one is plain.
- Some Cloudflare parts have no local twin today: where a container is placed,
  how far it is from its Durable Object, and the real cold start. Those are
  measured live, and the local stage says it cannot show them.
- Open: whether `alchemy dev` runs a Durable Object's container locally
  (experiment 148), and whether container snapshots have a local twin.
  Lean: the rule holds either way, and a missing twin is built by us, not
  skipped. 80% sure that Alchemy's local stage covers every piece we need
  today. The doubt is the container, which experiment 148 settles.
- What would change it: a cloud piece whose local twin costs more to build
  and keep than the piece itself, used by one project only.
