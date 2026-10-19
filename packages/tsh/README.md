# @tea-fabrika/tsh

A shell that runs only tea programs. It is itself a tea program, with the job table as its one machine.

```text
$ packages/tsh/bin/tsh -c 'seq --to 3 | double'
double 2
double 4
double 6

$ packages/tsh/bin/tsh -c 'seq --to 3 | upper'
tsh: does not fit: seq's outputs (n: integer) fit no input of upper (text: string). Nothing was started
  seq --to 3 | upper
             ^
```

A host hands tsh its programs. This is all of `src/bin.ts`:

```ts
process.exitCode = await runTsh({list: programList(SMALL)});
```

## Where it sits

- One layer above tea-program (`layer-rules.json`).
- It imports only `@tea-fabrika/tea-program` of this repo, plus `@demlik/tea`, `effect` and OpenTelemetry.
- It lists no program of its own beyond the small ones. Fabrika's programs are handed in by `wip/src/tsh/`.
- Imported by `wip` only.

## What's in it

| Import | File | What it is |
|---|---|---|
| `@tea-fabrika/tsh` | `src/main.ts` | `runTsh(host)`: the launcher. A terminal, `-c '<lines>'`, a script file, or stdin |
| `./programs` | `src/programs.ts` | `programList`, the `Programs` and `JobStorage` services, exit status from how a run ended |
| `./small` | `src/small.ts` | The small programs: `say`, `seq`, `double`, `upper`, `sleep`, `true`, `false`, `tally` |
| `./shell` | `src/shell.ts` | `tsh` as a program: lines in, printed values out, no terminal in it |
| `./grammar` | `src/grammar.ts` | The line grammar: statements, `;` `&` `&&` `\|\|`, pipes, `--flag value`, `input=value`, `$( )` |
| `./check` | `src/check.ts` | A parsed line checked against the program list before anything starts |
| `./decode` | `src/decode.ts` | A word on a line read as a value of a program's own shape |
| `./builtins` | `src/builtins.ts` | `jobs`, `ps`, `tell`, `close`, `stop`, `attach`, `programs`, `help`, `exit`, and `--describe` |
| `./jobs` | `src/jobs.ts` | The job table machine |
| `./complete` | `src/complete.ts` | Tab completion, from the line typed so far |
| `./search` | `src/search.ts` | Ctrl-R history search |
| `./launch` | `src/launch.ts` | Command line and environment reading: `--json`, `-c`, `TSH_HOME`, `TSH_TRACE` |
| `./short` | `src/short.ts` | A sent value as one short line |
| `./title` | `src/title.ts` | What a typed line is called in a trace |
| `./trace/otel` | `src/trace/otel.ts` | Spans out over OTLP/HTTP |
| `./trace/view` | `src/trace/view.ts` | What a trace viewer is shown |

The bin is `bin/tsh`. It runs `src/bin.ts` with the small programs only.

Settings come from the environment:

- `TSH_HOME`: where job storage, history and the lock live. `~/.tsh` when unset.
- `TSH_TRACE`: `1` sends each line as a trace to `http://localhost:4318`. A url sends it there. Unset is off.

## Commands

| What | Command |
|---|---|
| Run with the small programs | `packages/tsh/bin/tsh` |
| Run with fabrika's programs | `bin/tsh` or `pnpm tsh` (see `wip/`) |
| Typecheck this package | `pnpm --filter @tea-fabrika/tsh typecheck` |
| Test this package | `pnpm vitest run packages/tsh` |
| Start or stop a local Jaeger for traces | `pnpm trace:up`, `pnpm trace:down` |
| Lint (whole repo, with the layer check) | `pnpm lint` |

Tests that drive fabrika's programs live in `wip/src/tsh/`, not here.

## See also

- [Experiment 67](../../experiments/67-tsh.md): tsh as a tea program.
- [Experiment 68](../../experiments/68-tracing.md) and [70](../../experiments/70-readable-traces.md): tracing.
- [Experiment 73](../../experiments/73-status-lines.md): status lines under `jobs`.
- [Experiment 82](../../experiments/82-monorepo.md): tsh split from fabrika's wiring.
- [`docs/direction/tea-program.md`](../../docs/direction/tea-program.md): what a host does with a program.
