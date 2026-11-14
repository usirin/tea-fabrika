---
state: "decided 2026-11-08"
summary: "`next/`. A program has no main; the runner owns the loop. The Cmds `init` returns run once per process start, as OTP's `init/1`: each is saved as dispatched, tied to its process id, before it runs, and its answer comes back as a letter. A wake and a hot reload run none; a restart is a new process and runs them again, under the restart brake. Today's stepper drops them."
---

# init's Cmds run once per process start

**Decided 2026-11-08.** `next/` only.

Its decided rules are in: [0253](../../.decisions/0253-init-cmds-run-once-per-process.md).

```ts
// A sketch: a made-up program whose init asks for setup work.
import {Cmd, Machine} from "@demlik/tea/effect";
import {Program} from "@kampus/libfabrika";
import {Schema} from "effect";

const Ticket = Schema.Struct({id: Schema.String, title: Schema.String});
const readTickets = Cmd.make("tickets_read", {
	input: Schema.Struct({}),
	ok: Schema.Array(Ticket),
	err: ["unknown"],
});

export const inboxMachine = Machine.make({
	model: Schema.Struct({tickets: Schema.NullOr(Schema.Array(Ticket))}),
	msg: Schema.Union([Schema.Struct({type: Schema.Literal("refresh")})]),
	cmds: [readTickets],
	// init returns the model AND Cmds, as Elm's init returns (Model, Cmd msg).
	init: (loaded) => [loaded ?? {tickets: null}, [readTickets({})]],
	update: {
		refresh: (m) => [m, [readTickets({})]],
		tickets_read_ok: (_m, msg) => [{tickets: msg.value}, []],
	},
});

export const inbox = Program.make({name: "inbox", machine: inboxMachine, view: (m) => m});
```

A program has no `main`. All its business logic is a machine, and libfabrika's runner owns the loop,
as Elm's runtime and OTP's `gen_server` do. The Cmds init returns run once per process start.

## The four cases

- **A new process.** The runner calls `init(null)`. For each Cmd init returns, it saves a
  dispatched entry first, then runs the Cmd. The answer comes back as a normal Msg
  (`tickets_read_ok`), saved as a letter before the program sees it.
- **A wake.** Same process, so the runner rebuilds the model from the ledger and runs no init Cmd.
  They are already recorded as dispatched. One with no answer stays visible as dispatched, and is
  not fired again.
- **A hot reload.** The new code builds the model, as [hot reload](./hot-reload.md) says. Nothing new
  runs, even if the new init returns different Cmds. A person who wants them presses restart.
- **A restart.** A restart is a new process with its own id, so setup runs again. If init's Cmd
  crashes the program every time, the decided restart brake (C4 in
  [the five layers](./a-local-first-sync-engine.md), built in P34) stops the loop.

```text
start   process_A   init -> 1 Cmd   dispatched process_A/init/0, runs, answer is a letter
wake    process_A   no Cmd runs     process_A/init/0 is already on the record
reload  process_A   no Cmd runs     new code, same process
restart process_B   init -> 1 Cmd   dispatched process_B/init/0, runs
```

## Which version

- **`next/`:** this note. Today the stepper drops init's Cmds:
  `next/packages/libfabrika/src/app/program.ts` keeps only the model from `machine.init` and
  prepares the step with no Cmds. The runner calls `init` the same way on a fresh start and on a
  wake. That is the gap this closes.
- **Today's version:** not changed by this note.

## The known way

- **Elm:** `init : flags -> (Model, Cmd Msg)`. The runtime runs the Cmd once, when the program
  starts, and feeds the answer back through `update`
  ([Browser.element](https://package.elm-lang.org/packages/elm/browser/latest/Browser#element)).
- **Erlang/OTP:** `gen_server`'s `init/1` runs once per process, when it starts. A supervisor's
  restart starts a new process and calls `init/1` again
  ([gen_server](https://www.erlang.org/doc/apps/stdlib/gen_server.html),
  [supervisor](https://www.erlang.org/doc/apps/stdlib/supervisor.html)).
- We follow both. The one extra step is ours: the dispatched entry is saved before the Cmd runs,
  because our process can be evicted from memory and must rebuild its state from the ledger when it
  wakes. An Erlang process that hibernates keeps its state, so it never has to ask what it already
  ran.

## What the ledger records

Each init Cmd gets the same dispatched entry a step's Cmd gets today, tied to the process id that
ran it:

```ts
// A sketch. The id's middle part is the plan's call; `init` is the lean.
{id: "process_01j…/init/0", cmd: {type: "tickets_read"}, state: "dispatched",
 parent: null, traceId: "t1", build: "67896c9f..."}
// then, when it answers, a letter:
{id: "process_01j…/init/0/answer", ...}  // folds as {type: "tickets_read_ok", value: [...]}
```

**What fact would be lost without it.** Whether this process already asked for its setup. Without
the entry, a wake cannot tell "never ran" from "ran, and the answer is lost". It would either fire
the Cmd again or drop it. Who asked (the process id), with which build, and on which trace are only
known when the Cmd is made. They cannot be rebuilt later.

## What it costs

- The stepper's `init` hands back Cmds, checked like a step's. The runner tells a new process from a
  wake by the process id on the record. One plan, one pull request, with laws (tracker ticket 292).
- One dispatched entry per init Cmd per process start.
- A program with heavy setup pays for it on every restart. The brake bounds a loop; it does not make
  setup cheap.

Sure: about 90%. Elm and OTP agree, and the runner already saves a step's Cmds this way.

## What it cannot tell us

- Whether an init Cmd should finish before the first input is stepped. Elm does not wait. OTP does:
  `init/1` returns before the process takes a message, and `handle_continue/2` runs before any
  message too. This note does not wait, and a real program may show it should.
- Saving the entry first does not make an outside effect happen once. A crash between the run and
  its answer leaves the Cmd dispatched, and the runner does not guess.
- How the id reads (`init` as its middle part) until the plan writes it.
