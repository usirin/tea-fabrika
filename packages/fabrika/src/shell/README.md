# shell: tsh, in `@kampus/fabrika`

A part of [`@kampus/fabrika`](../../README.md). It was the package `@tea-fabrika/tsh` until
experiment 103.

A shell that runs only tea programs. It is itself a tea program, and a view on its host's job
table: the host keeps the jobs, tsh shows them and asks for changes, as a shell shows the
kernel's process groups (`../host/jobs.ts`, `../host/host-jobs.ts`).

```text
$ packages/fabrika/bin/tsh-small -c 'seq --to 3 | double'
double 2
double 4
double 6

$ packages/fabrika/bin/tsh-small -c 'seq --to 3 | upper'
tsh: does not fit: seq's outputs (n: integer) fit no input of upper (text: string). Nothing was started
  seq --to 3 | upper
             ^
```

An app hands tsh its programs as the `Programs` service, and `runTsh` runs it. This is a whole
bin, the one `fixtures/acp-tsh/tsh.ts` is:

```ts
import {Shell} from "@kampus/fabrika";
import {acpEntry} from "@kampus/fabrika/agents/acp";
import {runTsh} from "@kampus/fabrika/shell";
import {Effect} from "effect";

const programs = Shell.programList([...Shell.SMALL, acpEntry]);
process.exitCode = await Effect.runPromise(
	runTsh().pipe(Effect.provideService(Shell.Programs, programs)),
);
```

`runTsh` takes two optional things the app knows and tsh does not: `viewing`, how its traces show
a value, and `short`, what a typed line is called in a trace. `@kampus/pipeline` passes both.

A program with a window (`viewOf` in `../program`) is run in the foreground with its inputs left
open, since its window tells them, as a terminal feeds a foreground program's stdin. tsh waits
for its end or Ctrl-C, as for any foreground line (`execute.ts`, `window.test.ts`). The fabrika
app ([`apps/fabrika`](../../../../apps/fabrika/README.md)) is where such a window is drawn.

A job whose kept state was saved by older code cannot be opened: its machine's state schema does
not take it. `attach` says so, and the job stays in the table, detached, with its state as it
was. Every other job still opens. A job table saved by older code is left as it was too: tsh says
so once, and runs on without keeping its jobs (`execute.test.ts`, `shell.test.ts`).

Whatever starts tsh hands it the host's jobs, as the `HostJobs` service. `runTsh` opens them in
the home (`openJobs`); a test opens its own; the fabrika app opens one for its host process and
hands it to every tile's tsh, so a job is the same `%n` in every tile. Job numbers count up and
are never given twice, as WezTerm's and tmux's ids:

```ts
const jobs = yield* openJobs(memoryStorage()); // the host's table, for the caller's scope
const started = yield* start(tsh, {show: "short"}, outputs, {id, storage}).pipe(
	Effect.provideService(Shell.Programs, programs),
	Effect.provideService(HostJobs, jobs),
);
```

When tsh leaves, it detaches only the jobs it runs. A line is one job and one trace: its first
program's run id names the trace, and each program of the line has its run span there
(`line-trace.laws.test.ts`).

```text
tsh$ attach %1 &
[1] attached tally:7f3a...
[1] this job was saved by older code, can't open it  tally
[1] it stays in the table, detached; stop %1 drops it
```

`Shell.Printed` and `Shell.Ready` are the schemas of tsh's two outputs, for an app that builds
its own schemas on them.

## Where it sits

- One layer above `program` and `host` (`layer-rules.json`).
- It imports only `../program` and the host's jobs (`../host/jobs.ts`, `../host/host-jobs.ts`) of this repo, plus
  `@demlik/tea`, `effect` and OpenTelemetry.
- It lists no program of its own beyond the small ones. Since experiment 114 the pipeline's
  programs are handed in by `@kampus/pipeline` (`packages/pipeline/src/tsh/`), through the public
  names below.

## What's in it

What an app needs is public, in two places:

- `Shell`, a namespace on the top level (`./index.ts`): the program list (`programList`,
  `Programs`, `SMALL`), tsh as a program (`tsh`), and the parts a test of a line
  uses (`parse`, `check`, `complete`, `describe`, `EMPTY`, `shapeLines`, `typeOf`, `Shorten`).
  `Search` is the Ctrl-R search (`search.ts`), for a line editor an app writes itself, as the
  fabrika app does. None of it names a platform. The jobs tsh shows are the host's: `HostJobs`
  and `openJobs` are on the top level too (`../host/host-jobs.ts`).
