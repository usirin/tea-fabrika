# Agents sit behind one service, and providers swap

Decided 2026-10-26 by the owner.

The goal: people bring their own plan with any provider, and a team of any
size works in one fabrika project. The team shares the work, never a login.

```ts
// A sketch. Every stage asks for an agent the same way, and never names a maker.
const drafted = yield* Agents.run({
	prompt, folder, schema: BuildAnswer, session,     // what the stage wants
	provider: settings.build.provider,               // "claude" | "codex" | "fake": config, not code
});
// The interface is ours; its shapes are taken from ACP where they fit.
// Claude and Codex are adapters of ours on their makers' own SDKs. ACP is one more adapter,
// for an agent that speaks only ACP.
// A provider is one row in its table: the adapter, its environment, how it is contained.
// A test hands the stage the fake provider. Nothing else changes.
```

## What was decided

- **Every stage reaches an agent only through one Effect service of ours.** The
  same rule as GitHub, which is reached only through `CodeHost`
  ([backend as a library](./backend-as-a-library.md)). No stage imports a
  maker's SDK.
- **The service is our own interface, not ACP.** Changed 2026-10-26 by the
  owner: one less layer, and one we control. Its shapes are taken from ACP
  wherever they fit: a session, a prompt, streamed updates, tool calls,
  permission asks, cancel. Claude and Codex are adapters of ours on their
  makers' own SDKs. ACP stays as one adapter, for an agent that speaks only
  ACP. Experiment 153 showed what ACP drops for a pipeline: a typed answer, a
  stop that ends child commands, turn token totals, our own session id, and
  for Codex any budget cap or hook. The phoenix agent interface
  (`TuvalAiAgent`, with `tuval-claude`, `tuval-codex`, `tuval-pi`) is the
  earlier try at the same shape, and the first map.
  - Wrong, kept for the record: the first version of this note said "the
    service's default implementation is our ACP client", restating the
    2026-10-19 ruling in [Helpers, and one supervisor](./helpers-and-the-supervisor.md)
    that our contract with a harness is ACP.
- **A provider is swapped by config.** Claude, Codex, the fake, and later
  others are rows in one provider table. A stage's provider and model are
  settings, as [A canvas per piece of work](./a-canvas-per-work.md) asks.
- **What the protocol lacks, the service adds once, for every provider.** The
  first case is a typed answer: the service reads the last message with the
  stage's Effect schema, and a misfit comes back as `null`, as Draft does
  today. A provider's own schema support (Codex's `--output-schema`, Claude's
  `outputFormat`) is only an extra on top.
- **The service's name is a working name** until the naming pass
  (tracker #32) or the build lane picks the industry's word.

## Where the code is today

| Stage | How it reaches an agent now |
|---|---|
| build | The Agent SDK directly (`stages/build/builder.ts`). ACP is there too, picked by `build --harness acp` (experiment 77). |
| plan, review, sort | The Agent SDK directly (`planner.ts`, `reviewer.ts`, `sorter.ts`). |
| tsh's `acp` program | ACP, Claude or the fake (experiment 76). Not listed in the app's tsh. |

- **Codex could not join the table until now.** Experiment 152
  (https://github.com/usirin/tea-fabrika/pull/119) found how to keep the
  owner's own Codex settings out of a run. Experiment 153 tries Codex through
  ACP with that fix.

## Why, what it costs, how sure

- **Why:** a stage that names a maker is tied to it. Behind one service, trying
  another agent on the same stage is one setting, and a test needs no agent.
- **Cost:** each stage's agent call moves behind the service. The build stage
  is half way there already through its ACP path. Medium work, done stage by
  stage.
- **Confidence: 80%** in the direction. The doubt is how much each maker's
  SDK makes us build per adapter, next to what ACP's adapters give for free.
  Experiment 156 builds the interface with a Claude and a Codex adapter and
  runs the same job through it and through ACP.

## Logins never leave a person's machine

Decided 2026-10-26 by the owner. The shared fabrika stores no provider login,
no key, no token, for anyone.

```ts
// A sketch. The shared ledger holds work. Each person's own machine runs it.
// On each person's machine, inside their fabrika app:
const job = yield* Ledger.claim({ who: me, can: ["codex", "claude"] }); // pull one job
const drafted = yield* Agents.run({ ...job, provider: job.provider });  // runs here, on my login
yield* Ledger.finish(job.id, drafted);                                  // only the answer goes back
// The ledger learns a fact like { who: "a", has: ["codex"] }. Never the login itself.
```

- **This is the self-hosted runner shape.** GitHub Actions self-hosted
  runners and Buildkite agents work this way: the runner on your own machine
  calls out, takes a job, runs it with what is on that machine, and sends back
  the result. The shared service never holds the runner's secrets.
- **Each provider's plan is used the way it is plainly allowed:** one person,
  their own plan, on their own machine. This holds for Claude too, not only
  Codex.
- **The cost:** a person's jobs run only while their machine is on. An
  always-on machine of their own at home is the fix, and it is still their own
  machine.
- **Confidence: 85%.** The doubt is the ledger's claims across machines on a
  slow link. The lease fence in
  [the ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md) is the
  answer to test.

## Still open

- **Does the direct Agent SDK path stay?** Settled 2026-10-26: it stays, and
  it is the default. The lean here before was that it goes once ACP matches
  it (70%). Wrong, kept for the record.
- **The plan login.** Each person signs in with their own plan, on their own
  laptop or a remote box only they control, and one login is never shared
  between people. OpenAI documents those runs (experiment 152, section 6). An
  API key is only for a shared service, or a public repository's own CI.
  Corrected 2026-10-26: the first version said a shared or remote box needs an
  API key. A remote box one person controls does not. Settled the same day by
  the section above: no login is stored on the shared side, so the shared
  service needs no key either.

## What this cannot tell us

- Whether a second maker's agent does as well as Claude on real tickets.
  Experiment 152 ran one toy job, on two small models that are not a matched
  pair.
