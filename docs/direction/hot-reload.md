# Hot reload

**Decided 2026-11-01 by the owner:** `next/` has hot reload from day one. Saving a program's file
brings its new code into the running app with no restart, so Tier 1's slice has it. **How it works
is proposed:** the six principles below, what each layer does, the facts on the ledger, where it
is off, and the laws, each with a lean.

Built from [experiment 183](../../experiments/183-hmr.md), which swapped a program's code under a
running process in Miniflare and read how about ten tools do it, and a clickable page, "Hot reload
guidelines", a private page with the six principles you can press.

```ts
// next/, under dev.ts. An agent saves programs/counter/src/machine.ts.
// dev.ts bundles it, hashes it, and installs it in the brain. The brain writes:
{_tag: "code.loaded", body: {program: "counter", hash: "67896c9f...", was: "0b1e4a...", from: "watch"}}
// Each `counter` process takes it at its next step, through its own mailbox:
//   the new state schema decodes the model -> keep it; only update and view change
//   it decodes after the version's upcast  -> keep the migrated model (Erlang's code_change)
//   it does not decode                     -> code.refused; this process stays on its old code
// Nothing else stops. Every entry a process writes names the build that wrote it:
{_tag: "stepped", body: {id: "m5", build: "67896c9f..."}}
```

## Which version

- **`next/`:** true from Tier 1, under `dev.ts`. Tier 1 has programs in the brain and windows, so
  both reload there. Hands arrive in Tier 4 and a lane in `next/` later, and their rules here are
  recorded now so the facts are right from the first entry.
