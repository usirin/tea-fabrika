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
| The interface itself | `Agents` in `packages/fabrika/src/agents/agent/`, with adapters for Claude (its SDK), Codex (`codex exec`), ACP (Claude or Codex) and a fake, and `agentRunner` for a Draft (experiment 156). No stage uses it yet. |

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

## What a chat window will need

Decided 2026-10-26 by the owner. No chat is built yet. The interface must allow
one, so a chat later is one more caller, not a rewrite.

```ts
// A sketch. A chat pane calls the same service a stage does.
// In Elm terms the pane is a tea program, and the agent run is its Sub.
const run = Agents.run({ provider, session: chat.session, folder, prompt: typed });
// said_part { text }                     streamed text, a bit at a time
// asked { id, options }  ->  Agents.answer(run, id, "allow")   a person answers in the pane
// the next prompt goes to the same session while it is still warm
// Agents.history(chat.session)           the turns so far, when the pane opens again
```

- **Streamed text.** Experiment 156 gives whole messages. A chat shows text as
  it comes, so the updates need a part kind. [T3 Code](https://github.com/pingdotgg/t3code)
  merges small text bits before it sends them to its window
  (`ProviderTextDeltaCoalescer`).
- **Many short turns on one warm session.** Experiment 156 picked `codex exec`,
  one process per turn. A chat wants Codex's `app-server`, which T3 Code uses.
  Both can be rows in the provider table.
- **A person answers an ask.** The `asked` update is there. The chat needs the
  way back: a person's answer goes to the run.
- **History when a pane opens again.** The turns are kept, so the pane can show
  them. The ledger keeps events already; T3 Code keeps them in its own store.
- **T3 Code is the evidence for the shape.** It has its own adapters behind one
  registry: Claude on the Claude Agent SDK, Codex on `app-server`.
- **Cost:** four small additions to the interface, each built when the chat is.
  **Confidence: 85%.** The doubt is a warm session next to our hard stop: the
  stop ends the agent's processes, and a warm session keeps one alive between
  turns. The first chat build settles it.

## Where a person's login lives

**Ruled 2026-10-26 by the owner, after
[experiment 157](../../experiments/157-login-stays-home.md).** Each person's
login is kept in their own locker on one shared Cloudflare account. A job's
box holds the login itself, the way GitHub Actions and OpenAI's CI page do it.
Our Worker never sees a real token.

```ts
// A sketch. One job of one person, on the shared account.
const login = yield* Locker.of(job.who).lend(job.box); // one job per person at a time
yield* Box.start(job.box, {
	env: {CLAUDE_CODE_OAUTH_TOKEN: login.claude}, // as claude-code-action takes it
	files: {"~/.codex/auth.json": login.codex}, // as OpenAI's CI page says
	internet: "open", // nothing of ours stands in the call
});
yield* Locker.of(job.who).back(job.box, yield* Box.read(job.box, "~/.codex/auth.json"));
```

- **One shared account, not one each.** 157 leaned one account per person
  (65%): whoever holds an account can open every locker in it, and Anthropic's
  [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) say "You may
  not share your … Account credentials with anyone else." The owner took the
  shared account knowing this. The lean was not taken; it stays here for the
  record.
- **Experiment 148's rule stays: our Worker never sees a real token.** 157
  built the other known way, Cloudflare's
  [Claude Code tutorial](https://developers.cloudflare.com/sandbox/tutorials/claude-code/):
  the box holds a fake token and the Worker adds the real one on the way out.
  That puts our code between a person and their login, which Anthropic's page
  bars, and on a shared account it would add the other person's token too.
  Anthropic's page names the kept way as allowed: an end user "signing in to
  the unmodified Claude Code binary with their own Claude subscription,
  including where a platform hosts Claude Code". Claude Code takes the token
  as `CLAUDE_CODE_OAUTH_TOKEN`, as Anthropic's
  [claude-code-action](https://github.com/anthropics/claude-code-action) does.
  Not taken from 157: the token swap, and the catch on Codex's refresh path.
- **Codex:** the locker lends `auth.json` for one job and takes back the copy
  the box leaves, one job per person at a time
  ([OpenAI's CI page](https://developers.openai.com/codex/auth/ci-cd-auth)).
  With no Worker on the refresh path there is no catch, so a box that dies
  right after a refresh leaves a dead login, and that person signs in again.
  Codex refreshes about every 8 days, so this is rare.
- **The cost:** an agent in a box can read its own token and reach the whole
  internet, as on a person's laptop today. Jobs run on private repositories
  only; OpenAI's page says "Do not use this workflow for public or open-source
  repositories."
- **Confidence: 80%.** The doubt is a leak through the open internet. With
  private repositories that is no worse than a laptop. A loan end time is
  still to build before the live run.

**Earlier the same day: logins never leave a person's machine.** Decided
2026-10-26 by the owner, and changed by the ruling above: "The shared fabrika
stores no provider login, no key, no token, for anyone." What follows still
holds for a job a person runs on their own laptop.

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
  service needs no key either. Changed later the same day: each person's own
  login is stored in their locker on the shared account
  ([where a person's login lives](#where-a-persons-login-lives)), and still no
  API key.

## What this cannot tell us

- Whether a second maker's agent does as well as Claude on real tickets.
  Experiment 152 ran one toy job, on two small models that are not a matched
  pair.
