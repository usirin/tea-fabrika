# 81. A packed program belongs to tea-program, and what a move to demlik still needs

Code and tests only: no agent, no GitHub, $0.

```ts
// Before: packing a program with its services lived in the shell.
import {listed} from "../tsh/programs.ts";          // src/agents/acp/program.ts needed tsh to pack itself
// After: it lives with the program. Any host packs and starts the same way.
import {listed} from "../program/listed.ts";
const entry = listed(count, Layer.effect(Base, ...));
yield* entry.start(flags, listeners, {id, storage});  // a host with no tsh code in it
```

## What was asked

One code change, run as an experiment: move `listed`, `Entry` and the
`Any*` types out of `src/tsh/programs.ts` into `src/program/`. Then test
whether it fits:

- (a) Does `Entry` cover what a Tuval program row needs to start a program?
  Which fields belong on the packed program, which are the host's alone?
- (b) Can a second host, not tsh, start, pipe and call a program through it?
- (c) Does anything get worse for tsh?

Everything else a move into kamp-us/demlik needs is a list below, not code.

## What moved

| What | From | To |
|---|---|---|
| `listed`, `Entry`, `AnyRunning`, `AnyStarted` | `src/tsh/programs.ts` | `src/program/listed.ts` (125 lines) |
| `programList`, `ProgramList`, `Programs`, `JobStorage`, `statusOf`, `statusOfJob` | stay in `src/tsh/programs.ts` (164 to 60 lines) | |

`programList` stays in tsh. It refuses a name that clashes with a tsh
built-in (`jobs`, `tell`) and a name a tsh line cannot hold. Those are shell
rules. The only plain part is "two programs with one name", and a by-name
map is one line of any host's code, so it did not earn its own export.

Eleven importers changed their import line and nothing else. One of them is
the ACP program (`src/agents/acp/program.ts`): before, a fabrika program had
to import the shell to pack itself. Now it does not.

## (b) A second host

`src/program/listed.test.ts` is a host with no tsh code. It keeps two packed
programs by name, the way a desktop keeps program rows: `count` (needs a
`Base` service) and `label` (needs a `Prefix` service). It passes raw flags,
as a config file or a click would.

- `count --n 5 | label`, three runs in a row: each heard `#10 .. #14`, and
  each run built its own services (3 and 3).
- `call` on `label` with four values told: four answers, in order.
- Raw flags that do not fit (`n: "five"`): `start` answers `bad_shape` and
  `main` never runs. `Entry` casts the flags, but `start` checks them again.
  So the cast is not a hole.
- A pipe whose sides do not fit: `does_not_fit`, before the source starts.

