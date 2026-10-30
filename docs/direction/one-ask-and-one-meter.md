# One way to ask a person, and one meter for money

Proposed 2026-10-30. Tracker tickets #90 (one way to ask a person) and #91 (one
meter for money). Today fabrika has five places that ask a person and seven
that count or cap money. None of them knows the others. This note proposes one
ask, kept as facts on the ledger with one hash of what the person saw, and one
meter, the ledger's own limits. A person's yes to a cost estimate is the only
thing that can set a dollar limit.

```ts
// The whole idea, as a sketch: the owner approves $0.40, and the run stops at $0.40.
experiment/170/run/3/inbox
  {type: "asked", ask: "spend-1", for: "spend", who: ["github:42"],
   shows: {run: "experiment/170/run/3", usd: 0.4, cases: 5, of: 120, model: "jev-1"},
   saw: "sha256:4be0…", picks: ["yes", "no", "never"], until: 1793400000000}     code
  {type: "answered", ask: "spend-1", pick: "yes", note: "", saw: "sha256:4be0…"}   a person, never an agent
ledger.setLimits("experiment/170/run/3", {usd: 0.4, answer: 812})   // refused unless row 812 is that yes
ledger.hold(fence, "case-1", {usd: 0.1})    // "ok", or "limit": the money is not there
ledger.charge(fence, "case-1", {usd: 0.07}) // what the case really cost; it replaces the hold
```

- **One ask** is the tracker's `asked` and `answered` facts, grown. Every place
  that asks a person writes them. Every place that answers reads them.
- **One hash** is SHA-256 over the canonical JSON of `shows`, the data the
  question is drawn from. The asker writes it, the window checks it, and the
  answer carries it.
- **One meter** is the ledger's `hold` and `charge`. Jev and the agents count
  into it. A dollar limit always points at the yes that set it.

## Why now

- Experiment 170 part 2 makes paid runs: estimate, ask, try 5 cases, then the
  rest, under the limit the approval set
  ([experiments behind a service](./experiments-behind-a-service.md), "Money").
  It needs one ask and one meter to be written at all.