- `@kampus/fabrika/shell`: `runTsh` and `homeOf`. The launcher holds a terminal, files and
  OpenTelemetry, so it is a subpath, not the top level.

The trace files are on `@kampus/fabrika/otel`.

| File | What it is |
|---|---|
| `index.ts` | The `Shell` namespace: what the top level shows of this part |
| `main.ts` | `runTsh(options)`: the launcher. A terminal, `-c '<lines>'`, a script file, or stdin |
| `programs.ts` | `programList`, the `Programs` service, exit status from how a run ended |
| `small.ts` | The small programs: `say`, `seq`, `double`, `upper`, `sleep`, `true`, `false`, `tally` |
| `shell.ts` | `tsh` as a program: lines in, printed values out, no terminal in it |
| `grammar.ts` | The line grammar: statements, `;` `&` `&&` `\|\|`, pipes, `--flag value`, `input=value`, `$( )` |
| `check.ts` | A parsed line checked against the program list before anything starts |
| `decode.ts` | A word on a line read as a value of a program's own shape |
| `builtins.ts` | `jobs`, `ps`, `tell`, `close`, `stop`, `attach`, `programs`, `help`, `exit`, and `--describe` |
| `complete.ts` | Tab completion, from the line typed so far |
| `search.ts` | Ctrl-R history search |
| `launch.ts` | Command line and environment reading: `--json`, `-c`, `TSH_HOME`, `TSH_TRACE` |
| `short.ts` | A sent value as one short line |
| `title.ts` | What a typed line is called in a trace |
| `trace/otel.ts` | Spans out over OTLP/HTTP. On `@kampus/fabrika/otel` |
| `trace/view.ts` | What a trace viewer is shown. On `@kampus/fabrika/otel` |

The dev script is `packages/fabrika/bin/tsh-small`. It runs `bin.ts` with the small programs
only. The package installs no command: since experiment 114 the one `tsh` is `@kampus/pipeline`'s.

Settings come from the environment:

- `TSH_HOME`: where job storage, history and the lock live. `~/.tsh` when unset.
- `TSH_TRACE`: `1` sends each line as a trace to `http://localhost:4318`. A url sends it there. Unset is off.

## Commands

| What | Command |
|---|---|
| Run with the small programs | `packages/fabrika/bin/tsh-small` |
| Run with the pipeline's programs | `bin/tsh` or `pnpm tsh` (see `packages/pipeline/`) |
| Typecheck the package | `pnpm --filter @kampus/fabrika typecheck` |
| Test this part | `pnpm vitest run packages/fabrika/src/shell` |
| Start or stop a local Jaeger for traces | `pnpm trace:up`, `pnpm trace:down` |
| Lint (whole repo, with the layer check) | `pnpm lint` |

Tests that drive the pipeline's programs live in `packages/pipeline/src/tsh/`, not here. Two
groups of tests that name no pipeline program came here in experiment 114: `decode.test.ts` (a
word read as a value) and `launch.test.ts` (Ctrl-R and the command line).

## Not in it yet

- The standard laws for the job table (`../host/jobs.ts`) and the small programs' machine in
  `small.ts`. `packages/pipeline/src/laws/standard.test.ts` holds every machine in the pipeline
  and in fabrika's `agents/` to its laws, and leaves these out.

## See also

- [Experiment 67](../../../../experiments/67-tsh.md): tsh as a tea program.
- [Experiment 68](../../../../experiments/68-tracing.md) and [70](../../../../experiments/70-readable-traces.md): tracing.
- [Experiment 73](../../../../experiments/73-status-lines.md): status lines under `jobs`.
- Experiment 82 in the [experiments index](../../../../experiments/README.md): tsh split from fabrika's wiring.
- [Experiment 103](../../../../experiments/103-move-without-loss.md): moved into `@kampus/fabrika`.
- [Experiment 114](../../../../experiments/114-the-pipeline-moves-out.md): the pipeline moved out;
  the public names an app hands tsh its programs with.
- [`docs/direction/tea-program.md`](../../../../docs/direction/tea-program.md): what a host does with a program.
