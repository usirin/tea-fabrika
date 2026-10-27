# Agents sit behind one service, and providers swap

Decided 2026-10-26 by the owner.

```ts
// A sketch. Every stage asks for an agent the same way, and never names a maker.
const drafted = yield* Agents.run({
	prompt, folder, schema: BuildAnswer, session,     // what the stage wants
	provider: settings.build.provider,               // "claude" | "codex" | "fake": config, not code
});
// The default layer is our ACP client (packages/fabrika/src/agents/acp/).
// A provider is one row in its harness table: the adapter, its environment, how it is contained.
// A test hands the stage the fake provider. Nothing else changes.
```

## What was decided

- **Every stage reaches an agent only through one Effect service of ours.** The
  same rule as GitHub, which is reached only through `CodeHost`
  ([backend as a library](./backend-as-a-library.md)). No stage imports a
  maker's SDK.
- **The service's default implementation is our ACP client.** This restates
  the 2026-10-19 ruling in [Helpers, and one supervisor](./helpers-and-the-supervisor.md):
  our contract with a harness is ACP, the Agent Client Protocol.
- **A provider is swapped by config.** Claude, Codex, the fake, and later
  others are rows in the ACP harness table. A stage's provider and model are
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
- **Confidence: 80%** in the direction. The doubt is whether ACP carries
  everything the direct SDK path gives the builder today: its guard, its
  dollar cap, stopping a run cleanly. Experiment 77 got the guard across for
  Claude. Experiment 153 says what Codex lacks.

## Still open

- **Does the direct Agent SDK path stay** as a second layer, or go once ACP
  matches it? Lean: it goes, after a run of the same cases shows the ACP path
  gives the same answers. 70%: the dollar cap and a clean stop are the doubt.
- **The plan login.** Each person signs in with their own plan, on their own
  laptop or a remote box only they control, and one login is never shared
  between people. OpenAI documents those runs (experiment 152, section 6). An
  API key is only for a shared service, or a public repository's own CI.
  Corrected 2026-10-26: the first version said a shared or remote box needs an
  API key. A remote box one person controls does not.

## What this cannot tell us

- Whether a second maker's agent does as well as Claude on real tickets.
  Experiment 152 ran one toy job, on two small models that are not a matched
  pair.
