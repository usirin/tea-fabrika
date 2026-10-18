# 82. The repo as a pnpm workspace: two packages, wip and legacy

Code and tooling only: no agent, no Jev, no GitHub, $0.

```
packages/tea-program   imports nothing else of this repo
packages/tsh           imports only @tea-fabrika/tea-program
programs/              empty, one package per runnable program later
wip                    everything still being shaped; may import any package
legacy                 the first-generation factory and the old operator
```

## What was asked

Turn the one-package repo into a pnpm workspace, fast, with escape hatches.
Move the code with `@demlik/structure-sweep move apply`. Turn path imports
between packages into package names. Add a gate that fails `pnpm lint` when an
import points the wrong way. Keep `tsh` and `tsh -c` exactly as they were.

## The layout

| Package | Name | Files | Code lines | Test lines | May import |
|---|---|---|---|---|---|
| `packages/tea-program` | `@tea-fabrika/tea-program` | 20 | 3,216 | 2,898 | nothing of ours |
| `packages/tsh` | `@tea-fabrika/tsh` | 25 | 3,779 | 517 | tea-program |
| `programs/` | none yet | 0 | 0 | 0 | packages |
| `wip` | `@tea-fabrika/wip` | 125 | 14,437 | 15,196 | packages, programs |
| `legacy` | `@tea-fabrika/legacy` | 73 | 16,658 | 11,285 | packages, programs, wip |

Each package has its own `package.json` (deps through `catalog:` and
`workspace:*`, `type: module`, an `exports` map) and its own `tsconfig.json`
that extends `tsconfig.base.json` at the root. Imports stay NodeNext with the
`.ts` on them. Node runs the files as they are, so each `exports` entry points
at a `.ts` file. Tests stay beside their code.

The root is still the workspace root. `pnpm typecheck` runs each package's
`tsc`. `pnpm test` is one vitest run over every package. `pnpm lint` is biome
and then the layer gate. `pnpm tsh`, `bin/tsh` and the `trace:*` scripts work as
before. The experiments stay at the root and import by relative path.

## What went where

- **tea-program** is all of the old `src/program/`. One change came first: its
  JSON Schema maker for Effect schemas moved in from `schema.ts`, and one test
  builds its Cmds from tea directly instead of from the moves.
- **tsh** is the shell without fabrika: the parser, the job table, the
  builtins, the small programs, the trace view and the OpenTelemetry setup. Its
  own `packages/tsh/bin/tsh` starts it with the eight small programs.
- **wip/src/tsh** is tsh's fabrika wiring: the program list with ship, review,
  build and operate in it, and the main that `bin/tsh` runs. Eight of tsh's
  tests live there too, because they drive fabrika's programs, the recorded
  GitHub answers or the sandbox.
- **legacy** is the first-generation factory (triage, lane, review, ship,
  factory, facts, vetting, route, the hosts) and the old operator (operate,
  operator, operator-host, turn, fabrika-cli, lane logs, watch).
- **wip** is the rest: the stage machines and programs, the ACP agent, the
  code host, the moves and combos, the sandbox, the env lists.

Four refactors came before the move, so the layers could hold at all:

1. tea-program stopped importing fabrika code.
2. The trace view takes the host's rules as an input.
3. tsh takes its program list, its trace rules and its title shortener as
   inputs. Fabrika's lists are passed in from wip.
4. The old `src/services.ts` was split. The services the stages use stayed in
   `wip/src/services.ts`. The factory's services went to
   `legacy/src/factory-services.ts`. `Worktrees` moved to `wip`. Stage code now
   needs nothing of the first-generation factory.

## How structure-sweep did

`move apply` read a manifest of 243 rows, one per file. Each row has an honest
placeholder: the feature is the target package, the role is `move`, and the
confidence is 1. The tool has no row for a plain move with no judgment behind
it.

It worked. It made its two commits: the rename and the import rewrite.
The rename moved 243 files. The rewrite changed 1,132 import specifiers in 255
files and ran biome on them clean.

What went wrong:

- **It stripped the `.ts` from every import it rewrote.** `"./check.ts"`
  became `"./check"`, in 1,128 places. It did so even in a type position,
  `import("./reviewer.ts").Reviewer`, where the target had not moved. Node and
  NodeNext cannot run code like that. Fix: turn on biome's
  `useImportExtensions` rule as an error, run its safe fix (253 files), and fix
  the three fixtures biome does not check and the one type import by hand. The
  rule stays on, so it cannot happen again unseen.
- **It cannot move a file that is not TypeScript.** It throws on the first
  one. The three terminal scripts tsh's tests run (`.exp`, `.tcl`) moved with
  `git mv` in a commit of their own.