- The `claude` and `codex` programs (draft
  [PR 192](https://github.com/usirin/tea-fabrika/pull/192)) output a
  permission `ask` and take `allow` and `refuse`. Nobody can answer them yet.
- The building-blocks map found both overlaps. Two more uses would make three
  more copies.

## What exists today

### Places that ask a person: five

| # | Where | How it asks, and what the yes covers | Who uses it |
|---|---|---|---|
| 1 | `packages/pipeline/src/combos.ts` `createAsk`, `Thread`, `hashOf`, `covers` | Posts on a `Thread` (issue comments), reads a `/choice` by code or the words by a Judge. Hash: `node:crypto` over the `about` text. | Only `legacy/src/turn.ts` `parkAsk` (used by `legacy/src/operator.ts` and `operator-host.ts`), and its tests |
| 2 | `packages/pipeline/src/tickets/ticket.ts` facts `asked`, `answered`; `tickets/approval.ts` `hashOf`, `covers`, `changesRequested` | `asked {ask, what, picks}`, `answered {ask, pick, note, text}`. Hash: Web Crypto over the JSON pair `[title, body]`. The fold refuses an answer with no ask, a second answer, and a pick not offered. | `programs/tracker` (the ask box), `programs/ticket`, the lane plan in [a ticket runs from the app](./a-ticket-runs-from-the-app.md) |
| 3 | `packages/pipeline/src/asks/` (`ask.ts`, `program.ts`, `rules.ts`, `ledger.ts`) | Asks are folded from other facts (`planned`, `ruling_needed`, `check_raised`). Four kinds: plan, stuck, ruling, check. An answer is `answered {id, answer}`. No hash: a plan's yes covers its version number (`plan:o/r#7@2`). | `packs/owner-desk`, `packs/ui-verification`, `packs/ask-log`, `programs/map`, `hosted/lane-ends.ts`, `laws/lane.ts` |
| 4 | `packages/fabrika/src/agents/acp/program.ts` | A harness permission request is shown on `ask`. `--permissions refuse` (the default) refuses at once; `--permissions ask` waits for the `allow` or `refuse` input. It picks `allow_once`, never an always-allow. Kept in the program's own state, not on the ledger. No hash. | The `acp` program, from tsh |
| 5 | `packages/fabrika/src/agents/agent/turn.ts` event `asked {id, title}`; PR 192's `claude` and `codex` programs | The `Agents` service streams `asked`. PR 192 wires `allow` and `refuse`, but no adapter sends `asked`, so they are dead. | Nobody yet |

- The outcome verb `ask {who, for}` (`stages/outcome.ts`) is not a sixth place.
  It is how about ten stage machines say "a person must decide" (plan, sort,
  ship gate, test writer, mutation, the guarded files in `codeowners.ts`). A
  parent turns it into a real ask. Today that parent writes place 2 or 3.
- The door's `PERSON_KINDS` (`packages/fabrika/src/host/door.ts`) is the guard,
  not an ask: `answered` and `duplicate_rated` come only from a person's
  session.
- **Count: five places, three ways to say what a yes covers** (a `node:crypto`
  hash, a Web Crypto hash, a version number) and two places that cover nothing.

### Places that count or cap money: seven

| # | Where | What it counts | Can it stop spend? | Who uses it |
|---|---|---|---|---|
| 1 | `packages/fabrika/src/host/ledger.ts` `hold`, `charge`, `usage`, `setLimits`, `LimitsSchema` (experiment 102) | Dollars and tokens per name, summed up a tree of names. A hold is an upper bound before a turn; a charge replaces it. | Yes: over a limit, the run ends `limit:usd` | `host/host.ts`, `pipeline/src/hosted/agent.ts`, `hosted/lane.ts` (a child's `usd`), `hosted/build.ts` (charges the Draft's spend). `setLimits` is person-only at the door. |
| 2 | `packages/pipeline/src/jev-live.ts` `JevReceipts`, `Cap` | Jev calls and dollars, per Layer, in memory | Yes: the next call is refused, `over_cap` | `apps/fabrika/src/host/jev.ts` (`HOST_CAP`: 2,000 calls, $0.25), experiment 167 |
| 3 | `experiments/lib/jev.ts` `MAX_CALLS`, `MAX_DOLLARS` | Calls, and dollars guessed at four characters a token, read from `process.env` | Yes: it throws | 33 experiment scripts |
| 4 | `fabrika.toml` `[agents.*] usd` (`packages/pipeline/src/settings.ts`, `setup.ts` `budget`) | The most one agent run may cost | Yes, through 5 | Every stage's agent run |
| 5 | `Agents` `Limits.usd` and `ended.usd` (`agents/agent/turn.ts`, `core.ts`, `acp/harness.ts` `maxBudgetUsd`) | The harness's own cap per turn, and what the turn reports | Claude yes; Codex no (`cannot_limit`) | `apps/fabrika/src/host/run.ts`, PR 192's `--usd` |
| 6 | Tracker fact `ended {usd, input, output}` (`tickets/ticket.ts`) | What one run cost, as the ticket shows it | No | `programs/ticket`, `programs/runs` |
| 7 | `field/runs.jsonl` `costUsd`, `billed` | A hand-written row per agent run of today's fabrika | No | People and write-ups |

- **Count: seven places, four that can stop spend** (1, 2, 3, and 4 through 5).
  A paid experiment that calls Jev and an agent has its cost split between 1
  and 2, and the cap in 3 does not know either.

## How others do it

### Asking a person

| Who | How | What we take |
|---|---|---|
| [Temporal](https://docs.temporal.io/sending-messages) | A signal is fire and forget. An update returns a result, and its [validator](https://docs.temporal.io/handling-messages) can reject it before anything is kept. You can only signal a workflow that [has not closed](https://docs.temporal.io/develop/typescript/message-passing). | An answer is checked against its ask before it is written. A late answer to a closed ask is refused. |
| [LangGraph `interrupt`](https://docs.langchain.com/oss/python/langgraph/interrupts) | `interrupt()` saves state and returns a value; `Command(resume=…)` resumes. The node runs again from the top, so work before the interrupt must be safe to repeat. | The ask lives in saved state, not in a running process. A restart reads it back. |
| [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/) | `needsApproval` on a tool; the run pauses with `interruptions`; `approve` or `reject`, also `alwaysApprove` and `alwaysReject`. State is saved as a string. It warns the string is not signed, so keep it on the server. | The ask and its answer are facts on our ledger, never a blob the client hands back. |
| [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/user-input) | `canUseTool` answers `allow` (with `updatedInput`) or `deny`. A [`PreToolUse` hook](https://code.claude.com/docs/en/agent-sdk/hooks) answers `allow`, `deny`, `ask` or `defer`; deny wins. A hook that times out blocks the tool. | Silence is never a yes. A wait has an end, and the end is a no. |
| [GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) | Stale approvals are dismissed when new commits are pushed. A [deployment](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments) names up to 6 required reviewers, and one approval is enough; "prevent self-review" is an option. | A yes covers the exact thing it saw. One answer per ask is enough, and the first one counts. |
| [ACP](https://agentclientprotocol.com/protocol/tool-calls) | `session/request_permission` offers `allow_once`, `allow_always`, `reject_once`, `reject_always`. A canceled turn must be answered `cancelled`. An unknown outcome is never an approval. | Our three picks map to ACP's: yes is `allow_once`, no is `reject_once`, never is `reject_always`. We never pick `allow_always`. |

### Counting money

| Who | How | What we take |
|---|---|---|
| [Anthropic](https://platform.claude.com/docs/en/api/rate-limits) | A spend limit per organization and per workspace; a request over it is refused. The [cost report](https://platform.claude.com/docs/en/manage-claude/usage-cost-api) comes in daily buckets. | Limits nest: a run sits under a project. The provider's report is a check on our count, not the count. |
| [OpenAI](https://developers.openai.com/api/docs/guides/spend-limits) | An alert only tells you. A hard limit refuses requests, but "enforcement is not instantaneous", so spend can pass it a little. | Say how far past a limit a run can go: at most one model request. |
| [AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html) | Alerts on actual or forecast spend. Data updates up to three times a day, so you can pass a budget before you hear of it. [Budget actions](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html) run on their own or after an approval. | A meter that only reads the bill is too late. Count before and after each turn. |
| [Google Cloud budgets](https://docs.cloud.google.com/billing/docs/how-to/notify) | A budget does not cap spend. To cap it, you wire its messages to code that turns billing off. | The cap and the count must be one thing, or the cap is a hope. |
| [Langfuse](https://langfuse.com/docs/model-usage-and-cost) | Cost per generation, "ingested" (the caller sends it) or "inferred" (from tokens and a price table). Ingested wins. | A charge takes the harness's dollars when it gives them, and works them out from tokens and prices when it does not. |
| [Stripe holds](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method) | Authorize (a hold), then capture the real amount. A partial capture releases the rest. A hold that is never captured is released when it expires. Some cards allow [incremental authorization](https://docs.stripe.com/payments/incremental-authorization). | This is `hold` and `charge` today. A long turn may hold more as it goes, the way an incremental authorization does. |

## The Elm answer first

- **Asking.** In Elm a question is part of the `view`, and a click is a `Msg`.
  The model holds the question until the answer comes, so an answer can never
  be there without its question. Across a process, Elm uses a port: a Cmd goes
  out, a Sub brings the reply in. Here that is an Act (write `asked`) and a
  Listen (read `answered`). No new move.
- **Money.** Elm has no meter. A count that many programs share lives outside
  any one program, and a program asks it by Cmd and gets a `Result` back, the
  way an HTTP call does. Here the ledger holds the count, `hold` and `charge`
  are Acts with a typed error, and a limit hit is an `Err`, never an exception.
- **The six moves.** The ask is Act, Listen and Check (does the yes still cover
  what it is about). The money combo from the experiments note is Gather (the
  cases and the price per case), Check (the estimate), ask, Act (`setLimits`,
  then `hold` and `charge`) and spawn (5 cases, then the rest). No Judge: a
  person's words are never read into a person's answer by a model. Nothing
  here needs a new combo beyond `ask` growing.

## The ask

### The facts

```ts
// A sketch. One shape for every ask, in the stream of the name that waits:
// a ticket's inbox, a plan's, an experiment run's, an agent run's.
const AskFact = Schema.Union([
	/** Code asks. `shows`: the data the window draws, and nothing else. `saw`: its hash. */
	Schema.Struct({
		type: Schema.Literal("asked"),
		ask: Id,
		for: For,                                // "spend" | "permission" | "plan" | "stuck" | "ruling" | "check" | ...
		who: Schema.NonEmptyArray(Member),       // whose answer counts; one is enough
		shows: Shows,                            // a union, one shape per `for`
		saw: Hash,                               // Hash.of(shows)
		picks: Schema.NonEmptyArray(Schema.String),
		until: Schema.NullOr(Schema.Number),     // when the wait ends; then it is withdrawn
	}),
	/** A person answers: one pick, a note, and the hash of what the window drew. In `PERSON_KINDS`. */
	Schema.Struct({
		type: Schema.Literal("answered"),
		ask: Id,
		pick: Schema.String,
		note: Body,
		saw: Hash,
		with: Schema.optionalKey(Schema.Unknown), // the extra a kind's answer takes, such as "keep going 2 rounds"
	}),
	/** Code takes the ask back: its run ended, its time ran out, or what it was about changed. */
	Schema.Struct({
		type: Schema.Literal("withdrawn"),
		ask: Id,
		why: Schema.Literals(["ended", "expired", "changed"]),
	}),
]);
```

- `asked` and `answered` are today's tracker facts, grown. `asked` gains `for`,
  `who`, `shows`, `saw` and `until`, and `shows` takes the place of `what`.
  `answered` gains `with`, and its `text` is renamed `saw`. `withdrawn` is new.
- `answered` is written with the message id `answer/<ask>`. The ledger's inbox
  keeps one event per message id, so a second answer to the same ask is a
  `dup` and writes nothing. The first answer wins by the ledger's own rule, not
  by a check someone could forget.
- The fold refuses, as `ticket.ts` already does: an answer to an ask never
  asked, a pick not in `picks`, an answer after `withdrawn`, and (new) an
  answer whose `saw` is not the ask's `saw`. A refused fact is never written:
  the program's `problemWith` runs before the write, as today.

### One kind per question

```ts
// A sketch, in the shape of Cmd.define: a kind names what it shows and what its answer takes.
const spend = Ask.define("spend", {
	shows: Schema.Struct({run: Name, usd: Usd, cases: Count, of: Count, model: Schema.String}),
	picks: ["yes", "no", "never"],
});
const permission = Ask.define("permission", {
	shows: Schema.Struct({run: Name, tool: Schema.String, input: Schema.Unknown}),
	picks: ["yes", "no", "never"],
});
const plan = Ask.define("plan", {
	shows: PlanShows,                         // the plan, and what changed since the last yes
	picks: ["approve", "change", "no"],
	with: {change: Schema.Struct({line: Id, text: Body})},
});
```

- The asks program's four kinds (plan, stuck, ruling, check) become four
  kinds here. Their answer shapes stay theirs: `with` is decoded by the kind's
  schema in the asker's `update`, and a value that does not decode is refused.
- The window's ask box takes only `shows` and `picks`, the way `defineBrief`
  takes only its keys. It reads nothing else, so the hash of `shows` is the
  hash of what the person saw.

### The one hash

```ts
// A sketch. In @kampus/fabrika's top level: Web Crypto runs in Node, a worker and the window.
const Hash = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/));  // ticket.ts has it now

export const hashOf = <A>(schema: Schema.Codec<A, unknown>, value: A): Effect.Effect<Hash> =>
	// encode with the kind's schema, write canonical JSON (RFC 8785), then SHA-256
	sha256(canonical(Schema.encodeSync(schema)(value)));

/** Does this yes still cover the thing, as it reads now? One character changed: no. */
export const covers = (answer: {saw: Hash}, now: Hash): boolean => answer.saw === now;
```

- Canonical JSON is the [JSON Canonicalization Scheme, RFC
  8785](https://www.rfc-editor.org/rfc/rfc8785): sorted keys, one way to write
  each number and string. It keeps today's rule from experiment 138 ("ab" +
  "c" and "a" + "bc" never share a hash), because the value is structured, not
  glued text.
- The hash is checked twice. At answer time, the window's `saw` must equal the
  ask's `saw`: the person saw what was asked. At use time, `covers` compares
  the answer's `saw` with the hash of the thing now: nothing changed since.

### The asker's state

```ts
// A sketch. An answer is only ever inside the state that holds its ask.
type Asking<K extends Kind> =
	| {readonly phase: "asking"; readonly ask: Asked<K>; readonly write: AskWrite}   // the Act is out
	| {readonly phase: "waiting"; readonly ask: Asked<K>}                           // the Listen reads answers
	| {readonly phase: "answered"; readonly ask: Asked<K>; readonly answer: Answered<K>}
	| {readonly phase: "withdrawn"; readonly ask: Asked<K>; readonly why: Withdrawn["why"]};
```

One example, the spend ask from the opening block:

```ts
const [s0, cmds] = ask.start(spend, {run: "experiment/170/run/3", usd: 0.4, cases: 5, of: 120, model: "jev-1"},
	{who: ["github:42"], until: in24h});
// s0:   {phase: "asking", ask: {ask: "spend-1", saw: "sha256:4be0…", …}, write}
// cmds: [ask_write {stream: "experiment/170/run/3/inbox", fact: {type: "asked", …}}]

const s1 = ask.written(s0);
// s1:   {phase: "waiting", ask}       listening on the run's inbox for `answer/spend-1`

const s2 = ask.answered(s1, {type: "answered", ask: "spend-1", pick: "yes", note: "", saw: "sha256:4be0…"});
// s2:   {phase: "answered", ask, answer}
// next: Act setLimits("experiment/170/run/3", {usd: 0.4, answer: 812}), through `remember`
```

## The meter

### Limits that point at a yes

```ts
// A sketch: a dollar limit always says which yes set it.
const UsdLimit = Schema.Struct({usd: Usd, answer: Pos});   // the row of a person's yes to a spend ask

const Limits = Schema.Struct({
	usd: Schema.optionalKey(UsdLimit),
	tokens: Schema.optionalKey(Schema.Number),
	wallMs: Schema.optionalKey(Schema.Number),
	children: Schema.optionalKey(Schema.Number),
});

// ledger.setLimits(name, {usd: {usd: 0.4, answer: 812}}) is refused unless row 812:
//   is an `answered` fact a person wrote, with pick "yes",
//   answers a `spend` ask in the stream of `name`,
//   whose `shows.usd` is 0.4 and whose `saw` the answer matches.
```

- The rule sits in the ledger (`rules.ts`), the one place every Layer runs.
  The door's "person-only" on `setLimits` stays, but it no longer carries the
  money rule alone: even a person's session cannot set a dollar limit with no
  yes behind it.
- A child limit set by code (`startChild` with `{usd}`, which is what
  `fabrika.toml`'s `usd` does) needs no answer. The ledger already applies
  every limit up the tree, the way cgroup v2 does, so a child can never spend
  past a parent's approved limit.
- `hold` answers a new `no_limit` when no name up the tree has an approved
  dollar limit. Spending with nobody's yes is refused, not counted later.
- A project gets its standing limit the same way: one spend ask on the project
  name, answered once, raised by asking again. Most runs then need no ask of
  their own.

### Who counts into it

```ts
// A sketch: Jev takes its money from the meter in blocks, the way a card hold works.
const jev = liveJev(key, {calls: 2_000}, meter.of(self))   // the dollar cap is gone from `Cap`
// first call: hold(fence, "jev/1", {usd: 0.05})  then each receipt counts against that block
// block spent: charge(fence, "jev/1", {usd: 0.049}) and hold(fence, "jev/2", {usd: 0.05})
// a hold that answers "limit": the call is refused unsent, as `over_cap` is today
```

- An agent turn holds its upper bound, and the same number goes to the harness
  as its own cap (`maxBudgetUsd` on Claude). One number, not two.
- A turn charges what the harness reports (Langfuse's "ingested"). When it
  reports `null`, as Codex does, the charge is worked out from the turn's
  `tokens` and a price table (Langfuse's "inferred"). The price table is the
  same one the estimate reads.

## Each old piece, and where it goes

### The ask

| Old piece | Becomes | Why |
|---|---|---|
| Tracker `asked`, `answered` (`tickets/ticket.ts`) | **Kept**, grown into the one shape | It is already on the ledger, already person-only, and the fold already refuses an answer with no ask. |
| `tickets/approval.ts` `sha256`, `hashOf`, `covers` | **Folded** into fabrika's `hashOf` and `covers` | Same idea; one hash. The ticket kind's `shows` is `{title, body}`. An old answer's `text` was a hash of a different string, so it covers nothing and is asked again, which is already the rule for an answer from before the hash. |
| `tickets/approval.ts` `changesRequested` | **Kept** | A different rule: a person's "request changes" after a yes takes it back. It now also writes `withdrawn {why: "changed"}`. |
| Asks program kinds and `answered` (`pipeline/src/asks/`) | **Folded**: four kinds of the one ask; its answers move to `answered` with `saw` | It answers by version number and covers nothing else. Its fold, its packs and the owner desk keep working; they read the one shape. |
| `combos.ts` `createAsk`, `Thread`, `Reply`, `/choice`, Judge reading | **Removed** once legacy's operator is gone; no new caller until then | A comment on a thread is written by a bot, not on a person's session, so it can never be a person's `answered`. A model reading a person's words into a pick is code writing a person's answer. Its one caller is in `legacy/`, which only shrinks. |
| `combos.ts` `hashOf`, `covers` (`node:crypto`) | **Removed** with `createAsk` | `node:crypto` cannot load in the window or a worker; Web Crypto can. |
| `acp` program `ask` output, `allow`, `refuse`, `--permissions` | **Folded**: `--permissions ask` writes `asked {for: "permission"}` on the run's name and listens for `answered`. The `ask` output stays as a view. The `allow` and `refuse` inputs go. | An input can be told by any program in a pipe. Only a fact from a person's session is a person's answer. |
| `Agents` event `asked {id, title}` | **Kept**, grown with `tool` and `input` | The person must see what the yes allows, and the hash must cover the call's input, not its title. |
| PR 192's `claude` and `codex` `ask`, `allow`, `refuse` | **Folded**, as for `acp` | Same reason. It also gives the dead inputs a real answerer. |
| Outcome verb `ask {who, for}` | **Kept** | It is how a stage says "a person must decide". The parent writes `asked` with `for` as the kind. |
| `PERSON_KINDS` | **Kept**, unchanged | `answered` is in it already. A spend yes is an `answered`, so no new kind is needed. |

### The money

| Old piece | Becomes | Why |
|---|---|---|
| Ledger `hold`, `charge`, `usage` | **Kept**: the one meter | Already nested, kept across restarts, one hold and one charge per turn, laws on every Layer. |
| Ledger `setLimits` for `usd` | **Folded**: takes the yes's row; refused without it | This is what makes a limit nobody approved impossible. `tokens`, `wallMs` and `children` stay as they are. |
| `JevReceipts`, `Cap.usd` (`jev-live.ts`) | **Folded**: dollars go to the meter in blocks; receipts stay as the call log | One count. `Cap.calls` stays: a call count stops a loop gone wrong, which is not about money. |
| `HOST_CAP` (`apps/fabrika/src/host/jev.ts`) | **Folded**: a child limit of $0.25 under the project | The same number, now under an approved limit. |
| `experiments/lib/jev.ts` caps | **Removed** for new scripts; old scripts stay as the lab record | Experiment 170 moves experiments onto the pipeline's `Jev`, as the map says. An old script is not run again without a rewrite. |
| `fabrika.toml` `[agents.*] usd` | **Kept** as a child limit code sets | It is a setting, not an approval. It can only lower what a run may spend. |
| `Agents` `Limits.usd` | **Folded**: it equals the turn's hold | One number for the meter and the harness. |
| `Agents` `ended.usd`, a Draft's `spend.costUsd` | **Kept** as what a charge reads | They are the ingested cost. |
| Tracker `ended.usd` | **Kept**, written from `usage` at the run's end | The ticket shows a run's cost without a second read. It copies the meter; it never counts. |
| `field/runs.jsonl` `costUsd` | **Kept** | A hand record of today's fabrika. It is evidence, not a meter. |

## Branches

Each case, and what happens. The names on the right are the asker's phases or
the ledger's answers.

```ts
// A sketch: case -> what happens.
yes            -> answered; spend: setLimits with the yes's row; permission: allow_once
no             -> answered; the stage ends skip:refused (spend) or the tool is refused (permission)
never          -> answered; as no, and the asker keeps a refusal for this `for` and subject
limit mid-turn -> hold refused: the turn never starts; charge past it: the run ends limit:usd
3x over        -> the trial ends limit:usd at the yes; a new ask shows the measured price
3x under       -> the rest of the yes is never held; a new ask for the rest shows the measured price
two people     -> the first answer is written; the second is a dup and is shown "answered by"
late answer    -> the ask was withdrawn {why: "ended"}; the fold refuses the answer
no person      -> no ask is written; the box's rules refuse the tool, reject_once
```

- **A person answers yes.** The fact lands; the asker goes to `answered`. For
  a spend ask, the asker sends `setLimits` with the yes's row through
  `remember`, so a crash in between sends it again. For a permission ask, the
  agent program picks `allow_once` for that one call; the next call asks
  again.
- **A person answers no.** For a spend ask, the run ends `skip:refused`, not
  `stuck`: nothing broke, a person said no. For a permission ask, the harness
  gets `reject_once` and the turn goes on without the tool. For a plan, `no`
  sends the note back to plan, as today.
- **A person answers never.** As no, plus a standing refusal: the asker's fold
  refuses the same `for` on the same subject without asking (ACP's
  `reject_always`). For permission it lasts the run; for spend it lasts until
  the estimate's text changes, since a new text is a new hash. Only a person
  lifts it, by answering a new ask. We never offer "always" for yes: an
  always-allow is a limit with no amount.
- **The run hits the limit mid-turn.** A hold counts against every limit up
  the tree before the turn, so a sibling cannot spend the money this turn
  holds. If the hold does not fit, the turn does not start. If a turn costs
  more than its hold, the money is spent anyway: the charge counts all of it,
  the run ends `limit:usd`, and the overshoot is at most one model request
  (OpenAI says the same of its hard limit). Claude stops at its own cap, which
  is the hold. Codex has no cap, so its turn charges on each `tokens` event
  and is canceled when the hold is used up; a longer turn may hold more first,
  like an incremental authorization.
- **An estimate was wrong by 3x.** The yes covers the 5-case trial: $0.40, at
  about $0.08 a case.
  - Each case costs 3x more: the trial uses up the $0.40 after about two
    cases and ends `limit:usd`. Nothing past the yes was spent, beyond at most
    one request.
  - Each case costs 3x less: the trial costs about $0.13. The rest of the $0.40
    is never charged, the way a partial capture releases the rest of a card
    hold.
  - Either way, the other 115 cases are a new spend ask that shows the price
    the trial measured, so it has a new hash. The old yes covers the old text
    only. The person looks at the trial's results in that same ask.
  - This changes the sketch in the experiments note, where one yes covers the
    whole run and the rest runs "under the same limit". Lean: two asks,
    because the price of the rest is only known after the trial, and a yes
    should cover a number the person saw. Cost: one more click per paid run.
    About 80% sure.
- **Two people answer.** One answer is enough, as with GitHub's required
  reviewers. The first `answer/<ask>` is written; the second is a `dup` and
  writes nothing. The window shows "answered by" the first person. If both
  must agree, that is two asks, one per person, and the asker waits for both.
- **The answer arrives after the run ended.** A run that ends for good writes
  `withdrawn {why: "ended"}` for each ask it left open, and the window stops
  showing them. An answer that lands after it is refused by the fold, as
  Temporal refuses a signal to a closed workflow; for spend, no limit is set.
  A run that only restarted has not ended: it reads its open asks back from
  the ledger and keeps waiting, as the asks program does today.
- **An agent's permission ask in a pipe with no person.** A run started with
  no person to ask (`--permissions refuse`, the default) writes no ask. The
  box's allow and deny rules decide, the refusal is `reject_once`, and the
  run's `tool` event records it. A run started with `--permissions ask` writes
  the ask with an `until`; if nobody answers by then, it is withdrawn
  `expired` and the agent gets `reject_once`. Silence is never a yes (ACP: an
  unknown outcome is not an approval; Claude: a hook that times out blocks the
  tool).

## What it costs to build

- Grow the tracker facts and the fold (`ticket.ts`), add `withdrawn`, and move
  `hashOf` and `covers` to fabrika. Laws: an answer without its ask, a second
  answer, a wrong `saw`, an answer after `withdrawn` are each refused.
- Move the asks program's four kinds onto the one shape; the owner desk and
  the packs read it. This is the biggest part.
- Add `answer` to the dollar limit in `rules.ts`, `memory.ts`, `sqlite.ts` and
  the Durable Object, with laws, and `no_limit` on `hold`.
- Feed Jev and the agents into the meter; a price table for inferred cost.
- Rewire `acp` and PR 192's programs to write and read the facts.
- No paid run is needed to test any of it. The memory ledger, the fake agent
  and a scripted Jev cover every branch above.

## How sure

- **85% on one ask as the tracker's facts, grown.** They are on the ledger,
  person-only, and folded with the checks we need. The doubt: whether the asks
  program's richer answers fit `with` cleanly. Moving the plan kind first would
  show it.
- **85% on one hash: SHA-256 over RFC 8785 JSON of `shows`, by Web Crypto.**
  The doubt: whether our own small canonical writer and a library agree on
  numbers. A property test that hashes the same value in Node and a worker
  would settle it.
- **75% on removing the thread path, the Judge reading included.** The doubt:
  a person may want to answer from a phone or a GitHub comment. A link that
  signs the person in and writes the fact on their session would keep that.
  Counting in `field/` how often answers came by comment would settle whether
  it is needed.
- **75% on a dollar limit that must point at a yes.** It makes an unapproved
  limit impossible, which no warning can. The doubt: one more rule in the
  ledger about one fact kind. The other way (a `spend` stage that only checks)
  is easier to build but can be skipped. A review of `rules.ts` with the change
  would show if it stays small.
- **70% on `no_limit` before any spend.** The doubt: friction for a $0.01 Jev
  hint. A standing project limit should make it rare. Counting the asks in a
  week of experiment 170 and one lane would settle it.
- **70% on Jev holding in blocks.** The doubt: how many ledger writes a 2,000
  call run makes, and the block size. A memory-ledger run with a scripted Jev,
  no money spent, would measure it.
- **60% on stopping Codex by its `tokens` events.** The doubt: ACP gives only
  the last request's tokens, so a turn's running total may lag. One cheap real
  Codex turn, after the fake, would show how far it lags.

## What it cannot tell us

- Whether people answer faster in the window than on a GitHub comment. Only
  the first weeks of use will show it.
- How good the estimates are. The 5-case trial measures one experiment at a
  time; the price table only knows prices, not how long an agent works.
- Whether the provider's own bill agrees with the meter. Nothing here compares
  them; a weekly check against the Anthropic cost report is the obvious next
  step, and it is not designed.
- Whether two asks of two people is enough when a change needs both to agree.
  No ticket has needed that yet.
- How `withdrawn {why: "changed"}` should treat a yes on a plan that changed
  only in a typo. Today any change asks again, and this note keeps that.