**A hole it found, now fixed.** A host whose own boot is a Layer, starting a
run while that Layer is built. Effect's `Layer.build` forks the memo map the
fiber carries. So the run was handed the service the boot had already made,
not a fresh one. Red before the fix: `expected 1 to be 2` (one build, where
the boot and the run should each make one). Fixed in `listed`: each run
builds its services in a memo map of its own. Tuval hit the same class of bug
in its kernel (a child got its spawner's built agent through the memo map),
and fixed it there by dropping the memo map from the context it seals. tsh
never starts a run inside a Layer build, so tsh sees no change.

**A cost, not fixed.** On refused flags, the services were still built once
and let go. `listed` builds them before `start` checks. For a service that
opens a connection, that is wasted work. The fix is to call `readFlags` first
in `listed`. Left out to keep this change to the move.

## (a) Tuval's program row against `Entry`

Read from `packages/tuval/src/registry/program.ts`,
`packages/tuval/src/authoring/args.ts`,
`packages/tuval/src/authoring/define-program.ts` and
`packages/tuval/src/process/Processes.ts` in kamp-us/phoenix.

The center matches. A Tuval arg **is** a service on the program's `R`: the
config builds one Layer for a row's args, and the row's handlers read them
through `R`. That is what `listed(program, Layer)` does.

| Tuval row field | Where it belongs | In tea-program today |
|---|---|---|
| `core`, `handlers`, `subs` | the program | `main` and `machines` |
| `ports` (kind, check, schema) | the program | `inputs` / `outputs` shapes |
| `ports[].bound` (capacity, overflow) | the program | one `CAPACITY` (1000) for every input; no overflow choice |
| `receive` | the program | not needed: `main` reads typed input streams |
| `resume` | the program | kept machines start again under their id |
| `derivedLines` (title, status) | the program | `status` per machine kind; no title |
| `restorable`, `migrations` | the program's kept state | not there: storage reads raw, no versioned steps |
| `checkpointWorthy` | the program's kept state | not there: every state is saved |
| `args` | **the packed program** | the Layer handed to `listed` |
| `capabilities` (data only) | the packed program, as data | not there |
| `configChanged` | host, with a program message | not there |
| `spells` | host | tsh's built-ins are the nearest thing |
| `takesKeys`, `folderAtStart`, `renderer`, `inspector`, `status` | host | none |
| `sdk`, `needsFeatures`, `authoredCode` | host | none |
| `id`, `label`, `identity`, `placement` | host registry | `name`, `description` only |

**Where `Entry` does not fit Tuval yet.** `listed` takes `Layer<R>`: every
service must come from the pack. A Tuval handler also reads services the
kernel gives (process table, checkpoints, feature flags). Those come from
the host, not the row. So `Entry` needs a host part:
`listed(program, Layer<R without H, never, H>)` giving an `Entry<H>`, whose
`start` asks the host for `H`. tsh would use `Entry<never>`, as today.

**Also missing for Tuval.** `Entry.start` always takes `{id, storage}`, even
for a program with no machines. That is fine for tsh. Tuval decides keeping
per row (`checkpointWorthy`), so it may want the program's own rule
(`KeepingOf`) carried through `Entry`.

## (c) Is anything worse for tsh?

No. tsh imports `Entry` from one folder down instead of its own. tsh's tests
did not change (1591 before, 1595 after: the four new ones are the second
host). One more memo map per run: no time measured, since it is one object.

One naming clash to note: `program.ts` already has `Listed` and `listing`
(what `--describe` prints). `listed` (pack with services) reads too close.
`packed` would say what it does.

## What has to happen before a move

Read only. Ordered by what blocks most.

**1. tsh's side imports fabrika: 42 sites.** Checked with
`@demlik/code-graph --layers` (below), which finds 44 in all: these 42 and
the 2 in 2. Grouped:

| Where | What it imports | Smallest fix | Size |
|---|---|---|---|
| `src/tsh/fabrika.ts:3-22` | code-host-github, sandbox, services, 12 stage files | Move the file out of `src/tsh/` to a fabrika-side folder | S: a move, 185 lines |
| `src/tsh/scripted-build.ts:5-9` | sandbox, 4 build stage files | Same move | S: 76 lines |
| `src/tsh/launch.ts:2` | `agents/acp/program.ts` (and `./fabrika.ts`) | `programsOf` and the `TSH_OWN` / `TSH_CLONE` / `TSH_WORK` / `TSH_SCRIPTED` settings move out with fabrika.ts. tsh keeps `sourceOf`, `homeOf`, `showOf`, `USAGE` | S |
| `src/tsh/main.ts:14` (via launch) | the fabrika list | `main.ts` becomes `runTsh(list, ...)`; the bin moves to the fabrika side and calls it. `bin/tsh` and `pnpm tsh` point at the new file | M: the terminal code stays, its top level becomes a function |
| `src/tsh/title.ts:1` | `stages/traced.ts` (`refOf`) | `refOf` is 4 lines, but it knows GitHub urls. Moving it down into tsh works; cleaner is that whoever starts tsh hands it how a value is shortened in a title, so the shell does not know GitHub | S |
| `src/trace/view.ts:11` | `stages/outcome.ts` (`wentWrong`) | `view` takes `wentWrong` as an argument; `tracing` / `memoryTracing` take it too | S, but every `memoryTracing` caller in stages and agents tests passes it |
| `src/trace/view.ts:12` | `trace/agent.ts` (`KEPT_OUT`) | Pass the kept-out marker in with `wentWrong`, or move the constant into view | S |
| `src/tsh/shell.test.ts`, `status.test.ts`, `trace.test.ts` (16 sites) | recorded GitHub, `CodeHost`, ship facts, `listen` | Split: the review-and-ship tests move to the fabrika side; the rest stay | M: shell.test.ts is 409 lines, about 100 use fabrika |
| `src/tsh/kill.test.ts:7`, `status-attach.test.ts:7` | `SANDBOX_URL`, and they run the bin with `TSH_SCRIPTED` | Move with the bin | S |
| `src/tsh/check.test.ts`, `complete.test.ts` | `programsOf` (ship, review, build) | Keep the shell tests on `SMALL`; move the sandbox and review cases | M |
| `src/tsh/pty.test.ts` | runs `bin/tsh` (no import) | Moves with the bin, or a tsh-only bin with `SMALL` | S |

`src/trace/otel.ts` and `src/trace/view.ts` count as tsh's side. They sit in
`src/trace/` next to `agent.ts` and `sdk-events.ts`, which are fabrika's.
Moving the two under `src/tsh/` makes the folder the package.

**2. tea-program imports fabrika: 2 sites.**

| Where | What | Smallest fix | Size |
|---|---|---|---|
| `src/program/shape.ts:3` | `src/schema.ts` (`jsonSchema`) | Copy the Effect branch (5 lines) into `shape.ts` | S |
| `src/program/kept.test.ts:6` | `src/primitives.ts` (`act`, `intentOf`, `listen`) | Use `@demlik/tea`'s own Sub factories, or a local helper | S |

**3. zod.** `src/schema.ts` and `src/primitives.ts` import zod. tea-program
reaches it only through `shape.ts:3` (fix 2). tsh's side has no zod import.
After fix 2, neither package needs zod.

**4. Effect version.** Here: `effect` 4.0.0 and `@effect/*` 4.0.0. demlik's
catalog: `effect` 4.0.0-rc.117 (tea's published peer range is
`^4.0.0-rc.0`, which takes both). Code written against 4.0.0 may use what
rc.117 does not have. Either demlik moves to 4.0.0 first, or the two
packages are typechecked against rc.117 before the move. This blocks the
move itself, not the cuts. Size unknown until tried: 60% it is small.

**5. Build and import style.** Here: `NodeNext`, `.ts` import specifiers,
`allowImportingTsExtensions`, `exactOptionalPropertyTypes`, run as `.ts`
by Node. demlik: `Bundler` resolution, imports with no extension, built
with tsup to `dist/`. Every relative import changes (215 lines across both
folders, mechanical). `exactOptionalPropertyTypes` is stricter here, so the code
should compile under demlik's settings.

**6. Lint.** Here: biome 2.4 plus nine custom rules (`biome-plugins/*.grit`:
no type assertions, no raw try/catch, no numeric durations, ...). demlik:
biome 2.3. The code was written under those rules; demlik would need them
too, or lose them.

**7. tea's `./otel` is `experimental`.** `src/program/trace.ts` imports
`runTraceId` from `@demlik/tea/otel`. A stable package resting on an
experimental subpath is a tier mismatch in demlik's own `MAINTAINING.md`.
Not a blocker: we are its user and can graduate it.

**8. The Node edges.** tea-program: `program.ts` (`node:crypto` randomUUID)
and `storage-node.ts` (`@effect/platform-node` file system). tsh: `main.ts`
(readline, raw keys, the lock file). Each wants its own subpath so a browser
host can import the rest.

### Would-be packages

**tea-program**, from `src/program/`. 3204 lines of code, 2895 of tests.

| Subpath | From | Main names |
|---|---|---|
| `.` | `program.ts`, `shape.ts` | `defineProgram`, `kind`, `start`, `pipe`, `call`, `tell`, `offer`, `readFlags`, `listing`, `CAPACITY`, `flag`, `input`, `output`, `fit`, `shapeOf`; types `Program`, `Running`, `Started`, `Ended`, `Kept`, `Listeners`, `Shape` |
| `./listed` | `listed.ts` | `listed`, `Entry`, `AnyRunning`, `AnyStarted` |
| `./storage` | `storage.ts`, `mortal.ts` | `memoryStorage`, `folderStorage`, `storageOf`, `Storage`, `RunRecord`, `mortalDisk` |
| `./storage/node` | `storage-node.ts` | `fileStorage` |
| `./trace` | `trace.ts` | `runTraced`, `traceOf`, `ATTR`, `SERVICE_NAME` |
| `./testing` | `ear.ts` | `ear` |
| (inside) | `kept.ts`, `outbox.ts`, `refs.ts` | not exported |

Outside dependencies: `effect` 4.0.0 (with `effect/persistence`),
`@demlik/tea` 0.20.0 (`.`, `./effect`, `./otel`), `@effect/platform-node`
4.0.0 (only `./storage/node`).

**tsh**, from `src/tsh/` plus `src/trace/otel.ts` and `src/trace/view.ts`,
without `fabrika.ts` and `scripted-build.ts`. 3754 lines of code, 2101 of
tests (some move to the fabrika side, see 1).

| Subpath | From | Main names |
|---|---|---|
| `.` | `shell.ts`, `programs.ts`, `small.ts` | `tsh`, `programList`, `ProgramList`, `Programs`, `JobStorage`, `statusOf`, `SMALL` and the small programs |
| `./terminal` | `main.ts` (as a function), `launch.ts`, `search.ts`, `complete.ts` | `runTsh`, `sourceOf`, `homeOf`, `complete` |
| `./trace` | `otel.ts`, `view.ts` | `tracing`, `memoryTracing`, `endpointOf`, `view` |
| (inside) | `grammar.ts`, `words.ts`, `check.ts`, `execute.ts`, `jobs.ts`, `builtins.ts`, `copies.ts`, `decode.ts`, `short.ts`, `title.ts`, `did-you-mean.ts` | not exported |
| `bin` | a `tsh` with `SMALL` only | the fabrika `tsh` stays in this repo |

Outside dependencies: tea-program, `effect` 4.0.0, `@demlik/tea` 0.20.0
(`.`, `./effect`), `@effect/opentelemetry` 4.0.0, `@opentelemetry/api`
1.9.1, `@opentelemetry/resources` 2.11.0, `@opentelemetry/sdk-trace-base`
2.11.0, `@opentelemetry/exporter-trace-otlp-http` 0.222.0. The OTel ones
only for `./trace`.

### Can `@demlik/code-graph` hold the line later?

Yes, as it is. Not wired. Its `--layers` gate takes an ordered stack and
fails on any import that points up. Tried from a rules file outside the
repo, against this branch:

```json
{"layers": [
  {"name": "fabrika", "paths": ["src"]},
  {"name": "tsh", "paths": ["src/tsh", "src/trace/otel.ts", "src/trace/view.ts"]},
  {"name": "program", "paths": ["src/program"]}
]}
```

```
layers: fabrika > tsh > program
scanned 342 files: 104 down, 834 sideways, 44 UP, 288 unlayered, 843 external, 0 unresolved
LAYER GATE FAILED.
```

(Its own output puts a dash after "files"; shown here with a colon.)

Exit 1, under one second, with every site as `file:line`. It found
`view.ts:12` (the `KEPT_OUT` import), which a read by hand missed. The more
specific path wins, so `src/tsh` sits inside `src` without a clash. Its
`allowed` list takes a count per site, so the 44 can be listed now and the
list can only shrink: wiring it into `pnpm lint` today would hold the line
while the cuts land. The installed version (0.6.0) already has it.

## Findings

1. A packed program is a program concern. A host with no tsh code starts,
   pipes and calls through `Entry` (4 tests).
2. `listed` handed a run its host's service when started inside the host's
   Layer build. Fixed: a memo map per run. Red before, green after.
3. `listed` builds services for a start it then refuses. Not fixed.
4. Tuval's args are the same idea as `listed`'s Layer. Tuval also needs
   services from the host, which `Entry` cannot take yet.
5. Most Tuval row fields are host-only. The program-side gaps are keeping
   rules (migrations, checkpoint-worthy) and per-input bounds.
6. 44 wrong-way imports stand between the two folders and a move: 42 on
   tsh's side, 2 in tea-program. code-graph's layer gate lists them all.
7. demlik runs `effect` 4.0.0-rc.117; this repo runs 4.0.0.

## Recommendations

- **Keep the move** of `listed` into tea-program. 90%. It removes a
  fabrika-to-shell import and a second host works with it. The cost is one
  more file in tea-program.
- **Wire code-graph's layer gate into `pnpm lint` now, with the 44 sites in
  `allowed`.** 85%. It makes a new wrong-way import fail at once, and the list
  can only shrink as the cuts land. The cost is one rules file to keep in
  step with folder moves. What would lift it: a run in CI to check the time.
- **Do the cuts in this order:** the tea-program sites (2, small), then
  `title.ts` and `view.ts` (small, in place), then move `fabrika.ts`,
  `scripted-build.ts`, `programsOf` and the bin out of `src/tsh/`, then
  split the tests. 75%. Doubt: the test split is the largest part, and
  where `shell.test.ts` cuts is a judgment call.
- **Add a host part to `Entry` (`Entry<H>`)** before Tuval uses it. 65%.
  Doubt: Tuval may keep its own row and only borrow the idea. What would
  lift it: one Tuval row started through `Entry<H>` in a spike.
- **Check `readFlags` before building services in `listed`.** 70%. Small
  and right, but no host has paid for it yet.
- **Rename `listed` to `packed`.** 55%. Clearer next to `Listed` and
  `listing`, but it touches every importer again.

## Holes

- The second host is a test, not a real desktop. It proves the shape, not
  Tuval's kernel.
- The Effect version gap (4) was not tried. Its size is a guess.
- The tsh test split (1) was sized by reading, not by doing it.

## Not done

By scope: no cut of tsh's imports, no move of fabrika wiring, no change to
`shape.ts`, no boundary check wired, no per-folder typecheck.
