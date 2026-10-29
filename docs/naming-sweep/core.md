# Naming sweep: fabrika's core

**Proposed.** Part of [the naming sweep](./README.md), which holds the status,
the marks, every pick and the open list. This file holds the rows for
`packages/fabrika`: program, shell (tsh), host and ledger, agents, sandbox,
mcp. 325 rows, one `##` per module. A row a 2026-10-28 pick covers is marked
**picked 2026-10-28** and keeps the mark it had before the pick.

- `packages/tea-program`, `packages/tea-host` and `packages/tsh` hold no
  tracked file, only an old `node_modules`. Their code moved into
  `packages/fabrika/src/{program,host,shell}` in experiment 103. They get no
  rows.
- The desk layout (container, orientation, fold) is in the app, not here: see
  [app.md](./app.md).

## The ten worst

1. **run** means three things: a program's live instance (`Run`,
   `RunRecord`, `ps`'s RUN), one copy of a machine kind (`Ref`: "one run of
   one kind"), and a ledger name's incarnation (`ProcessInfo`, "the run's
   number, OTP's pid"). The 2026-10-28 pick (run -> process, run id -> pid)
   lands on the first; the other two still need their own word.
2. **pid**, picked 2026-10-28: a process's id is a pid. It already meant an OS
   process id in `agents/agent/turn.ts` (`Running.pid: number`, the
   `Reaper`); that one becomes `osPid` (picked). The ledger calls OTP's pid an
   `incarnation`.
3. **`Usage`** is three exports: the ledger's spend and limits of a name
   (`host/rules.ts`), ACP's token counts (`agents/acp/transcript.ts`), and the
   agent run cost picked on 2026-10-24 (still `Spend` in
   `agents/claude/draft.ts`).
4. **`Ended`** is four exports: a program run's end (`program/program.ts`), a
   supervisor child's exit (`host/supervisor.ts`), a turn's end
   (`agents/agent/turn.ts`), ACP's turn end (`agents/acp/transcript.ts`).
5. **`Agent`** is both the top-level namespace (`index.ts`,
   `agents/agent.ts`) and `host/writer.ts`'s writer schema. `export *` lets
   the namespace win silently, so the writer's `Agent` cannot be reached from
   `@kampus/fabrika`.
