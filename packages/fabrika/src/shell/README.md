# shell: tsh, in `@kampus/fabrika`

A part of [`@kampus/fabrika`](../../README.md). It was the package `@tea-fabrika/tsh` until
experiment 103.

A shell that runs only tea programs. It is itself a tea program, with the job table as its one machine.

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

A host hands tsh its programs. This is all of `bin.ts`:

```ts
process.exitCode = await runTsh({list: programList(SMALL)});
```

## Where it sits

- One layer above `program` and `host` (`layer-rules.json`).
- It imports only `../program` of this repo, plus `@demlik/tea`, `effect` and OpenTelemetry.
- It lists no program of its own beyond the small ones. Fabrika's programs are handed in by `../pipeline/tsh/`.
- Imported by `../pipeline/tsh/` only.

## What's in it

Only the trace files are public, on `@kampus/fabrika/otel`. The rest is used inside the package,
by fabrika's tsh in `../pipeline/tsh/`.

| File | What it is |
|---|---|
| `main.ts` | `runTsh(host)`: the launcher. A terminal, `-c '<lines>'`, a script file, or stdin |
| `programs.ts` | `programList`, the `Programs` and `JobStorage` services, exit status from how a run ended |
| `small.ts` | The small programs: `say`, `seq`, `double`, `upper`, `sleep`, `true`, `false`, `tally` |
| `shell.ts` | `tsh` as a program: lines in, printed values out, no terminal in it |
| `grammar.ts` | The line grammar: statements, `;` `&` `&&` `\|\|`, pipes, `--flag value`, `input=value`, `$( )` |
| `check.ts` | A parsed line checked against the program list before anything starts |
| `decode.ts` | A word on a line read as a value of a program's own shape |
| `builtins.ts` | `jobs`, `ps`, `tell`, `close`, `stop`, `attach`, `programs`, `help`, `exit`, and `--describe` |
| `jobs.ts` | The job table machine |
| `complete.ts` | Tab completion, from the line typed so far |
| `search.ts` | Ctrl-R history search |
| `launch.ts` | Command line and environment reading: `--json`, `-c`, `TSH_HOME`, `TSH_TRACE` |
| `short.ts` | A sent value as one short line |
| `title.ts` | What a typed line is called in a trace |
| `trace/otel.ts` | Spans out over OTLP/HTTP. On `@kampus/fabrika/otel` |
| `trace/view.ts` | What a trace viewer is shown. On `@kampus/fabrika/otel` |

The bin is `packages/fabrika/bin/tsh-small`. It runs `bin.ts` with the small programs only.

Settings come from the environment:

- `TSH_HOME`: where job storage, history and the lock live. `~/.tsh` when unset.
- `TSH_TRACE`: `1` sends each line as a trace to `http://localhost:4318`. A url sends it there. Unset is off.

## Commands

| What | Command |
|---|---|
| Run with the small programs | `packages/fabrika/bin/tsh-small` |
| Run with fabrika's programs | `bin/tsh` or `pnpm tsh` (see `../pipeline/`) |
| Typecheck the package | `pnpm --filter @kampus/fabrika typecheck` |
| Test this part | `pnpm vitest run packages/fabrika/src/shell` |
| Start or stop a local Jaeger for traces | `pnpm trace:up`, `pnpm trace:down` |
| Lint (whole repo, with the layer check) | `pnpm lint` |

Tests that drive fabrika's programs live in `../pipeline/tsh/`, not here.

## Not in it yet

- Laws for the shell's two machines (`jobs.ts` and the small programs' machine in `small.ts`).
  `../pipeline/laws/standard.test.ts` holds every machine in `pipeline/` and `agents/` to its
  laws, and leaves this part out.

## See also

- [Experiment 67](../../../../experiments/67-tsh.md): tsh as a tea program.
- [Experiment 68](../../../../experiments/68-tracing.md) and [70](../../../../experiments/70-readable-traces.md): tracing.
- [Experiment 73](../../../../experiments/73-status-lines.md): status lines under `jobs`.
- Experiment 82 in the [experiments index](../../../../experiments/README.md): tsh split from fabrika's wiring.
- [Experiment 103](../../../../experiments/103-move-without-loss.md): moved into `@kampus/fabrika`.
- [`docs/direction/tea-program.md`](../../../../docs/direction/tea-program.md): what a host does with a program.