- **Today's version (`apps/fabrika`):** not changed by this note. To get new code today, a person
  quits, rebuilds, and presses "Stop the old host and start this one", which stops every job. A
  fix to one program restarts everything, even mid-lane. Tracker ticket 67 is today's ticket for that;
  see [a tryout in today's version](#a-tryout-in-todays-version).

## What was decided

### H0: hot reload in `next/` from day one

Decided by the owner today. Tier 1 ships with it, not a later tier. The line to add to
[Tier 1's rules](../plan/tier-1.md#rules-that-bind) is proposed in this note's pull request, for
the owner to place.

## What is proposed

Six principles. Each is a lean, with why, cost and how sure.

### H1: new code, same session

- Saving a program's file swaps only that program. The app does not restart, the brain does not
  restart, and no other program notices.
- One path for a save and a deploy: a new hash arrives (`from: "watch"` or `from: "deploy"`), and
  each process of that program takes it at its next step. Only what sends the hash differs.
- **Why:** this is what the owner asked for, and Erlang's default: one module, two versions at
  once, and a process moves at its next call
  ([code loading](https://www.erlang.org/doc/system/code_loading.html)). Programs already load by
  content hash through Worker Loader ([experiment 173](../../experiments/173-worker-loader.md)),
  so a new version is a new hash and the old one keeps running until it is told.
- **Cost:** a watcher in `dev.ts`, one `install` call on the brain, and one swap step in the core.
- **How sure:** 85%. Measured: 23 ms per swap at the median, 26 ms at p95, in Miniflare.

### H2: the model stays; update and view change

```ts
// A sketch: the swap is one more message in the process's mailbox (Effect, not a Promise).
const swap = (to: Hash) =>
	Effect.gen(function* () {
		const program = yield* ProgramLoader.get(to);
		const fit = yield* program.migrate(yield* Model.get); // decode, after the version's upcast
		if (fit._tag === "refused") return yield* Log.append(CodeRefused.make({program: program.name, hash: to, was, why: fit.why}));
		yield* Model.set(fit.model);
		yield* Running.set(to);
		yield* Log.append(CodeLoaded.make({program: program.name, hash: to, was, from}));
	});
// mailbox: Msg, Msg, swap, Msg   -> a swap is never inside a step
```

- The model is kept. The new code's own state schema decides if it can read it.
- **The swap waits its turn.** A Durable Object takes the next call while a step awaits the
  isolate, so a swap must go through the process's mailbox, between two Msgs. Experiment 183 sent
  one around the queue: two old steps finished after it, wrote the old shape over the new, and the
  counter became `null` in 5 of 5 runs, with every log entry still looking fine. Through the queue,
  5 of 5 were right.
- **Why:** Elm keeps the Model and swaps the rest ([elm-hot](https://github.com/klazuka/elm-hot),
  [elm-watch](https://lydell.github.io/elm-watch/hot-reloading/)). Erlang suspends a process
  before `change_code` ("The process must be suspended to handle this message",
  [sys](https://www.erlang.org/doc/apps/stdlib/sys.html)); our mailbox is the suspend.
- **Cost:** none past H1; the queue already exists ([the five layers](./a-local-first-sync-engine.md)).
- **How sure:** 85%.

### H3: a new shape migrates, or that one process is refused

```ts
// A sketch, in the program: a version may carry an upcast from the shape before it.
export const state = Schema.Struct({count: Schema.Number});
export const upcast = (raw: unknown) => (isRecord(raw) && "n" in raw ? {count: raw.n} : raw);
```

- With an upcast that decodes, the migrated model is kept. That is Erlang's `code_change/3`,
  which returns `{ok, NewState}` ([gen_server](https://www.erlang.org/doc/apps/stdlib/gen_server.html)).
- With none, or one that fails, the swap is refused for that process. It keeps running its old
  code, and its tile says so, with `[Restart counter-1]`. A restart runs the new `init`, and the
  person presses it. Other processes of the same program that do fit, swap.
- Never a guess. elm-hot feeds the old model to new code without a check and warns the first
  render "may fail if shape of model changed too much"; we decode instead.
- tea 0.21.0 already has this shape: a Store's `migrate(raw)` answers a state, `null` or a
  `refuse(why)`, and `schemaMigrate(schema, upcast)` builds one. The core uses it.
- **Why:** it is the state check [an old host is named, then restarted](./an-old-host-is-named-then-restarted.md)
  already decided for today's jobs, moved down to one process.
- **Cost:** an upcast is the author's to write, only when a shape changes.
- **How sure:** 85%. The doubt: whether people want "restart and lose this state" to happen by
  itself in dev. One week of use would tell.

### H4: a bad save never takes over

| Save | What happens | Fact |
|---|---|---|
| a syntax error | esbuild refuses it; no hash, nothing reaches the brain | `code.failed` from the watcher, with the line |
| a module that throws as it loads | the load fails; the process stays on its old code | `code.failed` |
| a state the new code cannot read | H3 | `code.refused` |
| a step that throws | the process goes back to the code before, and the same Msg runs once there | `step.crashed`, then `code.rolled_back` |

- **Why:** Vite and Fast Refresh fall back to a full reload and keep going; tracker ticket 67 says
  "Syntax error: keep the old code, show the error". A step is pure, so a step that threw sent
  nothing, and running its Msg on the old code is safe.
- **Cost:** the core keeps one `was` hash per process.
- **How sure:** 70%. The doubt is the rollback: it is safe only while a step is pure. A real
  program also returns Cmds, and a swap that changes Subs must stop old ones and start new. That
  was not run.

### H5: running work keeps running

What survives a reload is what lives outside the part that restarts. Every tool read agrees: VS
Code keeps terminals in a pty process of their own; Durable Objects keep storage and hibernated
sockets across a deploy; tmux keeps every session in one server. In `next/` that is already
the design: facts in the log, a process's state in its object's storage, only a window's own
model in memory.

| Part | What a change does | What is kept | Tier |
|---|---|---|---|
| a program in the brain | swaps at the next step (H2) | the model, its Cmds' jobs | 1 |
| a program's window view | swaps in the window (below) | the window's model, if it decodes | 1 |
| the core, libfabrika | restarts workerd, Erlang's `restart_new_emulator` | everything; 56 ms in 183, about 200 ms in experiment 93 | 1 |
| Electron's main process | restarts it; the brain does not stop | everything | 1 |
| hands | restart, with terminals in a pty process of their own, as VS Code | terminals and jobs | 4 |

- **Memory.** Each save keeps about 4 MB in local workerd, and none came back in 20 s (60 saves:
  171 MB to 421 MB). Cloudflare gives no eviction rule for Worker Loader. So local workerd restarts
  on the mark it already has (500 MB, experiment 93), which loses nothing.
- **How sure:** 80% for the brain and the core; 60% for hands, since nothing is built.

### H6: you see what changed, and so does the log

```text
counter-1                                   new code: count shows as "count: 7"   (gone at the next key)
counter-2   [!] new code can't read this state   [Restart counter-2]   (stays until pressed)
```

- A quiet mark on that tile's title bar, a word and an icon, never color alone (WCAG 1.4.1). Gone
  at the next key. A refusal or an error stays until acted on.
- An agent sees the same facts through its tools: the `code.*` entries, as tracker ticket 67 asks.
- Every entry a process writes carries `build`. So a step, a Cmd or a job record always says which
  code made it.
- **Why:** elm-watch reloads and "tells you why"; a silent swap that went wrong would look like a
  bug in the person's code.
- **Cost:** a title-bar slot, a few words, and `build` on every record.
- **How sure:** 65% on the look, which no screen has shown yet; 90% on the facts.

## The window

The window is a client, and a browser tab on Cloudflare has no dev server
([a browser is always a client](./a-browser-is-always-a-client.md)). So a window does not take
code from Vite. It hears the same `code.loaded` fact, imports that program's view by hash from the
brain, and swaps it in, Elm's way: the window machine's model stays if the new view's schema
decodes it. A mode in that model stays with its window, or goes to null with a line saying so
([M6 in modes](./modes.md#m6-a-mode-stays-where-it-lives)).

```ts
// A sketch. The window's own machine hears the fact through a Sub, like any other fact.
{type: "code_loaded", program: "counter", window: "a71c3e..."}
// fits     -> swap the view, keep the window model (an open note draft stays open)
// no fit   -> rebuild that one tile from the brain at its rev; nothing else reloads
```

- **Why:** the risk of a page reload is an unsaved draft, such as a note open under `e`. Vite's
  `accept` and `hot.data` do the same job in a dev server; we have the brain instead.
- **Cost:** the brain serves a program's window bundle by hash, and the window imports it. That
  import is a one-line platform edge ([no Promises](./no-promises.md)).
- **How sure:** 60%. No window was reloaded in experiment 183. A first build of the counter tile
  settles it.

## Where it is off

- **A cloud stage never watches files.** New code reaches it only by a deploy the owner said yes
  to, after `alchemy plan`. The swap is the same (H1). Since 2026-10-30, Cloudflare defers a
  Durable Object's code update for up to 300 s and keeps its storage and hibernated sockets
  ([changelog](https://developers.cloudflare.com/changelog/post/2026-10-30-durable-objects-deferred-code-updates/)),
  so a core deploy loses nothing either. 80%.
- **A live lane pins its own stage programs.** A lane's steps keep the build they started with,
  for the lane's life. Other programs, such as `trace`, still reload. Why: a lane's result must say
  which code judged it. `build` on every record (H6) is what makes this possible later. 70%: the
  doubt is a person who just fixed a stage and expects the lane to take it. Not in Tier 1, which
  has no lane in `next/`.

## Protocol first

Three facts, plus one field. Each entry also has the ledger's own `by`, `at` and `said`.

```ts
// A sketch. Effect Schema writes `_tag`. Tag spelling follows the ledger's own rule.
const From = Schema.Literals(["watch", "deploy", "boot", "restart"]);
const CodeLoaded = Schema.TaggedStruct("code.loaded", {program: Schema.String, hash: Hash, was: Schema.NullOr(Hash), from: From});
const CodeRefused = Schema.TaggedStruct("code.refused", {program: Schema.String, hash: Hash, was: Hash, why: Schema.String});
const CodeFailed = Schema.TaggedStruct("code.failed", {program: Schema.String, hash: Schema.NullOr(Hash), why: Schema.String});
// and on every record a process writes: build: Hash. A window's hello carries its own build.
```

A browser tab can do all of it: it reads facts, imports a file by URL, and has nothing to watch.

## What is lost if not recorded now

- **Which code made each record.** `build` on every step, Cmd and job record. Without it, no one
  can later say which version of a stage judged a pull request, or which code wrote a bad state.
  This is the one fact that cannot come back later.
- **Each load, refusal and failure, with who and why.** The `code.*` facts. They also give the
  order: every `build` has an earlier `code.loaded`.
- **The window's build,** in its hello, so a bug report from a tab names the code it ran.

Derived things, such as how long each version ran, rebuild from these.

## How it is tested

Laws on Node against the program runner ([an object class stays thin](./object-classes-stay-thin.md)),
with fixed seeds, as fast-check properties:

- No acked fact is lost by a reload, and they read back in order.
- Each Msg is stepped exactly once across a reload.
- A reload to the same hash changes nothing a reader can see.
- A fitting reload keeps the model equal. After it, the model equals a run of every Msg in order,
  each on the build its entry names (the law that catches 183's lost counter).
- A refused reload leaves that process on its old hash, with one `code.refused`, and others of
  the program unaffected.
- Code that failed to load never runs a step.
- Every `build` on a record has an earlier `code.loaded` for that hash.
- Only the saved program's processes swap.
- A pinned lane never changes build (when lanes exist).

## The proposals in one table

| Question | Lean | How sure |
|---|---|---|
| What swaps | only the saved program, at each process's next step | 85% |
| What is kept | the model, if the new schema decodes it, after an upcast | 85% |
| A new shape with no upcast | refuse for that process; it keeps the old code; a person restarts it | 85% |
| A bad save | never runs; a throwing step rolls back and the Msg runs once on the old code | 70% |
| The core, libfabrika | a workerd restart, lossless | 80% |
| A window | swap the view by hash from the brain; keep its model if it decodes, modes as in [M6](./modes.md#m6-a-mode-stays-where-it-lives) | 60% |
| Hands | a restart, with terminals in their own process | 60% |
| What a person sees | a quiet word and icon on the tile; a refusal stays with Restart | 65% |
| Where it is off | the cloud takes code by deploy only; a lane pins its stage programs | 70% |
| The fact to record now | `build` on every record, and the `code.*` facts | 90% |

## Where this differs from settled notes

- **[An old host is named, then restarted](./an-old-host-is-named-then-restarted.md)** has "decided
  for later: the host restarts itself onto the new build when no job runs". That is today's
  version. In `next/`, a program change restarts nothing, and a core change restarts workerd while
  jobs keep running in their hands. Its state check per job becomes a state check per process.
- **[Experiment 173](../../experiments/173-worker-loader.md)'s lean** is one isolate per version by
  content hash. This keeps it, and adds that memory per save is real, so local workerd restarts on
  its mark.
- **Tracker ticket 67** sketched today's host reloading programs in Node with a `?gen=N` stamp. `next/`
  loads by hash in the brain instead. Its rules all carry over.

## A tryout in today's version

Not built. Tracker ticket 67, "Programs update live while agents edit them (host reload)", filed
2026-10-28, open, is the ticket. Its first step is the counter: "Edit it, see the tile change,
count kept." What it would teach `next/`: whether people edit programs live often enough to see
the refusal path, and how the tile's mark reads. Its open doubt, the bare-import trick on Node 24
at 70%, does not apply to `next/`.

## What it costs

- In Tier 1, a guess: about 400 to 600 product lines and 300 to 500 test lines, 4 to 7 agent
  hours. The watcher and install in `dev.ts`, the swap and `was` in the core, the `code.*` facts,
  `build` on records, the window's view import by hash, the tile's mark, and the laws. Sure: 50%;
  a plan for it settles the number.
- An upcast to write when a shape changes.
- A planned workerd restart when saves pile up, which a person does not see.

## What it cannot tell us

- No window was reloaded, no hands ran, and no lane ran. Those leans rest on docs and reasoning.
- A pure step only. Cmds and Subs across a swap were not run.
- Local only. Cloudflare's eviction of loaded isolates is undocumented.
- Whether people want refusals to restart by themselves in dev.
- Whether pinning a lane surprises the person who just fixed a stage.