- **It is slow here.** 9 minutes 29 seconds of wall time for 243 files.
- **Its stale-string report is noise at this size.** 14,406 entries: 444 from
  the manifest itself, 13,708 from data in `experiments/`, and the rest spread
  over field notes, fixtures and code. The real misses (paths in strings that
  tests read at run time) had to be found by running the tests. There were
  about 17, each fixed with one more `..`.
- Its commits carry no co-author line.

## The package-name pass

After the move, wip and legacy still reached into the packages by path,
for example `../../packages/tea-program/src/program.ts`. Each one became a
package name: `@tea-fabrika/tea-program`, `@tea-fabrika/tsh/small` and so on.
That is 182 specifiers in 64 files. Every package that imports another lists
it as `workspace:*`. pnpm keeps strict mode, so an undeclared one fails.

structure-sweep has no step for this. It was done by hand.

## The gate

`layer-rules.json` at the root lists the stack, top to bottom: legacy, wip,
programs, tsh, tea-program. An import may point down or sideways, never up.
`pnpm lint:layers` runs `code-graph . --layers --layer-rules layer-rules.json`
(code-graph 0.6.0). `pnpm lint` runs it after biome. It takes under one second.

Green: 182 imports down, 825 sideways, 0 up. The 182 down are the package-name
imports: code-graph follows a workspace package name to its file.

Red, with two bad imports added on purpose and then removed:

```
violations (2 upward import sites):
  packages/tea-program/src/mortal.ts:4  tea-program -> tsh  packages/tsh/src/builtins.ts:1  ("@tea-fabrika/tsh/small")
  wip/src/child.ts:3  wip -> legacy  legacy/src/claude.ts:1  ("../../legacy/src/claude.ts")
LAYER GATE FAILED.
```

Exit 1. Both kinds are caught: an import by package name and one by path.

The stack is a line, so it says a little more than was asked. Programs may not
import wip, and wip may import programs. Both seem right.

## Proofs

- `pnpm -s typecheck && pnpm -s lint && pnpm -s test`, twice: green both times,
  1,595 tests passed in 87 files each time. Main has 1,595.
- One test, `wip/src/agents/acp/kill.test.ts` ("kill -9 in the second of three
  turns"), failed once on an earlier run under heavy load and passed alone. It
  is timing-sensitive and was flaky before the move.
- tsh, same commands on main and on the branch, each with its own `TSH_HOME`:

```
$ bin/tsh -c 'seq --to 3 | double'
double 2
double 4
double 6
```

  The output of `bin/tsh -c 'programs'`, the same with `TSH_WORK=work`, and the
  line above were the same as on main, byte for byte. `pnpm tsh` runs it
  too. `packages/tsh/bin/tsh -c 'programs'` lists the eight small programs and
  nothing of fabrika.

## What is still in wip, and why

All of it imports itself tightly. Every stage imports `stages/outcome.ts`,
`stages/traced.ts`, `stages/status.ts` and `services.ts`. Review imports ship's
`Passed`. Build imports review's `reviewer.ts` and `pack.ts`. Operate imports
all three. The ACP agent imports the build stage's check. Pulling one stage out
now would pull the others with it.

## Next pulls, in order

1. **A small shared package for the stages**: outcome, traced, status, queue,
   and ship's `Passed` and facts shapes. Every stage needs these, and they need
   nothing back.
2. **A code-host package**: the `CodeHost` services, the GitHub reader and
   writer, CODEOWNERS.
3. **programs/ship.** No agent, the fewest imports after 1 and 2.
4. **programs/review**, then build, then operate.
5. **The ACP agent** as its own package, once env, the agent trace and the
   build check have a home below it.

Each pull is one manifest and one `move apply`, then a rules-file change.

## Recs

- **Keep this layout and merge it after a read.** The gate makes each next pull
  safe, and wip is an honest name for code that is not shaped yet. Confidence
  80%. The doubt: 125 files in wip is a lot, and wip may become the new `src/`
  if nothing is pulled out.
- **Tell structure-sweep about the stripped `.ts`.** A tool that moves code for
  NodeNext repos must keep the extension, in type positions too. It should also
  move non-TypeScript files, or skip them with a line, not throw. Confidence 90%.
- **Keep biome's `useImportExtensions` on.** It is what caught the stripped
  extensions, and it will catch a hand-written one. Confidence 90%.
- **Make the experiments a package of their own later.** Today the root keeps
  its old dependencies for them, and Node finds those from any package, so a
  package can use a dependency it does not declare and still run. Confidence
  65%: it is real, but nothing has gone wrong from it yet.
- **Next pull is the shared stage package, then programs/ship.** Confidence 70%:
  the import counts say so, but the shape of the shared package was not tried.

## Left as it was

- About 330 mentions of `src/` paths in code comments were not rewritten. Many
  now name the old place.
- `docs/` and older experiment write-ups name the old paths. They describe the
  repo as it was.
- The experiments index has no rows for 78 to 81.
