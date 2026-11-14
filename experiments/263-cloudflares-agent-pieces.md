---
date: "2026-11-11"
scripts: "none; reading, nothing ran"
summary: "`next/`. Borrow, do not build on them. The 2026-11-09 Codex entry is an experimental example whose agent has two tools, read a file and write a file. Lifecycle's one alarm per object matches our rule. Worth taking: its crash cases for our recovery laws, Streams' resume by cursor for the window's feed, and git with no container for a hand that has no shell. As a base it would replace the tea machine inside each process object, add three records beside the ledger, and re-run cut-off work on its own. Decided as 0121. No model, $0."
---

# Should `next/` build on Cloudflare's agent pieces (Lifecycle, Tasks, Streams, Sessions, Workspace), or borrow from them?

Read 2026-11-11. **This is reading, not a measurement.** Nothing ran. The owner walked it the same day and decided [0121](../.decisions/0121-borrow-from-cloudflares-agent-pieces.md). Sources were read from the packages themselves (`npm pack` into a temp folder,
files only, nothing run), GitHub through `gh api`, and Cloudflare's docs. "Secondary" marks a page
Cloudflare did not write. "Not found" means I looked and it was not there.

## The answer first

- **What was announced** is a changelog entry dated 2026-11-09, "Run the Codex agent loop on
  Cloudflare Workers"
  ([source in cloudflare-docs](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/changelog/agents/2026-11-09-codex-harness.mdx)).
  It calls itself an "experimental Agents SDK
  example". It is not a new product. `CodexHarness` is example code in
  [`examples/next/harnesses/codex`](https://github.com/cloudflare/agents/tree/main/examples/next/harnesses/codex),
  not a published package.
- **The pieces are older than the announcement.** `agents/lifecycle` first shipped in `agents` 0.22.0
  (2026-08-27). `tasks`, `streams` and `sessions` came in 0.23.0 (2026-09-11), and `models/ai-sdk`
  and `harness/container` by 0.28.0. The latest is `agents` 0.33.0 (2026-11-03).
  `@cloudflare/computer` was announced on 2026-08-03
  ([blog](https://blog.cloudflare.com/cloudflare-computer/)), and 0.11.0 came out on 2026-11-11.
- **No blog post for the Codex harness was found.** The only blog post is the one about Computer.
- **The coding agent in the entry cannot run a shell, git or tests.** The example's harness
  gives the model two tools, `workspace_write` and `workspace_read`
  (`src/codex-harness.ts`, `static readonly TOOLS`). That's all it has.
- **The "Codex harness guide" the changelog links to is a different thing.**
  [developers.cloudflare.com/agents/harnesses/codex](https://developers.cloudflare.com/agents/harnesses/codex/)
  runs the real Codex CLI inside a Cloudflare Container through `ContainerHarness` from
  `agents/harness/container`. It never mentions `CodexHarness`, Wasm, Tasks or Workspace.

```ts
// The whole idea, from the changelog. One Durable Object class per agent, with capabilities
// stacked on one Lifecycle that owns fetch, alarm and WebSocket handlers.
export class Coder extends DurableObject<Env> {
  tasks = new Tasks(); streams = new Streams(); sessions = new Sessions();
  workspace = new Workspace({ storage: this.ctx.storage });
  codex = new CodexHarness({ tasks, streams, sessions, workspace, model });
  lifecycle = Lifecycle.install(this).use(this.tasks).use(this.streams).use(this.sessions).use(this.codex);
}
```

## Each piece

All of the `agents` pieces below run on a plain SQLite-backed Durable Object. The example's
`wrangler.jsonc` sets `compatibility_date: "2026-06-11"`, `nodejs_compat` and `new_sqlite_classes`.
The ContainerHarness docs page uses `2026-11-06`. SQLite Durable Objects work on the Free plan
([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)). Containers need
Workers Paid.

| Piece | Status (its own docs) | Stores in | Wakes by |
|---|---|---|---|
| Lifecycle | stable | DO SQLite (job queue) | owns the object's one alarm |
| Tasks | experimental | DO SQLite (step journal) | a job in Lifecycle's queue |
| Streams | experimental | DO SQLite (256 KB blocks) | no alarm |
| Sessions | experimental | DO SQLite (message tree) | no alarm |
| Workspace | stable fs; container experimental | DO SQLite, R2 read-only mounts | none of its own |
| `createAI` | not marked | none; AI Gateway logs | none |
| CodexHarness | example only | DO SQLite, via the four above | a Tasks run |

### Lifecycle (`agents/lifecycle`)

It turns a plain DO into a host for "capabilities", each a class with `onStart`, `onRequest`,
`onJob` and similar hooks. `Lifecycle.install(this)` installs the DO's `fetch`, `alarm` and
`webSocket*` handlers for you ("Do not define forwarding versions of those methods").

```ts
class Cleanup extends LifecycleCapability {
  constructor() { super("cleanup"); }
  schedule(time: number) { return this.lifecycle.jobs.push({ id: "cleanup", fn: "sweep", time }); }
  async onJob({ job }: LifecycleJobContext) { /* returning nothing completes the job */ }
}
```

- **State:** one durable job queue in the DO's SQLite. "Lifecycle owns the Durable Object's queue
  of durable work and its single physical alarm."
- **Waking:** each change to the queue sets the alarm again. When it fires, due jobs run in order,
  then `onAlarm`. A "deadman pre-alarm" covers an isolate that dies mid-run. A job can finish, set
  `{ rescheduleAt }`, or `"yield"`. It also has `exclusive` and `singleflight` jobs. Retries are
  built in, and a job keeps going across a deploy or a memory-limit reset.
- **Hibernation:** the default `cf-websocket` wire uses the Hibernation API, so idle clients stay
  connected while the object leaves memory. The `capnweb` wire "does not hibernate: the object stays
  pinned while it is open".
- **Limits:** startup holds `blockConcurrencyWhile`, with a 30 s timeout. There is no `next()`
  middleware. Native RPC skips the automatic startup, so an RPC method must call
  `await this.lifecycle.start()` itself. It wants `idFromName`/`getByName`, and an RPC to a raw ID
  fails.

### Tasks (`agents/tasks`)

Durable step functions that replay inside one DO, in the style of Temporal or Workflows.

```ts
new Tasks({ definitions: { "build-report@v1": async (input, step) => {
  const r = await step.do("research", { retries: { limit: 4 } }, ({ signal, idempotencyKey }) => ...);
  await step.sleep("delay", "30 seconds");
  if (step.interrupted?.name === "deliver") { /* the isolate died mid-step: check first */ }
  return r;
}}});
```

- **State:** a step journal in SQLite. Inputs and results must be JSON and at most 1 MiB.
- **Waking:** "The capability never touches the Durable Object's physical alarm." Each run's
  deadline is one Lifecycle job. Sleeps keep no isolate in memory.
- **Meaning:** at least once. A handler runs again from its first line, so side effects go inside
  `step.do`. A changed journal fails the run with `TaskReplayDivergedError` rather than guessing.
- **Limits:** "no `waitForCompletion` mode" and "no runs on routed sub-agents". The default attempt
  timeout is 5 minutes, with 5 retries and exponential backoff by default.

### Streams (`agents/streams`)

An ordered, durable log of chunks per stream, with a cursor. A reader replays, then tails, and
the log ends with a final status.

```ts
const s = await this.streams.open("reply:123");  s.append(chunk);  s.close();
for await (const c of this.streams.read("reply:123", { from })) { ... }
return sseResponse(this.streams, "reply:123", { request }); // SSE id = seq, Last-Event-ID resumes
```

- **State:** SQLite "rollover blocks", one row per 256 KB. A "cutover" closes the stream, writes
  the final message and deletes the stream's rows in one transaction.
- **Waking:** "needs no alarm". Live fan-out stays inside one isolate.
- **Limits:** one writer per stream, with no writer fencing yet ("producer-generation fencing on
  `open()`... future work"). Old streams are not deleted automatically: you call `delete()`.

### Sessions (`agents/sessions`)

Durable chat history: a tree of messages with branches, compaction and optional full-text search.
It takes AI SDK `UIMessage` shapes.

```ts
const session = this.sessions.session();
await session.appendMessage({ id, role: "user", parts: [{ type: "text", text: "Hi" }] });
for await (const m of session.history({ newestFirst: true })) { ... }
```

- **State:** SQLite, at most 1.5 MiB per row, with large messages split across extra rows.
  "Sessions imposes no maximum message size." The ceiling is the DO's 10 GB.
- **Waking:** "needs no alarm".
- **Limits:** "Sessions stores messages. It is not a file store." You must bound untrusted input
  yourself.

### Workspace (`@cloudflare/computer`)

**What it is:** a file system stored in the DO's own SQLite, with a `node:fs/promises`-like API.
Code can run against those files on a backend you plug in. Without a backend it is only files.
The package describes itself as "a SQLite-backed virtual filesystem with sync to a container-side
daemon (computerd)".

```ts
const ws = new Workspace({ storage: ctx.storage, git: createGitClient(), backends: [
  new WorkerShellBackend({ loader: env.LOADER, ... }),            // just-bash in a Dynamic Worker
  new ContainerBackend({ id: "sandbox", container: () => this }), // real Linux, via computerd + FUSE
]});
await ws.git.clone({ url }); using run = await ws.runtime.exec("npm test", { backend: "sandbox" });
```

Can it run `git`, a test suite or a build?

- **git:** yes, without a container. `workspace.git` is isomorphic-git working on the SQLite files,
  and it is "Stable".
- **A shell:** the worker shell is just-bash (bash rewritten in JS) in a Dynamic Worker. It is
  "Experimental" and needs a Worker Loader binding and the `experimental` flag. It cannot run real
  binaries.
- **Tests and builds:** a real `npm test`/`pnpm test` needs the Container backend, which is
  "Experimental". Its README says "The container-side filesystem is held in memory. Aim for
  agent-scale workspaces, not full monorepos", and FUSE makes "large `node_modules` installs" slow.
  Remote exec, a third path, pushes and pulls files around one `ctx.container.exec()` call. It is
  also experimental.
- **Limits:** about 10 GB per workspace, shared with the DO. The largest container is 4 vCPU,
  12 GiB and 20 GB of disk
  ([limits](https://developers.cloudflare.com/containers/platform/limits/)). Containers bill per
  10 ms of running time on Workers Paid
  ([pricing](https://developers.cloudflare.com/containers/platform/pricing/)).
- **The blog** called it "an early preview" on 2026-08-03. The README now calls the fs, git and
  codemode parts "suitable for production use", and the container parts experimental.

### `createAI` and the AI binding (`agents/models/ai-sdk`)

An AI SDK v4 provider. A model name string runs through `env.AI.run`: `@cf/...` is Workers AI,
`<author>/<model>` is the AI Gateway catalog, and `dynamic/<route>` is a gateway route.

```ts
const ai = createAI({ binding: env.AI, id: "default" });   // "default" gateway made on first use
await generateText({ model: ai("openai/gpt-6.1-sol"), prompt });
```

- **Cost:** "Unified billing means no vendor key". The gateway holds the key, or you bring your own
  (BYOK). It needs `ai@^7` and `@ai-sdk/provider@^4` as peer packages. I did not check whether
  `openai/gpt-6.1-sol` is really in the catalog.

### The harness shape

`CodexHarness extends LifecycleCapability`. It is a Rust/Wasm port of Codex's turn loop, pinned to
`openai/codex` commit `5e26f76`. The kernel only tracks where one turn is: model calls and tool
calls are Tasks steps, the transcript goes to Sessions, events go to Streams, and files go to the
Workspace. Its design note, `design/rfc-codex-harness-capability.md`, still says
"Status: proposed".

```ts
static readonly TOOLS = [{ name: "workspace_write" }, { name: "workspace_read" }]; // and nothing else
```

The other path is `ContainerHarness` with a `codex()` preset, which runs the real CLI in a
container. It is "experimental" and needs an OpenAI key and Docker for local dev. After 5 idle
minutes it snapshots the files and stops the container. "Files come back from the last snapshot",
so newer edits can be lost. A container lost mid-turn ends the turn `unanswered`/`container_lost`.

## Against our `next/`

Settled notes I read: brain, hands, window, agent (`docs/direction/brain-hands-window-agent.md`),
the cloud is one more host (its brain-and-hands section and the alarm rule), the five layers,
agents are programs, an agent run keeps its content, decision 0042, and and the P39 and P41 plans. All claims below are about `next/` unless they say otherwise.

| Cloudflare piece | Our piece | Fit |
|---|---|---|
| Lifecycle job queue + one alarm | the process object's alarm (owner, 2026-11-07: "one alarm per object, set in one function, at the earliest timer") | same idea; ours exists; theirs would replace it, not sit under it |
| Tasks | P39 jobs (save request, then offer; keep result, then ack) and runner recovery | overlaps; their meaning is weaker for side effects |
| Streams | program outputs to windows; P41 mailboxes only partly | good idea to borrow; a second log beside the ledger |
| Sessions | an agent run's content (Langfuse-style, in the job's record) | overlaps; their shape is AI-SDK chat |
| Workspace + container | the laptop as hands; a cloud hand | could sit under hands as one more host |
| `createAI` / AI Gateway | nothing planned; agents are CLI programs on hands | does not fit now |
| class-per-agent harness | `Program.make` + one tea machine per file | does not fit |

### What is really better than ours, or worth taking

- **The alarm design matches ours, and theirs is tested in the field.** Lifecycle's job queue
  confirms our 2026-11-07 rule. It adds the deadman pre-alarm, the "fallback alarm at least 30 s
  out" when startup fails, and job outcomes (`rescheduleAt`, `yield`, `exclusive`, `singleflight`).
  Those cases are worth comparing with our runner's recovery laws.
- **Streams' resume through SSE `Last-Event-ID`** answers "a browser is always a client" with no
  client code. The block storage and the one-transaction cutover cut rows written by about 10x
  (their own measurement: 42 rows to write, 3 to cut over, against 42 + 42).
- **`step.interrupted`** names the same case as P39's `unknown: { reason: "interrupted" }`.
- **Workspace's git without a container** and its R2 read-only mounts are a real way for a cloud
  hand to read a repo cheaply.

### What it would undo in settled notes

- **"All machine work is a Cmd the hands do... a program never touches one"** (the cloud is one
  more host, 2026-10-30). Workspace puts files and git *inside* the program's object. Taking it as
  the brain's file system undoes that rule. Taking it as a *hand* (a host whose `has` includes
  `git` and `files`, which dials the brain) undoes nothing.
- **Programs are tea machines** (0046, `Program.make`). Their shape is one class per agent, with
  mutable capability objects and a `lifecycle` that owns the handlers. Under it we would have two
  ways to step an agent.
- **The ledger is the one record.** Tasks journals, Streams blocks and Sessions trees are three
  more records in the same SQLite file, with their own retry and replay rules. "An agent run keeps
  its content" puts content in the job's own record, beside its spans, where a person can delete it.
- **Effect all the way, no Promises** (no-promises note) and **through Alchemy** (0042). Every API
  here is Promise-based and `extends DurableObject` from `cloudflare:workers`. Installed Alchemy
  2.0.0-beta.84 exposes the *platform* parts:
  - Containers with `schedulingPolicy: "durable_object"`
  - `WorkerLoader`, the AI binding and AI Gateway, and Artifacts
  - `DurableObjectState.raw`, "for interop"

  It does not wrap `agents` or `@cloudflare/computer`, which are libraries. Using them means a
  marked edge under 0042 at least. My guess, not tested: `Lifecycle.install(this)` taking over
  `fetch`/`alarm` clashes with Alchemy's own DO class, which owns those handlers. I did not read
  Alchemy beta.85 (the newest, 2026-11-02).
- **Agents are programs, claude and codex at parity** (proposed, Tier 5). The Wasm `CodexHarness` is
  a re-implementation of Codex pinned to one commit. It is not the CLI the makers ship, and
  nothing like it exists for Claude. `ContainerHarness` does have both presets (`"claude-code"` and
  `codex`), which is closer to our parity rule.
- **Mailbox order and authority (P41).** Streams has one writer per stream and no writer fencing
  yet. Our mailboxes deliver at least once, in inbox order, with the host in charge. Streams can't
  stand in for them.

### Hype, or not our design

- "Coding agent on Durable Objects" with read and write tools only is a file-editing chat, not a
  coding agent. A real test run needs the experimental container. Our repo's checks need about 8
  cores for `tsgo` and a full monorepo. The largest container is 4 vCPU, and the container fs is
  "not full monorepos".
- Tasks replays automatically, at least once. P39 decided the stricter rule on purpose: work cut
  off after it started is `unknown` and never runs again by itself. For `git push` or a merge,
  ours is the safer meaning.
- Everything except Lifecycle, and the Workspace fs and git, is marked experimental, and the
  example's design note is "proposed".

## Lean

The owner took this lean on 2026-11-11, and added one idea: a hand with git and files and no
shell, for doc changes (0121).

Don't adopt it as a base. Borrow the ideas we lack, and keep a cloud hand as a later option.

- **Why:** it overlaps the parts we have already built or decided (the process object's alarm,
  P39 jobs, P41 mail). Using it would undo three settled rules: programs as tea machines, files
  only on hands, and the ledger as the one record. It would also break Effect-through-Alchemy.
- **What we can take for little:**
  1. Compare our runner's recovery laws with Lifecycle's job cases.
  2. Borrow Streams' SSE cursor resume and its block-plus-cutover storage for the window's feed.
- **Later (Tier 4 or after):** a container-backed hand in the cloud for "no laptop" runs, as one
  more host in the brain-hands design. That stays an experiment until a real ticket needs it.
- **Cost:** none now. A cloud hand later is a Workers Paid container plus our own hands process
  in the image.
- **Confidence:** 80%. **Doubt:** a cloud hand might want Workspace's sync (DO SQLite to container)
  rather than a git checkout. Running our hands process in one `standard-4` container against a
  real ticket would settle it.

## What this cannot tell us

- I found no Cloudflare blog post for the 2026-11-09 Codex entry, only the changelog, the example
  and the docs.
- I ran nothing. Speed, cold start and cost figures are Cloudflare's own, not ours.
- I did not test whether `Lifecycle.install` works on an Alchemy-defined DO, and I did not read
  Alchemy beta.85.
- I did not check `openai/gpt-6.1-sol` in the AI Gateway catalog or its list price.
- The changelog links a guide whose content is now about `ContainerHarness`, not the Wasm example.
  Maybe the page changed after the entry was written. I can't tell which.
- Secondary pages (flaviocopes.com, infoq.com, aicybr.com) came up in search. Nothing here
  depends on them.

Cost: $0. No model run and no paid call.