6. **`Limits`** is two exports with different keys: the ledger's `{usd,
   tokens, wallMs, children}` and a turn's `{usd, tools, seconds}`. Time is
   `wallMs` in one, `seconds` in the other.
7. **user vs person**: the door's `Stamp.kind: "user"` and `writer.ts`'s
   `User`, but `Person`, `PERSON_KINDS`, `isPersonId`, `DoorConfig.person`,
   `LocalOptions.person`, the mcp `person`. One idea, two words.
8. **`Stop` and `stop`**: a turn's stop reason (two copies, `turn.ts` and
   `acp/transcript.ts`, with different values), the supervisor's `Stop`
   command, `Running.stop`, the tsh `stop` builtin, and `Lease.stop`.
9. **The tag key** in this package alone: `kind`, `_tag`, `type`, `phase`,
   `how`, `ev`, `is`, `do`, `op`, `ok`/`why`. Still open (tracker #32).
10. **`window`**: a program's UI window (`viewOf`, `WindowProps`) and the
    outbox's send window (`program/outbox.ts`, `WINDOW = 5`).

Close behind: `Answer` exported three times; `Line`/`lineOf` twice each;
`rawOf`/`Raw` in the ledger and in agents; three `Env` types; `wire` still
meaning network transport in the ledger after wire -> pipe; `no_cell` for "no
such input"; agent, harness, maker, provider and adapter for nearby ideas.

## program/program.ts, shape.ts, listed.ts

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| program / `Program` / `defineProgram` | a thing you start: name, description, flags, inputs, outputs, `main` | a program, as a Unix command ([POSIX, shell grammar](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html)) | ok | |
| `Program.name` / `.description` | its name, and one sentence for people | name, description ([MCP, tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) uses both) | ok | |
| `Program.main` | the program itself | `main` | ok | |
| `Program.machines` / `Kinds` | each machine it runs, by name, one kind each | entity types ([Akka, cluster sharding](https://doc.akka.io/libraries/akka-core/current/typed/cluster-sharding.html)) | ok | |
| `flags` / `Flags` / `flag` / `Flag` | values given once at start, like argv | options and arguments ([POSIX, utility conventions](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap12.html)); Elm says flags ([Elm guide, flags](https://guide.elm-lang.org/interop/flags.html)) | ok | |
| `Flag.default` / `defaulted` / `withDefaults` | a flag's value when it is not given | default | ok | |
| `inputs` / `Inputs` / `input` / `Input` | values told at any time, like stdin | stdin; Elm's incoming port ([Elm guide, ports](https://guide.elm-lang.org/interop/ports.html)) | ok | |
| `outputs` / `Outputs` / `output` / `Output` | values sent one way; nothing kept | Elm's outgoing port (same source) | ok | |
| `Declared` / `.direction: flag, input, output` | one declared part of a program | none needed | ok | |
| `Shape` / `shapeOf` / `ShapeSchema` / `StandardShape` | a schema wrapped with `check`, `problem`, `json` | schema ([Standard Schema](https://standardschema.dev/)) | differs | keep: "shape" is glossed in every README and a `Shape` is more than a schema. 60%: a reader looks for "schema" first; settle with the glossary pass |
| `Shape.check` | true when a value fits | validate ([Standard Schema](https://standardschema.dev/)) | two-ideas | `is`: "check" is also the pipeline's move. 55% |
| `Shape.problem` | why a value does not fit | issues (Standard Schema's `issues`) | ok | |
| `JsonSchema` / `jsonSchemaOf` | a shape's JSON Schema | JSON Schema ([json-schema.org](https://json-schema.org/)) | ok | |
| `fit` / `Fit: fits, does_not_fit, cannot_tell` | does an output's schema match an input's | assignability ([TypeScript, type compatibility](https://www.typescriptlang.org/docs/handbook/type-compatibility.html)) | differs | keep `fit`: it is exact equality, not assignability, so "assignable" would mislead. 70% |
| `DoesNotFit` (`kind: "does_not_fit"`) | `pipe` refused by the fit check | none needed | ok | |
| `Ack: auto, manual` / `Input.ack` | when a told value counts as taken | automatic and manual acknowledgement ([RabbitMQ, confirms](https://www.rabbitmq.com/docs/confirms)) | ok | |
| `capacity` / `CAPACITY` / `capacityOf` | how many unread values an input holds | mailbox capacity ([Akka, mailboxes](https://doc.akka.io/libraries/akka-core/current/typed/mailboxes.html)) | ok | |
| `PayloadOf` | the value type a declaration carries | payload | ok | |
| `Given` | one typed value per declaration | none needed | ok | |
| `Kind` / `kind` / `AnyKind` | a machine a program declares once: machine, state schema, parent, options, status | entity type (Akka `EntityTypeKey`, same source); Durable Object namespace ([Durable Objects](https://developers.cloudflare.com/durable-objects/)) | two-ideas | still open (#32, `kind`): `kind` is also every outcome's tag and the ledger row's event type. Not picked |
| `Kind.state` | the state's Effect Schema | schema | ok | |
| `Kind.parent` | `"main"` or another kind that starts it | parent, as in a supervision tree ([Erlang, supervisor](https://www.erlang.org/doc/system/sup_princ.html)) | ok | |
| `Kind.recovered` | the Msg that goes first after a restart | recovery; tea's init on load | ok | |
| `Kind.drawing` / `Drawing` | how its trace draws one run | none standard | ok | |
| `Kind.status` / `Listing.status` | a status line per copy, `state => string` | Elm's `title` ([Elm guide](https://guide.elm-lang.org/)); a status line | ok | |
| `Ref` / `Refs` / `RefsOf` | one copy of a kind by id; getting it does nothing | an entity ref ([Akka, cluster sharding](https://doc.akka.io/libraries/akka-core/current/typed/cluster-sharding.html)); a Durable Object stub | ok | |
| "run" of a kind (`Ref` doc, `KeptRun`, `Drawn`, "machine run") | one kept copy of one machine kind | instance or entity (same Akka source) | two-ideas | `instance`; the program's own word "copy" (`Copy`, `copies()`) is the second word for it today. Pick one: `copy` (already in the API) 55%, `instance` 45%. Settle by how often each is read in apps |
| `Copy` / `.id`, `.line`, `.live` / `copies()` / `lines` | one copy of a machine, with its status line | instance (same source) | two-words | see the row above |
| `Ref.start` / `.read` / `.clear` | start the copy, read its kept state, drop it | none needed | ok | |
| `Conflict: fail, use_existing` | what a start does on a live copy started with another Msg | `WorkflowIdConflictPolicy` Fail, Use Existing ([Temporal, workflow id and run id](https://docs.temporal.io/workflow-execution/workflowid-runid)) | ok | |
| `AlreadyStarted` | that conflict, failed | "Workflow execution already started" (same source) | ok | |
| `Kit` / `Io` | what a kind's options and `main` are handed | none needed | ok | |
| `Io.watch` / `Watch` / `Watchable` | show a machine kept elsewhere on the handle | none needed | two-ideas | `Watch` is also the monitor's schema (`host/monitor.ts:49`) and `Ledger.watch`. `show`. 55% |
| `Send` / `send` | send on an output | send | ok | |
| `Run` / `AnyRun` / `RunOf` / `Run.id` | a running program, with a stable id | a process ([bash, job control](https://www.gnu.org/software/bash/manual/html_node/Job-Control-Basics.html)); a workflow execution with a run id ([Temporal](https://docs.temporal.io/workflow-execution/workflowid-runid)) | two-ideas | **picked 2026-10-28:** run -> process, run id -> pid. The other two meanings of "run" (a kind's copy, a ledger incarnation) are not covered by the pick |
| `Run.machines` / `MachineView` (`state`, `changes`, `copies`, `lines`) | each machine of a run, as a host sees it | none needed | ok | |
| `InputQueue` / `.length`, `.waiting` | an input's line now | queue depth | ok | |
| `Running` / `RunningOf` (`kind: "running"`, `run`, `close`, `stop`) | what the starter holds | none needed | two-ideas | `agents/agent/turn.ts` exports another `Running` (a started turn). Follows the process pick: `Started` or `Spawned`. 50% |
| `Started` / `AnyStarted` | what `start` answers | none needed | collides | the ledger exports `Started` too (`host/ledger.ts:152`); `index.ts` picks the program's by hand |
| `start` / `begin` | start a program, answer at once | spawn ([Erlang, processes](https://www.erlang.org/doc/system/ref_man_processes.html)) | ok | |
| `Startable` | a program with its flags and listeners, ready to start | none needed | ok | |
| `tell` | hand a value to an input; never waits | `cast` in gen_server ([Erlang, gen_server](https://www.erlang.org/doc/apps/stdlib/gen_server.html)); Akka's `tell` | ok | the host's `cast` is the same idea (two-words across host and program; low cost) |
| `offer` | hand a value, waiting for room | `Queue.offer` (Effect) | ok | |
| `Full` / `.input`, `.capacity` | a full line | mailbox full | ok | |
| `Word: queued, closed, stopped, bad_shape, no_cell` | what `tell` answers | none needed | differs | `no_cell` means "no input of that name"; "cell" is tea's Cmd handler (`program/trace.ts:135`). `no_input`. 85% |
| `BadShape` (`kind: "bad_shape"`, `name`, `why`) | a value that does not fit | validation error | ok | |
| `readFlags` (`kind: "given"`) | check flags before `main` | none needed | ok | |
| `close` / `Close` | close one input, like stdin's end | EOF | ok | |
| `stop` | stop the run and wait | kill, terminate | two-ideas | also a turn's stop reason, the supervisor's `Stop`, `Lease.stop`. Keep here: it is the shell's word. 60% |
| `Ended: ended, stopped, failed` / `.unread`, `.cause` | how a run ended | exit status ([bash, exit status](https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html)) | two-ideas | four exports of `Ended` in this package. This one: `Exit` would match Effect's `Exit`, which collides. Lean `RunEnd`, or `ProcessEnd` after the pick. 55% |
| `Unread` | values never read when the run ended | Akka's dead letters count ([Akka, mailboxes](https://doc.akka.io/libraries/akka-core/current/typed/mailboxes.html)) | ok | |
| `Listeners` / `ListenersOf` | one listener per output, in place before `main` | subscribers | ok | |
| `Kept` / `.id`, `.storage` / `KeepingOf` / `keeping` | a run's id and storage, kept across restarts | durable, persisted | two-ideas | the sweep's `kept` row (section 9, `program/kept.ts`). `Keeping`. 55% |
| `Delivery` / `.value`, `.ack` / `StreamOf` | one value of a manual input, with its ack | delivery, ack ([RabbitMQ, confirms](https://www.rabbitmq.com/docs/confirms)) | ok | |
| `pipe` | `from \| to`: start `from` with an output into `to`'s input | a pipeline ([bash, pipelines](https://www.gnu.org/software/bash/manual/html_node/Pipelines.html)) | ok | |
| `Wire` (internal) / `wire` | one output joined to another run's input | pipe (same source) | two-words | **picked 2026-10-28:** wire -> pipe |
| `Into` | the inputs that take a given type | none needed | ok | |
| `call` / `Called` (`kind: "called"`, `ended`, `heard`) / `CallOptions` (`told`, `listeners`, `stopOn`, `keeping`) | start, tell, close, wait for the end, keep every value | run to completion | two-ideas | `call` is also the `Call` module (gen_server:call) and mcp's `Call`. Keep: tests read it most. 55% |
| `Heard` / `Told` | a sent value as heard; values to tell | none needed | two-ideas | `agents/agent/turn.ts` and `agents/acp/client.ts` export other `Heard`s |
| `Listing` / `Listed` / `listing` | a program's man page: flags, inputs, outputs, machines | man page; MCP's tool listing | two-ideas | `Listed` is also storage's kept-run list (`program/storage.ts:176`) and `listed()` packs an entry. `Part` for this one. 60% |
| `View` / `AnyView` / `viewOf` / `ViewOf` / `Viewed` (`machine`, `data`, `of`) | a pure view of one machine, for a window | Elm's `view` ([Elm guide](https://guide.elm-lang.org/architecture/)) | ok | |
| `Definition` / `Parented` | what `defineProgram` takes | none needed | ok | |
| `Entry` / `listed` | a program packed with its services | a registry entry | two-ideas | the asks ledger exports `Entry` too (sweep section 9). `Listed` is taken; `Packed`. 50% |

## program/storage.ts, kept.ts, refs.ts, outbox.ts, trace.ts, view.ts, ear.ts, mortal.ts

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| `Storage` / `storageOf` / `memoryStorage` / `folderStorage` / `fileStorage` | where runs keep what outlives the process | storage over a key-value store (Effect `KeyValueStore`) | ok | |
| `Handle` / `.run`, `.found` | one open of one run; the only way to write | a file handle | ok | `run` follows the pick |
| `RunRecord` / `.run`, `.flags`, `.closed`, `.machines`, `.deadLetters` | one run's record | process record | two-ideas | **picked 2026-10-28:** follows run -> process |
| `RunStatus: running, ended, stopped, failed` | how a run last ended | process state ([POSIX, ps](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/ps.html)) | ok | follows the pick for its name |
| `Unacked` / `.output`, `.n`, `.value` | a value sent down a pipe, not yet acked | unacked message ([RabbitMQ, confirms](https://www.rabbitmq.com/docs/confirms)) | ok | |
| `DeadLetter` (storage) / `.why` | a value a receiver no longer took | dead letter ([SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)) | collides | the ledger's `DeadLetter` (`host/ledger.ts:279`) has other keys and wins on the top level. Storage's: `PipeDeadLetter`. 65% |
| `Stale` (storage) / `StorageStale` | a newer open holds the run | stale handle; fencing ([Kleppmann](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)) | collides | the ledger's `Stale` means a wrong expected rev. Two tags "Stale", two meanings. Storage's: `Superseded`. 60% |
| `StorageBroken` / `StorageFailed` | storage could not be read or written | I/O error | ok | |
| `StateRefused` / `StateSchema` | a kept state its schema does not take | schema migration failure | ok | |
| `Listed<S>` (`kind: kept, refused`) | one kept copy, or why it was refused | none needed | two-ideas | see `Listing` / `Listed` |
| `opened` / `name` (storage `Kept`) | how many opens, and the newest's random name | fencing token | ok | |
| `Slot` / `.opened`, `.count`, `.sum`, `.body` | one slot's value and torn-write check | checksum | ok | |
| `runKept` / `KeptOptions` / `KeptRuntime` / `KeptFailed` / `First` | start one kept copy of a machine | durable actor | two-ideas | the sweep's `kept` row; not picked |
| `refsOf` / `lineOf` (refs.ts) | a kind's refs; a status line or why none | none needed | collides | `host/move.ts:136` exports another `lineOf` (a ledger row as one text line). Refs': `statusLineOf`. 75% |
| `Outbox` / `outboxOf` / `.send`, `.resend`, `.drained` | the never-lost send behind a manual pipe | transactional outbox ([microservices.io](https://microservices.io/patterns/data/transactional-outbox.html)) | ok | |
| `WINDOW` | values one pipe may have sent and not acked | in-flight cap, `max.in.flight.requests.per.connection` ([Kafka, producer configs](https://kafka.apache.org/documentation/#producerconfigs)); TCP's send window | two-ideas | "window" is also a program's UI window. `IN_FLIGHT`. 80% |
| `Wiring` / `.handle`, `.program`, `.output`, `.problem`, `.hand`, `.gone`, `.broken`, `.mark` | what an outbox is made from | none needed | two-words | **picked 2026-10-28:** follows wire -> pipe (`PipeEnds` or similar; the name is not picked) |
| `ATTR.program`, `.machine`, `.msg`, `.cmd`, `.sub`, `.input`, `.output` (`tea.*.name`) | span attributes | OpenTelemetry attribute naming ([OTel, naming](https://opentelemetry.io/docs/specs/semconv/general/naming/)) | ok | |
| `ATTR.run` = `tea.run.id` | the run on a span | `process.pid` ([OTel, process](https://opentelemetry.io/docs/specs/semconv/resource/process/)) | differs | **picked 2026-10-28:** follows run id -> pid. Do not write `process.pid`: OTel's is an OS integer and a tsh id is text. `tea.process.id`. 70% |
| `ATTR.pipeOutput` / `.pipeInput` | a pipe's ends on a span | none needed | ok | |
| `ATTR.costUsd` = `tea.cost.usd` | dollars on a span | `gen_ai.usage.*` tokens ([OTel, gen AI](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/)) | two-words | the money word is open (#32). Not picked |
| `ATTR.ticket`, `.round`, `.pr`, `.head`, `.outcome`, `.problems` | pipeline facts on a span, in fabrika | none needed | ok | they name pipeline ideas from the bottom layer; a layer smell, not a naming one |
| `ATTR.status` | a copy's status line | none needed | ok | |
| `SERVICE_NAME` / `currentService` | OTel's `service.name` | `service.name` (OTel) | ok | |
| `runTraced` / `traceOf` / `traceParentIdOf` / `Tags` / `nowNanos` | spans in Effect's terms | spans, trace context ([W3C](https://www.w3.org/TR/trace-context/)) | ok | |
| `runTraceId` / `sha256Hex` | a trace id from a run id | trace id | ok | follows the pick for `run` |
| "cell" (`trace.ts`, `CellErrors`) | tea's Cmd handler in an `interpret` map | handler | differs | `handler`; tea's own word decides. 50% (it is tea's term, outside this package) |
| `readInput` / `ReadInput` / `InputMsg` / `InputMsgOf` / `ViewDataOf` / `WindowProps` | a window's side of a program | Elm's `view` and `Msg` | ok | |
| `ear` / `.hear`, `.upTo`, `.values` | a test listener | test spy or probe ([Akka, TestProbe](https://doc.akka.io/libraries/akka-core/current/typed/testing-async.html)) | differs | `probe`, Akka's word. 60% |
| `mortalDisk` / `Life` / `BeforeWrite` | a disk for tests that kill mid-write | fault injection | ok | |

## shell (tsh)

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| `tsh` | the shell, a program itself | a shell ([POSIX, shell](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html)) | ok | |
| job / `Job` / `.n` (`%n`) | one typed line, run as a group | job, job number, jobspec `%n` ([bash, job control](https://www.gnu.org/software/bash/manual/html_node/Job-Control-Basics.html)) | ok | **picked 2026-10-28:** job stays |
| `Job.text` / `.state` / `.background` | the line, running or detached, started with `&` | bash's `jobs` shows the same | ok | |
| `JobState: running, detached` | started by this tsh, or by an earlier one | bash's Running, Stopped; tmux's attached, detached ([tmux manual](https://man7.org/linux/man-pages/man1/tmux.1.html)) | ok | |
| `StageRecord` / `Job.stages` | one program of a job | a process of the job (same bash page) | two-words | **picked 2026-10-28:** stage is dropped; a job lists its processes |
| `StageRecord.run` | its run id | process id (same bash page) | two-words | **picked 2026-10-28:** run id -> pid |
| `StageRecord.wire` | into the next one: output and input | pipe | two-words | **picked 2026-10-28:** wire -> pipe |
| `StageRecord.program` / `.flags` / `.ended` | its program, flags, whether it ended | command, args, state (`ps`) | ok | |
| `Jobs` / `jobsMachine` / `EMPTY` / `TABLE` | the job table | job table (same bash page) | ok | |
| `JobsMsg: began, stage_ended, detached, attached, foreground, dropped` | the table's Msgs | bash: `fg`, `disown` ([bash, job builtins](https://www.gnu.org/software/bash/manual/html_node/Job-Control-Builtins.html)) | two-words | **picked 2026-10-28:** `stage_ended` follows the stage pick (`process_ended`). `dropped` for bash's `disown` is fine: it means "forgotten", not detached |
| `freeNumber` / `tableLine` / `jobNamed` | lowest free job number; `2 jobs: 1 running`; a job by `%n` or id | jobspec ([bash, job control](https://www.gnu.org/software/bash/manual/html_node/Job-Control-Basics.html)) | ok | |
| `Stage` (check.ts) / `Line.stages` | one command of a checked pipeline, with entry, flags, told, pipe, fed | a command in a pipeline ([bash, pipelines](https://www.gnu.org/software/bash/manual/html_node/Pipelines.html)) | two-ideas | **picked 2026-10-28:** goes with the shell job record's `stage`. The pipeline's stages (triage, plan, build, review, ship) are another idea and keep their name. The new word is not picked: `CheckedCommand` would match grammar.ts's `Command`, which it is checked from. 65% |
| `Stage.wire` / `wireOf` | output and input between two commands | pipe | two-words | **picked 2026-10-28:** wire -> pipe |
| `Stage.fed` / `Stage.told` | the input the last command feeds; inputs given on the line | none needed | ok | |
| `Line` (check.ts) / `Checked` (`kind: line, describe`) | a checked line, ready to run | a command line | two-ideas | `Line` is also move.ts's row line and plan's `Line` (pipeline.md, section 1). Keep here. 55% |
| `Source` (check.ts: `value`, `sub`) | where a value comes from: the line, or a `$( )` | command substitution ([bash, command substitution](https://www.gnu.org/software/bash/manual/html_node/Command-Substitution.html)) | two-ideas | `launch.ts` exports another `Source` (where lines come from). `Origin` here. 55% |
| `own` / `Part` (`kind: flag, input, output`) | a part a program declared | none needed | ok | |
| `Refusal` / `.status` | a refusal and its exit status: 127, else 2 | exit status 127, command not found ([bash, exit status](https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html)) | ok | |
| grammar: line, statement, pipeline, command, part, value | the line grammar | list, pipeline, simple command ([bash, lists](https://www.gnu.org/software/bash/manual/html_node/Lists.html)) | differs | bash says "list" for what we call a line and "command" for a statement. Keep `statement`: plain, and POSIX's grammar does not fix one word. 60% |
| `Statement` / `Bare` (`kind: run, builtin`) / `.after` / `Connector: &&, \|\|` | a statement and its link to the one before | AND and OR lists, control operators (same bash page) | ok | `kind: "run"` follows the process pick: a statement that starts processes. `pipeline`. 60% |
| `Pipeline` / `.commands`, `.bars` | commands joined by `\|` | pipeline (same bash page) | ok | |
| `Command` / `.program`, `.flags`, `.told`, `.out`, `.into`, `.describe` | one command as parsed | simple command ([POSIX, shell grammar](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html)) | ok | |
| `Value: text, sub` / `Given` / `Named` | a value on the line, or a `$( )` | word; command substitution | ok | |
| `Refused` (grammar) / `.at`, `.why`, `.didYouMean` | why a line was not taken | syntax error | two-ideas | the door exports another `Refused` (`host/door.ts:154`: `{ok: false, status, why}`). Grammar's: `ParseError`. 60% |
| `Parsed` / `parse` | the parse | parse | ok | |
| `words` / `Token` / `Op` / `At` / `Words` | the shell word reader | tokens, operators ([POSIX, token recognition](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html)) | ok | |
| `BUILTINS` / `Builtin` | built-in words | builtins ([bash, job builtins](https://www.gnu.org/software/bash/manual/html_node/Job-Control-Builtins.html)) | ok | |
| `jobs` | each job, its state, its line, its copies' lines | `jobs` (same bash page) | ok | |
| `ps` / columns RUN, PROGRAM, JOB, STATE | each program run | `ps` columns PID, COMMAND, STAT ([POSIX, ps](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/ps.html)) | differs | **picked 2026-10-28:** RUN -> PID follows run id -> pid. PROGRAM -> COMMAND is POSIX's header; 55%, a program here is not a command line |
| `tell %1 <input> <value>...` | tell a job's first program an input | none in bash (write to the job's stdin) | ok | |
| `close %1 <input>` | close one input, like stdin's end | EOF | ok | |
| `stop %1` | stop the job; a detached one is dropped | `kill %1` ([bash, job builtins](https://www.gnu.org/software/bash/manual/html_node/Job-Control-Builtins.html)) | differs | keep `stop`: in bash, a "stopped" job is a paused one, and tsh has no pause. That clash is the cost. 55%: `kill` is what a bash user types first |
| `attach %1 [&]` | start a detached job again, or wait for one here | `fg` and `bg` (same bash page); `tmux attach` ([tmux manual](https://man7.org/linux/man-pages/man1/tmux.1.html)) | ok | |
| `programs` | what can be started | none (`compgen -c`) | ok | |
| `help` / `exit [status]` | help, and leave | `help`, `exit` (bash builtins) | ok | |
| `--describe [name]` | a program's declaration, or one part whole | `--help`, a man page | differs | keep: `--help` is a flag a program may declare. 70% |
| `>output` / `<input` | name the output or input a pipe takes | redirection words ([bash, redirections](https://www.gnu.org/software/bash/manual/html_node/Redirections.html)) | two-ideas | in bash `>` and `<` are files. A bash user reads `>x` as "write to file x". Lean keep, glossed: 50%. Settle by a reader test |
| `input=value` | an input told on the line | an environment assignment in bash (`a=b cmd`) | two-ideas | same clash as above; keep, glossed. 55% |
| `Said` / `.status`, `.exit` | how a builtin ended | exit status | ok | |
| `HELP` / `USAGE` | the help text, the usage line | usage | ok | |
| `describe` | the lines `--describe` prints | man page | ok | |
| `Shell` (execute.ts) / `.list`, `.storage`, `.table`, `.print`, `.show`, `.signals`, `.live`, `.watched`, `.scope` | what tsh holds while it runs | shell state | collides | `Shell` is also the top-level namespace and the packs' `Shell` (pipeline.md, section 9). `ShellState`. 75% |
| `Shell.live` / `Shell.watched` / `Watcher` | the starter's handles by run id; each job's ends | none needed | ok | follow the pid pick for their keys |
| `Mode: foreground, background, capture` | how a line is run | foreground, background ([bash, job control](https://www.gnu.org/software/bash/manual/html_node/Job-Control-Basics.html)); capture is command substitution | ok | |
| `Done` / `.status`, `.values` | how a line ended | exit status | ok | |
| `runLine` / `waitForJob` / `reattach` / `lineSpan` / `refusedEnd` / `inWords` / `unreadWords` | run a line; wait; attach again | none needed | ok | |
| `runIdOf` | a fresh run id: name plus 8 hex | pid | two-words | **picked 2026-10-28:** run id -> pid (`pidOf`) |
| `SAVED_BY_OLDER_CODE` / `TABLE_REFUSED` | what tsh says of a state it cannot read | none needed | ok | |
| `Printed` (`to: out, err`, `text`) / `printed` | a line to show | stdout, stderr | ok | |
| `Ready` / `.status` / `ready` | a line is done; the prompt comes back | prompt; exit status `$?` | ok | |
| `tsh` flag `show: short, json` / `--json` / `Show` / `shown` / `shortOf` | how a value is printed | `--json` output, as `gh` uses it ([gh manual](https://cli.github.com/manual/gh_help_formatting)) | ok | |
| `tsh` inputs `line`, `signal: interrupt` | a typed line; Ctrl-C | SIGINT ([POSIX, signal.h](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/signal.h.html)) | ok | |
| `-c '<lines>'` / script file / stdin | where lines come from | `bash -c` ([bash, invoking](https://www.gnu.org/software/bash/manual/html_node/Invoking-Bash.html)) | ok | |
| `TSH_HOME` / `homeOf` | where job storage, history and the lock live | `HISTFILE`, `XDG_STATE_HOME` ([XDG base dirs](https://specifications.freedesktop.org/basedir-spec/latest/)) | ok | `homeOf` is also a pipeline export (pipeline.md section 9, `homeOf`) |
| `TSH_TRACE` / `endpointOf` / `DEFAULT_ENDPOINT` | where traces go | `OTEL_EXPORTER_OTLP_ENDPOINT` ([OTel, exporter config](https://opentelemetry.io/docs/specs/otel/protocol/exporter/)) | differs | also read `OTEL_EXPORTER_OTLP_ENDPOINT`, keep `TSH_TRACE=1` as the on switch. 70% |
| `Programs` / `ProgramList` / `programList` / `JobStorage` | the program list service, the job storage | `PATH` lookup | ok | |
| `statusOf` / `statusOfJob` | exit status from how a run ended | exit status; a pipeline's status is its last command's ([bash, pipelines](https://www.gnu.org/software/bash/manual/html_node/Pipelines.html)) | ok | |
| `SMALL`: `say`, `seq`, `double`, `upper`, `sleep`, `true`, `false`, `tally` | the small programs | `echo`, `seq`, `sleep`, `true`, `false` (coreutils) | differs | `say` is `echo`; and `host/laws.ts:162` exports another `say`. `echo`. 70% |
| `yes` / `no` (small.ts exports) | the `true` and `false` programs | `true`, `false`; coreutils' `yes` prints "y" forever | collides | the export names differ from the program names and `yes` means another tool. `trueProgram`, `falseProgram`. 80% |
| `complete` / `Completed` | tab completion | completion ([bash, programmable completion](https://www.gnu.org/software/bash/manual/html_node/Programmable-Completion.html)) | ok | |
| `Search` / `begin` / `step` / `find` / `Key: text, back, again, run, ...` / `keysIn` / `keyOf` | Ctrl-R history search | reverse-search-history ([bash, history commands](https://www.gnu.org/software/bash/manual/html_node/Commands-For-History.html)) | ok | `Key.kind: "run"` follows the process pick: it means "accept the line". `accept`, readline's `accept-line`. 70% |
| `didYouMean` | the closest known name | "did you mean", as git says it | ok | |
| `readValue` / `Read` / `typeOf` / `shapeLines` / `choices` | a word read as a value of a shape | none needed | ok | |
| `copyRows` / `fullRows` / `shownCopies` / `ENDED` | a job's copies' lines and its waiting writers | none needed | two-words | follows the copy/instance row |
| `titleOf` / `attachTitleOf` / `Short` / `Shorten` | what a line is called in a trace | span name | ok | |
| `tracing` / `memoryTracing` / `view` / `Viewing` / `DEFAULT_SERVICE` / `SERVICE` / `KEPT_OUT` | spans out over OTLP | OTLP exporter, span processor ([OTel SDK](https://opentelemetry.io/docs/specs/otel/trace/sdk/)) | two-ideas | `view` here is a span processor, not a program's view. `redact` or `exportView`. 65% |
| `runTsh` / `Options` | the launcher | none needed | ok | |

## host: ledger.ts, rules.ts, the service

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| ledger / `Ledger` | the one store under the host | event store ([EventStoreDB, appending](https://developers.eventstore.com/clients/grpc/appending-events.html)) | ok | |
| name / `register` / `Registered` / `RegisterResult` / `UnknownName` | a registered name; nothing lands under an unregistered one | registered name, `register/2` ([Erlang, processes](https://www.erlang.org/doc/system/ref_man_processes.html)); Kafka CreateTopics | ok | |
| stream / `streams(name)`: `registry`, `state`, `inbox`, `dead` | a name's four streams | stream (EventStoreDB, same source); mailbox (Erlang) | ok | |
| `Inbox` / `inboxOf` | a name's open stream | mailbox ([Erlang, processes](https://www.erlang.org/doc/system/ref_man_processes.html)) | differs | keep: "inbox" is plain. 75% |
| `Row` / `Rows` / `.pos`, `.stream`, `.rev`, `.writer`, `.kind`, `.at`, `.data`, `.id` | one event as kept | recorded event: position, stream revision ([EventStoreDB](https://developers.eventstore.com/clients/grpc/appending-events.html)) | two-ideas | pipeline.md section 9 already: `Record`. Here `.kind` is the event type (open, #32) and `.at` a time (held) |
| `NewEvent` / `Event` (rules) | an event to append | event data | two-words | `NewEvent` in the service, `Event` in rules: one idea. `NewEvent` in both. 70% |
| `Expected` (`number \| "any"`) | the rev a stream must end at | expected revision, `Any` (same source) | ok | |
| `append` / `Appended` / `AppendResult` | write an event | append (same source) | ok | |
| `send` | append to an inbox | send | ok | |
| `ok` / `why` on results: `stale`, `fenced`, `denied`, `unknown`, `held`, `down`, `lost`, `stop`, `noproc`, `limit` | the ledger's answers | WrongExpectedVersion, ProducerFenced, AccessDenied, UNKNOWN_TOPIC_OR_PARTITION (cited in the code) | ok | `ok`/`why` is one more tag pair (open, #32) |
| `Stale` (ledger error) | a write at the wrong rev | WrongExpectedVersion (same source) | collides | see storage's `Stale` |
| `Fenced` (error) / `Fenced` (host type, `"fenced" \| "unreachable"`) | a newer lease holds the name | fencing token ([Kleppmann](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)) | two-ideas | pipeline.md section 9: the type -> `FenceWord`. Not picked |
| `Denied` / `Held` / `LeaseLost` / `Cancelled` / `Down` / `NoProc` / `OverLimit` / `LedgerUnreachable` | the service's tagged errors | Effect tagged errors ([Effect, yieldable errors](https://effect.website/docs/error-management/yieldable-errors/)); `noproc` is OTP's | ok | |
| claim / `Claimed` / `ClaimResult` / `renew` / `RenewResult` / `cancel` / `CancelResult` | take, keep and give up a name's lease | lease acquire, renew, release ([Kubernetes, leases](https://kubernetes.io/docs/concepts/architecture/leases/)) | differs | `cancel` gives up a lease: Kubernetes and etcd say release or revoke. `release`. 60%: the pipeline's `Lanes.release` is a ticket lease, a second lease word |
| `Lease` / `.stream`, `.holder`, `.expires_at`, `.fence`, `.stop` | who holds a name, until when | lease: holderIdentity, renewTime (same Kubernetes source) | two-words | `expires_at` is snake case beside camel case `expiresAt` in `ClaimResult`. One spelling: `expiresAt`. 85%. `stop` is one more meaning of stop (see Across) |
| fence / `fence` | a lease's number; newer wins | fencing token, producer epoch (Kleppmann; Kafka) | ok | |
| holder / `holder` / `holderOf` / `hostOf` | the host that holds a lease: `host@writer` | holder identity (Kubernetes lease) | ok | |
| incarnation / `.incarnation` | the run's number: +1 per restart, the same across a takeover | OTP's pid: new at each spawn ([Erlang, processes](https://www.erlang.org/doc/system/ref_man_processes.html)); Temporal's run id ([Temporal](https://docs.temporal.io/workflow-execution/workflowid-runid)) | differs | keep: "incarnation" is Orleans' and Akka's word for one life of an actor. 60%. Not covered by the pid pick: one life of a ledger name still needs its word (README, still open) |
| `Process` / `ProcessInfo` / `processInfo` / `processOf` (`name`, `parent`, `incarnation`, `down`, `trapExit`) | a name's process, as `erlang:process_info` says | `process_info` ([Erlang, erlang module](https://www.erlang.org/doc/apps/erts/erlang.html)) | ok | now beside tsh's "process" (picked): both are fine, and close in meaning |
| `exit` / `Exited` / `ExitResult` / `ExitReason: normal, shutdown, crash` | the holder says its program ended | `exit/2` and exit reasons `normal`, `shutdown` ([Erlang, processes](https://www.erlang.org/doc/system/ref_man_processes.html)) | differs | OTP has no `crash` reason; any other term is abnormal. Keep `crash`: plain. 75% |
| `EndReason` (adds `killed`, `limit:*`) / `DownReason` (adds `noproc`) | how a run ended, as DOWN and EXIT say it | `killed`, `noproc` (OTP, same source); `OOMKilled`, `DeadlineExceeded` (Kubernetes) | ok | |
| `DOWN` / `DownMessage` (`ref`, `target`, `incarnation`, `reason`, `why`, `at`) | a monitor's one message | `{'DOWN', Ref, process, Object, Info}` ([Erlang, erlang module](https://www.erlang.org/doc/apps/erts/erlang.html)) | ok | |
| `EXIT` / `ExitMessage` (`from`, `incarnation`, `reason`, `why`, `at`, `to`) | a linked name's exit, to one that traps exits | `{'EXIT', From, Reason}` (same source) | ok | |
| `monitor` / `demonitor` / `Monitored` / `MonitorResult` | watch a name; one DOWN when it ends | `erlang:monitor/2`, `demonitor/1` (same source) | ok | |
| `link` / `unlink` / `LinkResult` / `trapExit` / `FlagResult` | link two names; trap exits | `link/1`, `process_flag(trap_exit, true)` (same source) | ok | |
| `startChild` / `Started` (ledger) / `StartResult` | register a child under me and link it, or start it again | `supervisor:start_child` ([Erlang, supervisor](https://www.erlang.org/doc/system/sup_princ.html)) | collides | ledger's `Started` loses to the program's on the top level. `ChildStarted`. 75% |
| `exitChild` / `ExitChildResult` (`how: signalled, exited, noproc`) / `Signal: shutdown, kill` | stop a child | `exit(Child, shutdown \| kill)` (OTP) | ok | |
| `restarted` / `cancel` (ledger kinds) | ledger event names | past tense ([Fowler, event sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)) | differs | `cancel` is the one non-past kind among the ledger's own: `cancelled`. 75% |
| `LEDGER_KINDS`: `registered`, `claimed`, `lease_expired`, `lease_resumed`, `exited`, `DOWN`, `EXIT`, `dead_letter`, `held`, `charged`, `limits`, `limit` / `isLedgerWord` | the kinds only the ledger writes | past tense events; OTP's capital DOWN, EXIT | two-words | `limits` (limits set) and `limit` (a limit hit) differ by one letter: `limits_set`, `limit_hit`. 70%. "kind" vs "word" (`isLedgerWord`) for one idea: `isLedgerKind`. 75% |
| `dead_letter` / `DeadLetter` (ledger: `rev`, `strikes`, `why`, `at`) / `MAX_DELIVERIES` / `maxDeliveries` | an inbox message set aside after crashing a program | dead-letter queue, `maxReceiveCount` ([SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)); `delivery-limit` (RabbitMQ) | ok | |
| `deadLetters` / `DeadLetterEntry` / `redrive` / `Redriven` (`how: sent, not_dead, ledger_message, denied, unknown`) | list them; send one back once | redrive to source (same SQS source) | ok | |
| `limitEnds` | runs a limit ended | none needed | ok | |
| `hold` / `charge` / `Charged` / `HoldResult` / `ChargeResult` / `Holding` / `Charging` | a turn's upper bound before; what it spent after | authorization hold and capture ([Stripe, holds](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method)) | two-ideas | the sweep's `Hold` (a ticket lease, pipeline) is a second hold. `charge` matches Stripe's capture loosely. Keep both, glossed. 60% |
| `Cost` (`usd`, `tokens`) | what a run spent, as it reports | usage ([Anthropic API, messages](https://docs.anthropic.com/en/api/messages)) | two-words | the money word is open (#32). Not picked |
| `Limits` (ledger: `usd`, `tokens`, `wallMs`, `children`) / `LimitsSchema` / `setLimits` / `SetLimitsResult` | a name's caps | `resources.limits` ([Kubernetes, resource management](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)); `pids.max` ([cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)) | two-ideas | a turn's `Limits` is another export (agents). The money key is open (#32) |
| `LimitKind: usd, tokens, wall, children` / `LimitReason: limit:usd, limit:tokens, limit:wall` | which limit | Kubernetes reasons | two-words | `wall` here, `wallMs` in `Limits`, `seconds` in a turn. One word for time: `wall`. 70% |
| `Over` (`kind`, `at`, `used`, `max`) / `limitsRefusal` / `micros` | a limit hit | quota exceeded | two-ideas | `Over.at` is a name here (held `at`, sweep). `Over.of`, as `LimitRecord.of` says. 70% |
| `LimitRecord` (`limit`, `of`, `used`, `max`, `why`, `incarnation`, `at`) | the record of a run a limit ended | none needed | ok | |
| `Usage` (rules: `name`, `limits`, `used`, `children`, `since`, `deadline`) / `UsageSchema` / `usage` | where a name stands against its limits | usage, quota status ([Kubernetes, resource quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/)) | collides | the 2026-10-24 pick made `Usage` an agent run's cost, and acp has a third `Usage`. Ledger's: `Quota` (Kubernetes' `ResourceQuota.status`). 70% |
| `Written` (`stream`, `rev`, `pos`) | what one call wrote, to wake watchers | none needed | ok | |
| `read` / `readStream` / `readLast` / `watch` / `tail` / `Meter` / `meter` / `TailOptions` | reads, and a live read | read all, read stream, subscribe (EventStoreDB) | ok | |
| `nextDue` / `runDue` / `wakeTags` / jobs table (`deadline`, `lease_expiry`, `due_at`) | the ledger's scheduled wake-ups | alarms ([Durable Objects, alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)); timers | two-ideas | pipeline.md section 9: `timers`. Now "job" is tsh's picked word too, so this one should move. 80% |
| `Rules` / `RULES` / `PLANTED` / `Planted` / `layerPlanted` / `*With` | the SQL rules, and copies with one mistake planted | fault seeding ([Wikipedia, bebugging](https://en.wikipedia.org/wiki/Bebugging)) | ok | pipeline.md section 2's `Plant` row covers the word |
| `migrations` / `migrate` | numbered migrations | migrations | ok | |
| `Db` / `Value` / `SqlRow` / `openDb` / `readOnlyRows` / `Method` / `dispatch` | the SQL driver | none needed | two-ideas | `dispatch` is also tea's Msg dispatch (`Shell.table.dispatch`). `call`. 50% |
| `Raw` (ledger) / `fromRaw` / `rawOf` / `Wire` / `WireCall` / `onTheWire` / `isWireMethod` | the ledger's answers before errors are typed; its network calls | RPC, wire format | two-ideas | **wire -> pipe (picked 2026-10-28) does not cover this:** here "wire" is the network. Keep "wire" for the network once the pipe rename lands; `rawOf` and `Raw` also exist in agents. Ledger's `rawOf` -> `rpcOf`. 60% |
| `Moving` / `ImportResult` / `importEvent` | moving a project's events in | import | ok | |
| `namesOver` / `isInbox` / `isNameShape` | helpers | none needed | ok | |

## host: host.ts, host-machine.ts, call.ts, monitor.ts, supervisor.ts, journal.ts, observer.ts

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| host / `serve` / `Serving` / `ServeOptions` (`name`, `holder`, `program`, `ttlMs`, `renewEveryMs`, `retryMs`, `graceMs`, `retryRenewMs`, `listen`, `meters`) | run a program under a name on the ledger | an Erlang node; a virtual actor's silo ([Orleans](https://learn.microsoft.com/en-us/dotnet/orleans/overview)) | ok | |
| `Host` phases: `watching`, `claiming`, `owning`, `exiting`, `down` | where a host stands for a name | follower, candidate, leader ([Raft](https://raft.github.io/raft.pdf)); standby | differs | keep: plain, and each is one action. 70% |
| `HostMsg`: `claim_due`, `seen_expiry`, `seen_claim`, `seen_exit`, `seen_restart`, `claimed`, `held`, `is_down`, `claim_failed`, `program_started`, `program_ended`, `renew_due`, `renewed`, `renew_lost`, `renew_unknown`, `lease_due`, `exited`, `exit_refused` | the host machine's Msgs | Elm Msgs ([Elm guide](https://guide.elm-lang.org/architecture/)) | ok | |
| `HostCmd: claim, renew, exit` / `HostSub` / `START` / `HostSettings` / `HOST_GRACE_MS` / `createHost` / `hostUpdate` / `hostSubs` | its Cmds, Subs and settings | Cmd and Sub (Elm) | ok | |
| `ProgramEnd` / `ExitWord` / `exitOf` / `losesLease` / `programOf` / `renewClockOf` / `leaseClockOf` | how the program ended, as the host tells the ledger | exit reason | two-words | `ExitWord` vs `ExitReason` (rules): "word" and "reason" for one idea. `ExitReason`-based name. 60% |
| `HostEvent` / `.ev: up, phase, claim, renew, program, exit, lease_end, bad_shape, tea_error` | what a host tells a listener | log events | two-words | tag key `ev` (open, #32) |
| `Self` / `.name`, `.fence`, `.incarnation`, `.holder`, `.inbox`, `.reads`, `.send`, `.run`, `.monitor`, `.link`, `.trapExit`, `.exit`, `.startChild`, `.hold`, `.charge`, `.exitChild` | the program's own handle | `self()` ([Erlang, processes](https://www.erlang.org/doc/system/ref_man_processes.html)) | ok | `Self.run` (`RunUnder`) runs a machine: one more "run" (see Across) |
| `RunUnder` | run a machine with the host's store and errors | none needed | two-ideas | follows the process pick: it starts no process. `runMachine`. 60% |
| `Journal` / `.schema`, `.cursor` / `journalStore` / `WriteNote` / `lastStateOf` / `backoff` | a program's saved state on the ledger | journal; snapshot | ok | |
| `savedState` / `getState` / `whereis` / `Whereis` | read a name's last state and holder | `whereis/1`, `sys:get_state` ([Erlang, erlang module](https://www.erlang.org/doc/apps/erts/erlang.html)) | ok | |
| `envelope` / `Envelope` (`id`, `rev`, `from`, `kind`, `body`) | an inbox message, read | message envelope ([EIP](https://www.enterpriseintegrationpatterns.com/patterns/messaging/EnvelopeWrapper.html)) | ok | `kind` again |
| `cast` / `Delivered` (`how: sent, fenced, denied, unknown, unreachable`) | one message, sent again under the same id until it lands | `gen_server:cast` ([Erlang, gen_server](https://www.erlang.org/doc/apps/stdlib/gen_server.html)) | ok | |
| `Monitoring` / `Starting` / `Holding` / `Charging` (`.how`) | the host call answers | none needed | ok | pipeline.md section 9 row |
| `Call` (namespace) / `call` / `update` / `CallSettings` / `Pending` / `Calls` / `noCalls` / `CallMsg: resume, sent, send_failed, timed_out, reply` / `CallCmd: send` / `messageIdOf` | gen_server:call as a tea module | `gen_server:call` (same source) | ok | |
| `Outcome` (call.ts: `kind: answered, extra`) / `Stepped` | what a call step came to | reply | collides | `Outcome` is the pipeline's five-verb word (`outcome.ts`). `CallResult`. 75% |
| `Deadline` / `deadlinesOf` / `deadlines` | when to give up on a call | timeout | ok | |
| `Monitor` (namespace) / `Watch` / `Monitors` / `noMonitors` / `refOf` / `MonitorMsg: watch, resume, monitored, down, retry_due` / `MonitorCmd: monitor` / `MonitorOutcome: down, gap, noproc` / `MonitorStepped` / `endedOf` / `Retry` / `retriesOf` / `retries` / `MonitorSettings` / `MAX_RETRY_MS` / `retryDelayOf` | keep watching a name; report every death once | monitor ([Erlang, processes](https://www.erlang.org/doc/system/ref_man_processes.html)) | two-ideas | `Watch` is also program's `Watch`; `MonitorOutcome` is another "outcome". `Watch` -> `Watched`; keep `MonitorOutcome` (prefixed). 55% |
| `supervisor` / `createSupervisor` / `superviseWith` / `Supervisor` | OTP's supervisor as a program | supervisor ([Erlang, supervisor](https://www.erlang.org/doc/system/sup_princ.html)) | ok | |
| `SupervisorSpec` (`strategy`, `intensity`, `periodMs`, `children`, `backoff`, `maxDeliveries`) / `Strategy: one_for_one, one_for_all, rest_for_one` | the spec | OTP's sup flags, same words (same source) | ok | |
| `ChildSpec` (`name`, `restart`, `shutdown`, `type`, `limits`) / `Restart: permanent, transient, temporary` / `Shutdown: brutal_kill, infinity, ms` / `ChildType: worker, supervisor` | one child | OTP's child spec (same source) | ok | `type` is OTP's own key here |
| `Backoff` (`minMs`, `maxMs`, `resetAfterMs`) / `delayOf` | restart backoff | Akka BackoffSupervisor ([Akka, fault tolerance](https://doc.akka.io/libraries/akka-core/current/typed/fault-tolerance.html)); CrashLoopBackOff | ok | |
| `LIMIT_RETRY_MS` / `refusalOf` / `MEMO` | waits, spec check, kept answers | none needed | ok | |
| `Run` (supervisor: `is: up, starting, stopping, stopped`) / `Child.run` / `ChildInfo.run` | one child's run state | child status, as `which_children` lists it (OTP) | collides | a second exported `Run` (the program's wins on the top level). `ChildState`. 80% |
| `Ended` (supervisor: `incarnation`, `reason`, `why`, `at`) / `AfterStop` (`do: restart, stay, remove`) | a child's exit; what to do after a stop | exit | two-ideas | `ChildExit`. 70%. Tag key `do` (open) |
| `Child` (`incarnation`, `fails`, `run`, `limits`) / `ChildInfo` | one child as the supervisor knows it | child | ok | `fails` counts restarts in a row: `restarts`. 60% |
| `Answer` (supervisor: `ok`, `error`, `incarnation`, `children`) / `Reply` (`id`, `res`) / `Caller` / `Outgoing` | a call's answer | `{ok, ...}` or `{error, Why}` (OTP) | two-ideas | `Answer` is also mcp's and acp's export. `CallReply`. 60% |
| `Request` (`op: start_child, terminate_child, restart_child, delete_child, which_children`) | a call | OTP's supervisor API (same source) | ok | tag key `op` (open) |
| `SupervisorMsg: begin, exit, request, started, start_refused, signalled, replied, ignored` / `Start` / `Stop` / `SupervisorSub: starts, replies, give_up` / `SupervisorState` / `NOT_BEGUN` / `generation` | the supervisor machine | Kafka's group generation (cited) | two-ideas | `Stop` is also a turn's stop reason (agents). `ChildStop`. 65% |

## host: door.ts, writer.ts, keys, signer, sshsig, http, local, move, memory, sqlite, laws

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| door / `Door` / `DOOR` | the one way in from the network: credential to who | an authentication gateway; OAuth resource server ([RFC 6749](https://www.rfc-editor.org/rfc/rfc6749)) | differs | keep: plain, and the README glosses it. 65% |
| `Stamp` (`kind: user, agent`, `id`, `for`) / `stampText` | what the door says a credential is | principal, subject ([RFC 7519, `sub`](https://www.rfc-editor.org/rfc/rfc7519)) | differs | `Principal`. 55%: "stamp" also says it is written on the row, which "principal" does not |
| user / person (`Stamp.kind: "user"`, `User`, `Person`, `PERSON_KINDS`, `PersonKind`, `isPersonKind`, `isPersonId`, `.person` in configs and mcp) | a human member | user ([GitHub REST, users](https://docs.github.com/en/rest/users)); principal | two-words | one word. `person`: the docs and the rule "a person's answer" use it more; but the row text is `user:<id>` on every ledger, so `user` is cheaper. Lean `user` in data, 55%: count rows and docs |
| agent / `Agent` (writer) / `AgentBefore` / `isAgentName` / `for` | an agent, and the person it works for | on-behalf-of, `act` claim ([RFC 8693](https://www.rfc-editor.org/rfc/rfc8693)) | collides | the top-level `Agent` namespace hides writer's `Agent`. `AgentWriter`, `OldAgentWriter`. 85% |
| `Writer` / `writerOf` / `writerText` | who wrote a row, typed | author | ok | |
| `MEMBERS` / `Members` / `membersOf` / `namesOf` / `knownBy` / `Known` | the ledger's members, as facts in `door/members` | members ([GitHub, org members](https://docs.github.com/en/rest/orgs/members)) | ok | |
| member kinds `founded`, `invited`, `joined`, `removed` | member events | invitation, accepted, removed (GitHub) | ok | |
| `DoorConfig` (`kind: closed, local, shared`; `founder`, `origin`, `sessionMs`, `person`, `secretHash`) / `configOf` | which door | none needed | ok | `kind` again |
| challenge / `challengeText` / `CHALLENGE_MS` / nonce | what a person signs | challenge-response ([WebAuthn, challenge](https://www.w3.org/TR/webauthn-2/#sctn-cryptographic-challenges)) | ok | |
| `Grant` (`address`, `agent`, `key`, `for`, `expires`) / `grantText` / `grantOf` / `grant` (signer) | a person's signed grant to an agent | delegation; a signed token | ok | |
| `LoginAnswer` (`token`, `who`, `expires`) / session / `SESSION_MS` / `LOCAL_AGENT_MS` / `newToken` / `hashOf` | a login's answer | session token | ok | |
| `Session` (http) / `renewing` / `Renewing` / `Held` (`kind: live, refused`) | a person's session, renewed | session; refresh | two-ideas | `Session` is also acp's session machine and the agent session id. `DoorSession`. 70% |
| `Refused` (door) / `Let` / `NOT_PROVEN` / `UNAVAILABLE` / `DoorRefused` | the door's no | 401, 403 ([RFC 9110](https://www.rfc-editor.org/rfc/rfc9110#name-401-unauthorized)) | two-ideas | see grammar's `Refused`. `Let` is odd for "allowed or refused": `Decision`. 55% |
| `trustedArgs` / `isDoorStream` / `NAMESPACE` / `REDRIVE` | what a request may say; reserved names | none needed | ok | |
| `PERSON_KINDS` (`answered`) / `Writes` | kinds only a person writes; who writes each of a program's facts | none needed | two-words | follows user/person |
| `Keys` (`byId`, `of`) / `KeysUnreachable` / `layerNobody` / `layerGitHub` / `Signers` / `KEYS_CACHE_MS` / `KEYS_FAIL_MS` / `TOKEN_REFUSED` / `GitHubOptions` / `isLogin` / `githubId` | who has an id, and which keys may sign for them | a user's SSH keys ([GitHub REST, keys](https://docs.github.com/en/rest/users/keys)) | ok | |
| `Signer` / `layerSignerKey` / `layerSignerFile` / `KeyUnreadable` | what signs a login | signer | ok | |
| `sign` / `verify` / `parse` / `keyLineOf` / `keyOnly` / `keyBlobOf` / `KeyFile` / `keyFileOf` / `keyFileText` | SSHSIG on WebCrypto | SSHSIG ([OpenSSH, PROTOCOL.sshsig](https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.sshsig)) | ok | |
| `layerHttp` / `HttpOptions` (`url`, `ledger`, `token`, `maxSockets`, `timeout`) / `doorOf` / `answers` | the ledger over HTTP | client | ok | |
| `layerLocal` / `LocalOptions` (`persist`, `ledger`, `port`, `graceMs`, `maxDeliveries`, `capMb`, `checkEvery`, `maxSockets`, `person`) / `LocalLedger` / `LocalError` / `startLocal` | the ledger in a Miniflare child | Miniflare `persist` ([Miniflare](https://developers.cloudflare.com/workers/testing/miniflare/)) | ok | |
| `layerAttach` / `AttachOptions` | the same ledger from another process | attach (tmux) | two-ideas | tsh's `attach` reruns a job; this one connects to a running ledger. Close enough; keep, 60% |
| `layerInside` / `beside` / `ledgerOptions` / `ledgerBindings` / `LEDGER_ENTRY` / `COMPATIBILITY_DATE` / `KeysOptions` / `DoorOptions` / `LedgerOptions` / `objectOf` | Durable Object wiring | `compatibility_date` ([Workers](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)) | ok | |
| daemon env `PERSIST`, `PORT`, `GRACE_MS`, `MAX_DELIVERIES`, `DOOR_PERSON`, `DOOR_SECRET` | the local ledger child's settings | none needed | two-words | `DOOR_PERSON` here, `LOCAL_PERSON` in the Worker's config (`configOf`). One name. 75% |
| `layerMemory` / `memoryLedger` / `memoryService` / `MemoryOptions` / `layerSqlite` / `layerSqliteSync` / `SqliteOptions` | the ledger over Maps, and over node:sqlite | none needed | ok | |
| move / `Moved` / `By` (`kind: founder, agent`) / `MAX_CHUNK` / `Chunk` / `Seal` / `MoveState` (`kind: open, importing, fresh`, `by: seal, invite, write`) / `Progress` / `writerFor` / `byOf` / `hashLines` / `Mapped` / `MOVE` / `migrateMove` / `moveStateOf` / `moveProgress` / `importChunk` / `sealMove` | moving a project's events to a new ledger | export and import; a migration | ok | |
| `Plan` (move.ts: `founder`, `events`, `streams`, `writers`, `unmappable`, `refused`) / `planOf` | the move's plan | migration plan | two-ideas | the pipeline's `Plan` is a ticket's plan. `MovePlan`. 85% |
| `Line` / `lineOf` / `linesOf` (move.ts) | one ledger row as text, for the hash | none needed | collides | `program/refs.ts` exports another `lineOf`. `rowText`. 75% |
| laws / `runLaws` / `law1Claims` ... `law30Wall` / `LawResult` / `SuiteOptions` / `Time` / `timeOf` / `fresh` / `say` | the ledger's law suite | invariants ([TLA+](https://lamport.azurewebsites.net/tla/tla.html)) | two-ideas | `say` is also the small program `say`. `expectFail`. 55%. `law` vs `property` is open in the sweep |

## agents: agent/ (the interface)

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| `Agent` (namespace) | our own interface to a coding agent | agent, in ACP ([ACP, overview](https://agentclientprotocol.com/overview/introduction)) | collides | see writer's `Agent` |
| `Agents` / `.run`, `.knows` / `makeAgents` / `AgentsConfig` (`adapters`, `sessions`, `reaper`, `stopped`) | the service | an agent client (ACP's Client) | two-ideas | `Agents.run` is one more "run": it runs a turn. `turn`. 65% |
| `Turn` (`provider`, `session`, `folder`, `prompt`, `system`, `answer`, `model`, `effort`, `limits`) | one turn as a stage asks for it | a prompt turn ([ACP, prompt turn](https://agentclientprotocol.com/protocol/prompt-turn)) | ok | |
| `Turn.folder` | where the agent works | `cwd` (ACP `session/new`) ([ACP, session setup](https://agentclientprotocol.com/protocol/session-setup)) | differs | keep `folder`: plain, and `createRefineLoop` says `folder` too. 60% |
| `Turn.answer` / `Reads` / `reader` / `jsonSchema` / `formOf` / `lastFit` | the answer's schema; read the last message by it | structured output ([Anthropic, structured outputs](https://docs.claude.com/en/docs/build-with-claude/structured-outputs)) | ok | |
| provider / `Turn.provider` / `no_provider` / `other_provider` | a row of the provider table | provider | two-words | the files also say "maker" (the vendor), "adapter" (the code), "harness" (the ACP program), and acp's flag says `agent`. Keep `provider` for the row and `adapter` for the code; drop "maker" for `provider`. 65% |
| `SystemPrompt` (`_tag: append, replace`) / `NonBlank` | a turn's system prompt | the makers' own words, append and replace ([Agent SDK, system prompts](https://docs.claude.com/en/docs/agent-sdk/modifying-system-prompts)) | ok | |
| `Limits` (turn: `usd`, `tools`, `seconds`) / `NO_LIMITS` | caps on one turn | `maxBudgetUsd`, `maxTurns` (Agent SDK); ACP's `max_turn_requests` | collides | a second exported `Limits` in this package, with other keys. `TurnLimits`. 80%. The money key is open (#32) |
| `Stop: end_turn, max_tokens, max_turn_requests, refusal, cancelled, over_budget, over_time` | why a turn ended | ACP's `StopReason` ([ACP, prompt turn](https://agentclientprotocol.com/protocol/prompt-turn)) | two-ideas | ACP's name is `StopReason`; `acp/transcript.ts` exports another `Stop` without our two values. `StopReason`, one export. 85% |
| `Update` (`_tag: started, said, tool, asked, tokens`) | one thing the agent did, as it happened | `SessionUpdate`: `agent_message_chunk`, `tool_call`, `usage_update` (same source) | differs | ACP's `request_permission` is ours `asked`; fine. Keep `said`/`asked`: plain. 70% |
| `ToolStatus: pending, in_progress, completed, failed` | a tool call's status | ACP's `ToolCallStatus` ([ACP, tool calls](https://agentclientprotocol.com/protocol/tool-calls)) | two-words | exported twice (`turn.ts`, `acp/transcript.ts`). One export. 85% |
| `Tokens` (`input`, `cached`, `output`) / `NO_TOKENS` / `Counted: turn, requests, last, none` | a turn's tokens | `input_tokens`, `cache_read_input_tokens`, `output_tokens` ([Anthropic API, messages](https://docs.anthropic.com/en/api/messages)) | ok | |
| `Ended` (turn: `stop`, `answer`, `tokens`, `counted`, `usd`, `requests`) / `Heard` | the turn's end | `PromptResponse` (ACP) | two-ideas | the fourth `Ended`. `TurnEnded`. 75% |
| `AgentFailed` / `AgentFailedWhy: no_provider, cannot_limit, other_provider, system, contain, start, broke` / `failed` | why a turn could not run | none needed | ok | |
| `Raw` (`_tag: opened, said, tool, asked, tokens, ended`) / `AdapterTurn` / `Adapter` (`name`, `holds`, `start`) | what an adapter says and is handed | an adapter | two-ideas | ledger exports another `Raw`; both are "before our types". `AdapterUpdate`. 60% |
| `Adapter.holds` (`usd`, `schema`) | what the maker holds on its own | capabilities (ACP `agentCapabilities`) | differs | `can`. 50% |
| `Running` (turn: `updates`, `pid`, `stop`) | a turn that has started | none needed | collides | a second `Running`; see program's |
| `Running.pid` / `Reaper` (`tree`, `alive`, `kill`) / `noReaper` / `psReaper` / `under` | the agent's OS process tree, reaped at the stop | pid, process tree ([POSIX, ps](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/ps.html)) | two-ideas | a real OS pid. **picked 2026-10-28:** a tsh process's id is the `pid`; this OS number becomes `osPid` |
| `Sessions` (`get`, `put`) / `memorySessions` / `fileSessions` / `.own` | our session ids mapped to each maker's | session id ([Agent SDK, sessions](https://docs.claude.com/en/docs/agent-sdk/sessions)); ACP `sessionId` | ok | |
| `Stopped` (`provider`, `session`, `ms`, `under`, `killed`) | what a stop did | none needed | ok | |
| `agentRunner` | a Draft's runner on the service | effect manager (Elm) | ok | |
| `fakeAdapter` / `FakeScript` / `FakeSeen` / `saying` | a scripted adapter for tests | fake | ok | |

## agents: claude/, codex/, acp/, trace/

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| `claudeAdapter` / `ClaudeAdapterConfig` / `EXTRA_OPTIONS` / `ExtraOptions` / `rawOf` (claude) | the Agent SDK adapter | Agent SDK `query` ([Agent SDK, TypeScript](https://docs.claude.com/en/docs/agent-sdk/typescript)) | two-ideas | `rawOf` is also the ledger's. `updatesOf`. 65% |
| `createDraft` / `Draft` / `DraftRun` / `DraftMsg` / `DraftTool` / `DraftFinished` / `DraftFailed` / `sdkRunner` / `openLive` / `Open` / `Opened` / `NotStarted` / `extraTools` | the older Draft on the SDK | an agent run | ok | pipeline.md section 9 covers Draft |
| `Spend` / `noSpend` (claude/draft.ts) | what a run cost | usage | two-words | picked 2026-10-24: `Usage`, `noUsage`. Not renamed yet. It now collides with the ledger's and acp's `Usage` |
| `Spend.costUsd`, `.tokens`, `.context`, `.turns`, `.minutes` | its keys | `total_cost_usd`, `num_turns`, `duration_ms` (Agent SDK) | two-words | pipeline.md section 1 rows (`Spent.*`) cover them |
| `runEnv` / `agentEnv` / `shellEnv` / `hostEnv` / `Env` (claude/env) | environments built from keep-lists | environment | two-ideas | three `Env` types in the package (sandbox, claude/env, shell/launch), one shape. One export. 80% |
| `ownRules` / `AGENTS_MD` / `NO_PROJECT_CONFIG` / `MAKE_EMPTY_FOLDER` / `SettingsFrom` / `settingsRefusal` / `emptyFolderRefusal` / `startRefusal` | what Claude Code may read of a repo's rules | `settingSources` (Agent SDK) | ok | |
| `temps` / `toolchain` / `gitOf` / `filesOf` / `opensHome` / `fencedEnv` / `TOOLS` | the Claude sandbox's paths and tools | sandbox profile | two-ideas | `fenced` is the ledger's fencing word. `sandboxEnv`. 70% |
| `guardHook` / `GuardRules` / `refusal` (shell-guard) | a PreToolUse hook that refuses some shell commands | PreToolUse hook ([Claude Code, hooks](https://docs.claude.com/en/docs/claude-code/hooks)) | two-ideas | pipeline.md section 3: "guard" is also XState's word for a gate. `bashHook`. 55% |
| `codexAdapter` / `CodexAdapterConfig` / `flagsOf` / `strictOk` / `rawOfLine` / `codexEnvOf` | the Codex exec adapter | `codex exec --json` events, `thread_id` (Codex docs; link not checked, a guess) | ok | |
| `acpAdapter` / `rawOfUpdate` / `claudeResultOf` / `claudeMetaOf` | the ACP adapter | ACP client ([ACP, overview](https://agentclientprotocol.com/overview/introduction)) | ok | |
| `connect` / `Connection` / `Spawnable` / `Extensions` / `valuesOf` / `OpenHow: new, load, resume` / `Opened` / `PendingAsk` / `AcpFailed` (`_tag: acp_failed`) | the ACP connection | `session/new`, `session/load`, `session/resume` ([ACP, session setup](https://agentclientprotocol.com/protocol/session-setup)) | ok | `_tag` values are snake case here, PascalCase in Effect errors elsewhere: one more tag-style split (open) |
| `Heard` (acp client: `kind: update, ask`) | what the connection heard | session notification; permission request | two-ideas | the third `Heard`. `Incoming`. 55% |
| harness / `Harness` / `harnessOf` / `AGENTS: claude, codex, fake` / `AgentName` / `ADAPTERS` | the ACP agent program we start | "Agent" in ACP; the adapters are `claude-agent-acp`, `codex-acp` | two-words | "harness", "adapter" and "agent" for one program; and mcp exports another `AgentName` (an agent's name for the door). Lean: `Harness` stays (the repo's word, pipeline.md section 3 `harness`), acp's `AgentName` -> `HarnessName`. 70% |
| `codexHomeOf` / `codexHome` / `codexConfig` / `codexEnv` / `CODEX_MODES` / `planLogin` / `claudeSystem` / `codexSystem` / `writeSystem` / `withSystem` / `claudeOptions` | per-harness setup | each maker's config | ok | |
| `acp` program / `acpProgram` / `acpEntry` | an ACP client as a program | ACP client | ok | |
| acp flags `agent`, `folder`, `model`, `effort`, `mode`, `permissions: refuse, ask`, `reopen: load, resume`, `budget` | CLI words a user types | ACP's `session/set_mode`, `request_permission`, `session/load` (same sources) | two-words | `agent` names a harness (see above); `budget` is the dollar cap while a turn says `usd` (open, #32); `folder` vs ACP's `cwd` (see `Turn.folder`) |
| acp inputs `prompt`, `allow`, `refuse`, `cancel` / outputs `opened`, `said`, `result`, `ask` | what it is told and says | `session/prompt`, `session/cancel`, `allow_once`/`reject_once` (ACP) | two-ideas | output `ask` is a permission request; `ask` is an outcome verb and a ledger record (open, #32). `permission`. 65% |
| `AcpRefused` (`_tag: acp_refused`) | the program refused a step | none needed | ok | |
| `session` machine / `Session` (`agent`, `id`, `turns`, `told`, `waiting`) / `SessionMsg: opened, told, ended` / `Waiting` / `NONE` | the kept session record | ACP session | two-ideas | see http's `Session` |
| `Transcript` / `Phase: starting, loading, idle, turn, cancelling` / `How` / `Seen` (`kind: said, thought, tool, tool_update, plan, mode, title, context, notice, other`) / `Notice` / `Step` / `Message` / `Tool` / `Ask` / `Answer: allowed, refused, cancelled` | the transcript machine | ACP's session updates ([ACP, prompt turn](https://agentclientprotocol.com/protocol/prompt-turn)) | two-ideas | `Ask` and `Answer` are the asks core's words; `Stop` and `ToolStatus` repeat `turn.ts`; `Usage` (`input`, `output`, `cached`, `total`) is a third `Usage`. Prefix them: `PermissionAsk`, `PermissionAnswer`, `AcpUsage`. 70% |
| `Ended` (acp: `n`, `stop`, `usage`) | a turn's end, as ACP says it | `PromptResponse` | two-ideas | the fourth `Ended`; see turn's |
| `acpEvents` / `AcpEvents` / `sdkEvents` / `SdkEvents` / `agentTrace` / `sdkTrace` / `SdkTrace` / `underParent` / `KEPT_OUT` | agent events as spans | gen AI spans ([OTel, gen AI](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/)) | ok | event types `RunDone`, `TurnSettled`, `ToolStarted`, `BrainStarted` come from an outside schema, not ours |
| `runId` (acp spans, sdk events) | the run a span belongs to | pid | two-words | **picked 2026-10-28:** follows run id -> pid |

## sandbox/

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| `Sandbox` (`kind: none, os`, `start`) / `makeSandbox` / `SandboxOptions` / `layerNone` / `layerOs` / `settingsOf` | the sandbox a program runs in | sandbox ([sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime)) | ok | `kind` again |
| `Job` (sandbox) | one program to start in a sandbox | a command ([Docker, run](https://docs.docker.com/reference/cli/docker/container/run/)) | two-ideas | **picked 2026-10-28:** `SandboxCommand` |
| `Job.command`, `.args`, `.reads`, `.env`, `.mount`, `.credential` | its keys | `command`, `args`, `env` (Docker; Kubernetes container spec) | ok | |
| `Mount` (`_tag: none, worktree, commit`) / `.folder` | what is mounted besides the program | mounts, bind mounts ([Docker, bind mounts](https://docs.docker.com/engine/storage/bind-mounts/)); git worktree ([git worktree](https://git-scm.com/docs/git-worktree)) | ok | |
| `Credential` (`_tag: none, claude, codex`; `token`, `auth`) | the model credential a sandbox may hold | secrets ([GitHub Actions, secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)) | ok | |
| `SandboxError` (`why: key_in_sandbox, opens_home, no_start`, `what`) | why a sandbox did not start | none needed | ok | |
| `Workspace` (`root`, `home`, `tmp`, `work`) / `Launch` (`command`, `args`, `env`, `cwd`) / `cwdOf` / `envOf` / `keysOf` / `refuseKeys` / `Wrap` / `GITHUB_KEYS` | the sandbox's folders and what is started | `cwd`, `env` | two-ideas | `Launch` is also `shell/launch.ts` (the tsh launcher). `Spawn`. 55% |
| `Env` (sandbox) | the environment it is built from | environment | two-ideas | see claude/env's `Env` |

## mcp/

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| `serveAgent` / `AgentOptions` (`programsFor`, `person`, `tiles`) | serve programs to one agent over MCP | MCP server ([MCP, tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)) | ok | `person` follows user/person |
| `bridge` / `BridgeStopped` | stdio to the host's socket | a stdio bridge | ok | |
| `Handshake` (`type: handshake`, `version`, `agent`) / `HostAnswer` (`type: handshake, refused`) / `AGENTS_PROTOCOL` / `MAX_LINE` | the socket's first line | protocol version negotiation (MCP `initialize`) | ok | |
| `AgentName` (mcp) | an agent's name as the door takes one | none needed | collides | acp exports another `AgentName` (a harness name). This one stays. 70% |
| `Tool` (`name`, `description`, `inputSchema`) / `toolsOf` / `toolNameOf` (`<program>_<input>`) | a program input as an MCP tool | MCP tool fields `name`, `description`, `inputSchema` (same source) | ok | |
| `RUNS` / tool `runs` | the tool that lists what runs | `ps` | two-words | **picked 2026-10-28:** follows run -> process (`ps` or `processes`; the word is not picked) |
| `Call` (mcp: `kind: runs, input, refused`) / `callOf` | a tool call, read | `tools/call` (same source) | two-ideas | the third `Call`. `ToolCall`. 80% |
| `Drive` / `driveFor` / `InTile` (`run`, `program`) / `Answer` (`kind: done, refused`) | one agent's runs, driven by tool calls | tool result, `isError` (same source) | two-ideas | `Answer` again; `done` is an outcome verb. `ToolResult`, `kind: ok, refused`. 65% |

## What this cannot tell us


- Counts are rows, not names: a row often groups several names of one idea.
- Most links were written from known doc pages; only the ACP stop reasons and session updates, Temporal's run and workflow ids, OpenTelemetry's `process.pid` and MCP's tool fields were fetched this session. The bash manual pages answered HTTP 200 but their text was not re-read. The Codex link is a guess and is marked so.
- No proposal was tried on a reader; each confidence is one reader's judgment.
- Tests and fixtures were not swept; a name used only in tests has no row.
