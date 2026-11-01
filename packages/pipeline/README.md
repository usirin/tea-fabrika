# @kampus/pipeline

The work pipeline: the stage machines and their programs, the services they talk to, and the tsh
that lists them. It is an app on [`@kampus/fabrika-old`](../fabrika/README.md), and uses only that
package's public names.

- **The name is a placeholder.** `@kampus/pipeline` is a working name, from experiment 114. The
  pipeline's own name is still open.
- It was a part of `@kampus/fabrika-old` (`packages/fabrika/src/pipeline/`) from experiment 103 to
  114, and most of the package `@tea-fabrika/wip` before that.
- It is `"private": true`, ESM only, for Node 26 and up, like fabrika.

```sh
bin/tsh -c 'programs'                         # the small ones, acp, ship, review-scripted, build, operate, the desk
bin/tsh -c 'ship --help'                      # how to run it: usage, flags, inputs, outputs, pipes
bin/tsh -c 'ship --mode read pr=<pull request url>'   # reads only: says what ship would send
bin/tsh -c 'review-scripted --rubrics <folder> pr=<pull request url> | ship --mode read'
bin/tsh -c 'desk-demo
answer --ask plan:kamp-us/demlik#393@1 --reply approve
desk'                                         # the owner's desk on experiment 89's cases
```

`review`, `plan` and `deliver`, with live agents, are listed too when `tsh.toml` names a `clone`.

The owner's desk (`src/tsh/desk.ts`):

- `desk`: starts the `asks` core with the packs the `packs` line of the repository's `fabrika.toml` names, each with its own `[pack."<name>"]` table. Prints the inbox, the replies that fit, and where the pages are.
- `fabrika.toml` is read once, when tsh starts, from one place. When `tsh.toml` names a target (`repo` or `clone`): the target's file as committed on its default branch, read in its clone. Otherwise: the root of the repository tsh is started in (the nearest folder up that holds `.git`; outside any repository, the folder itself). tsh's first line on stderr says which. Packs are always found from the start folder's root, where fabrika is installed. See `src/settings-source.ts`. A `tsh.toml` that still lists packs stops tsh and says to move them.
- `desk-demo`: the same on a fresh ledger of experiment 89's cases (`src/asks/demo.ts`). Packs get no settings. Pages go under `<TSH_HOME>/desk-demo/`, cleared each time.
- `answer --ask <id> --reply "<reply>"`: hands a typed reply to the first pack with a `shell` (owner-desk). Prints the inbox again, or fails with the replies that fit.
- The desk, operate and the review record keep their facts on one tea-host ledger (`src/asks/ledger.ts`): in tsh, a node:sqlite file per target repository, `<TSH_HOME>/ledgers/github/<owner>/<name>.sqlite` when `tsh.toml` names a `repo`, else `<TSH_HOME>/ledgers/folders/<name>-<hash>.sqlite` (`ledgerFile` in `src/tsh/config.ts`). Every tsh on one repository shares it, so one lane works a ticket across shells, and the desk's facts last from one `bin/tsh -c` to the next. A lane holds its ticket with the ledger's lease on the ticket's name (`src/asks/claims.ts`). `desk-demo` keeps a fresh ledger in memory.
- A real desk's pack folder is `<TSH_HOME>/packs/<pack>` unless its settings name one.

## How it hands tsh its programs

fabrika ships tsh as a library and installs no command. This package installs the one `tsh`,
which hands tsh the whole list. The heart of `src/tsh/fabrika-main.ts`:

```ts
import {Shell} from "@kampus/fabrika-old";
import {runTsh} from "@kampus/fabrika-old/shell";

const programs = programsOf(config, process.env.TSH_SCRIPTED, desk, ledger, setup); // a Shell.ProgramList
process.exitCode = await Effect.runPromise(
	runTsh({viewing: FABRIKA_VIEWING, short: refOf}).pipe(
		Effect.provideService(Shell.Programs, programs),
	),
);
```

`viewing` is how the pipeline's traces show its values (`src/trace/viewing.ts`); `short` names a
typed line by the pull request or ticket it is about.

## Where it sits

- Below `programs/`, `wip`, `legacy` and `packs`; above every part of `@kampus/fabrika-old`
  (`layer-rules.json`).
- It imports fabrika by its public names only: the top level and its subpaths. Two checks hold
  that:
  - `exports` in fabrika's `package.json` lists every subpath there is, so a deep import such as
    `@kampus/fabrika-old/program/shape` does not resolve, and `pnpm typecheck` fails.
  - `pnpm lint:boundaries` (`boundary-rules.json`) fails on a relative import into another
    package, and on fabrika importing this package.
- Imported by `wip`, `legacy` and every pack under `packs/`, by name.

## What's in it

The `exports` map has `"./*": "./src/*.ts"`, so any file is importable as
`@kampus/pipeline/<path>`. Paths below are under `src/`.

| Folder or file | What it holds |
|---|---|
| `stages/outcome.ts` | The five verbs every stage answers in (`done`, `send`, `ask`, `skip`, `stuck`), `outcomesOf` and `nameOf` |
| `stages/ship/` | The ship machine and the `ship` program |
| `stages/review/` | The review machine and the `review` program |
| `stages/build/` | The build machine and the `build` program |
| `stages/plan/` | The plan machine and the `plan` program |
| `stages/test-writer/` | The test writer machine, built from the combos: one test per Property, run on the plan's base. No program yet |
| `stages/operate/` | The operate loop and the `operate` program |
| `stages/queue.ts`, `status.ts`, `traced.ts`, `rules.ts` | Shared by the stages: the kept work queue, status lines, trace drawings, the repo's agent rules |
| `tickets/` | A ticket's facts and the fold (`ticket.ts`: the tracker's four, a lane's nine), what an approval covers and what takes it back (`approval.ts`), and `Tickets`, the service a lane reads and writes a ticket through, on the ledger or in memory (`tickets.ts`). The tracker imports these |
| `experiments/` | An experiment's facts and the fold, its runs, their metrics and cases, a comparison of two runs, each drawn as markdown (`experiment.ts`); `Experiments`, the service they are read and written through, on the ledger (`experiments.ts`); the importer for the old write-ups and results files (`import.ts`). The `experiments`, `experiment` and `compare` programs import these. Experiment 170 |
| `asks/` | The `asks` core program: what waits on the owner, kept in a ledger. `packs.ts` wires add-on packs to it. `demo.ts` is the demo ledger |
| `hosted/` | The stages run as programs on a tea host, and the lane over them |
| `criteria/` | A plan's criteria, each under an id it keeps, and where verdicts are kept |
| `laws/` | The law checker (`explore.ts`) and the laws of each machine, fabrika's host and agents too |
| `tsh/` | The pipeline's tsh: `tsh.toml` reading (`config.ts`), the program list (`fabrika-list.ts`), the owner's desk (`desk.ts`), the launcher (`fabrika-main.ts`) |
| `tsh.ts` | The bin: looks for the optional peers, then runs `tsh/fabrika-main.ts` |
| `settings.ts` | The repository's `fabrika.toml`: its schema, its three load rules, and `repoOf`, which finds the repository's root |
| `settings-source.ts` | Where `fabrika.toml` is read from: a target's committed default branch, or the start folder; and the line tsh prints about it |
| `setup.ts` | What tsh needs before a live stage runs: rubrics, a clone, the agent's login |
| `trace/viewing.ts` | The pipeline's trace view rules. An agent's spans are fabrika's, on `@kampus/fabrika-old/agents/trace` |
| `primitives.ts`, `combos.ts` | The six moves (Gather, Act, Listen, Draft, Check, Judge) and the combos built from them |
| `schema.ts`, `refine.ts` | `zodCmd`, the zod slot of a Cmd; the draft-and-vet child |
| `draft-scripted.ts` | A scripted stand-in for the Agent SDK's stream, for tests |
| `services.ts` | The services the stages talk to |
| `jev-live.ts` | The live `Jev`: one HTTP call each, a spend cap checked before each call, and a receipt per call (`JevReceipts`). `jevFromConfig` reads `TYPESAFE_API_KEY` and fails to build without it. No test builds it |
| `tickets/duplicates.ts` | The duplicate hint at filing: the cheap filter (`candidatesOf`), the Jev question (`duplicateJudge`), the ranking at the floor (`hintsOf`). Experiment 167 |
| `code-host-github.ts`, `code-host-github-writes.ts`, `code-host-local.ts`, `codeowners.ts` | `CodeHost` and `CodeHostWrites` over GitHub, and `CodeHost` over a local git copy |
| `sandboxes.ts` | What is mounted in each stage's sandbox: nothing, a worktree, or the commit; a model credential only where an agent runs. `sandboxes.test.ts` plants an `env \| curl` line in every stage's sandbox |
| `child.ts` | One command run to its end |
| `ids.ts`, `entity.ts`, `verdict.ts`, `check-runs.ts`, `local-checks.ts`, `worktrees.ts` | Ids, ledger entities, reading today's review verdicts, check runs, working copies |
| `sh.ts`, `comments.ts` | One command run through `execFile`, and `isMachines`: which issue comments a machine wrote. Both were in `wip/src/operator-live.ts`, which stays in `wip` with the old operator's live Layers |
| `../rubrics/` | The rubric texts the review stage ships with |

Moved to `@kampus/fabrika-old` in experiment 114, because nothing in them is the pipeline's:

- `draft.ts` (a Draft over the Agent SDK) and the reader half of `schema.ts`: `@kampus/fabrika-old/agents/claude`.
- `env.ts`, `shell-guard.ts` and the sandbox half of `stages/build/check.ts`: `@kampus/fabrika-old/agents/sandbox`. The builder's own rules (`builderRefusal`, `builderCheck`) stay here.
- `trace/agent.ts` and `trace/sdk-events.ts`: `@kampus/fabrika-old/agents/trace`.

### More on some of these

- `stages/outcome.ts`: the one shape every stage machine answers in.
  - Five verbs, and one way to spell an answer: `send:builder:checks_red`, `ask:owner:approval`, `done:part`.
  - A stage writes only its own words (`outcomesOf`). `nameOf` makes the name from the data.
  - The name's pattern is a type, so a misspelled name does not compile.
- `stages/ship/`: one pull request in, one typed outcome out, no agent ([`docs/ship-machine.md`](../../docs/ship-machine.md)).
  - `outcome.ts`: its own words for the five verbs, 24 names in all.
  - `facts.ts`: the facts it reads. `gate.ts`: go, wait, or the one reason not to.
  - `ready.ts`: "ready to merge" as a value that exists only with its proof: a passing verdict row for every criterion at the head, and green checks at that head. The enqueue and merge Cmds take nothing else.
  - `machine.ts`: read the facts, pass the gate, put the head in the merge queue (or merge it when the repository has no queue), listen to the queue, tidy up.
    - It waits for checks that are still running, and runs red checks again once before the builder is called. Both waits have a limit.
    - A machine is made with its own limits: `createShip({ waits })`. Nothing is read from the computer it runs on.
  - `handlers.ts`: its handlers and the runners of its two Listens, the reads kept apart from the writes.
  - `look.ts`: the machine stepped as far as its first write or wait, with that write handed back, never sent.
  - `program.ts`: the `ship` program, the thing you start. A mode as its flag, pull requests told on its input `pr` at any time, a fresh run of the machine per pull request, one at a time. `CodeHost` and `CodeHostWrites` come through Effect's context.
  - `run.ts`, with `launch.ts` behind it: `node packages/pipeline/src/stages/ship/run.ts <pull request url>... --own <account>` only reads. It prints the facts, the machine's answer and the write it would send. With `--write` the machine runs to its end on each pull request. A url that is not a pull request's answers `bad_shape` before anything runs. Every option is in the comment at the top of the file.
  - Its live runs: [experiment 56](../../experiments/56-first-live-run-of-the-ship-machine.md), and [63](../../experiments/63-ship-as-a-program.md) for ship as a program.
- `stages/review/`: one pull request at one head commit in, one typed outcome and a report out ([`docs/review-machine.md`](../../docs/review-machine.md), last section).
  - `pack.ts`: code reads everything a reviewer needs. `gate.ts`: stops before any agent when a required check is red or the pack is not whole.
  - `reviewer.ts`: the one agent. It gets a copy of the code at the commit, three read tools (Read, Grep, Glob) and the tools its machine opens to it (`tools.ts`, such as filing a note), and fills a form of rows and findings.
  - `sheet.ts`: code checks the form and gives each finding an id. A form it refuses goes back to a new run with its problems, up to a limit of tries.
  - `verdict.ts`: the verdict of each kind. `render.ts`: the comment's text.
  - `machine.ts`: the review machine around the reviewer. `program.ts`: the `review` program. It only reads: a note the reviewer files goes out on the output `note`, and nothing is posted.
  - `outcome.ts`: its own words for the five verbs, 19 names in all.
  - `run.ts`: `node packages/pipeline/src/stages/review/run.ts <pull request url> --rubrics <folder> --repo <local clone>`. It prints the notes, the verdict, the comments it would post, and the cost. Every option is in the comment at the top of the file.
  - The rubric texts tsh hands the live `review` are in `rubrics/`, unless `tsh.toml` names a folder.
  - Tested on recorded answers under `fixtures/review/`, with a scripted reviewer. Its real runs: [`docs/review-machine.md`](../../docs/review-machine.md), "The three runs beside today's reviewer".
- `code-host-github.ts`, `codeowners.ts`: `CodeHost` on GitHub, the read side only.
  - A pull request's facts for the ship gate, read through `gh` GraphQL calls at one head commit.
  - The owner's approval comes from the base branch's CODEOWNERS (which files are protected, who owns them) and the approving reviews at the head.
  - The kinds of review a change needs come from the files it touches and the repo's `.fabrika.jsonc`.
  - Where a fact cannot be read it is `unknown`, never a guess. `NOT_READ` lists what a fact still cannot be taken for.
  - Two waits, the checks and the merge queue, each a read asked again every `pollMs`. The queue's wait says a pull request was thrown out only on GitHub's own record of it, never on one "not in the queue" answer.
  - `readChange` reads a change for a review: the pull request at one commit, its ticket's text, the files and the whole diff against the base, and the required checks.
  - Tested on recorded answers under `fixtures/code-host/` and `fixtures/review/`.
- `code-host-github-writes.ts`: `CodeHostWrites` on GitHub. Every write the ship machine makes on a pull request is listed whole at the top of the file.
  - Put a head in the merge queue. GitHub itself refuses when the head is no longer that commit.
  - Merge a head straight in, only on a repository with no merge queue.
  - Start the failed jobs of red runs again.
  - Never "merge when ready", a deleted branch, an owner's bypass, a label or a comment.
  - Tested against a scripted `gh`, every argument list checked whole.
- `primitives.ts`: the six moves every step is made of, each an Elm thing with one rule.
  - Gather: a Cmd that only reads.
  - Act: a Cmd that carries a name for its one write, kept in the state first, so a restart never writes twice.
  - Listen: a Sub.
  - Draft: an agent's run as a Sub over the Agent SDK's stream (fabrika's `createDraft`), its conversation named up front and its answer typed by a schema.
  - Check: a pure function, or a Cmd when it runs code.
  - Judge: one Jev question with fixed choices. The floor is applied in update. `createYesNoJudge` is the one-answer kind: a `noul`, 0 to 1, read as `{yes}`.
- `schema.ts`: a move's Cmd is tea's own `Cmd.define` from `@demlik/tea/effect`; the one Cmd part kept here is `zodCmd`, for a spec with a zod slot, which tea's Effect `Cmd.define` does not take. It goes when the repo is off zod. What a Draft needs from its output schema (the JSON Schema the Agent SDK takes, and a reader for the answer) is fabrika's, on `@kampus/fabrika-old/agents/claude`.
- `combos.ts`: the moves joined, as data and pure functions a parent calls: refine (Draft and Check in a loop), gate (pass, or park with why), ask (post a question, listen for replies, read each by code or a Judge into one of a fixed set of answers), remember (write, then read back) and spawn (a child per item).
- `refine.ts`: draft and vet, a small child machine made per use. `createRefine({ name })` names its Cmds `<name>_write` and `<name>_check`. A writer agent turn, a checker in code, the checker's problems back to the writer in the same conversation, up to a limit, then it stops for its parent. Triage's enrichment in `legacy` is its first use.
- `laws/standard.test.ts`: every machine in this package and in fabrika's `src/agents/` held to its laws. fabrika's agents are read from fabrika's folder on disk, found through its `package.json`; `laws/tea-host.ts` walks fabrika's host machines through its public names.

## Commands

| What | Command |
|---|---|
| Run the pipeline's tsh | `bin/tsh`, `pnpm tsh`, or `packages/pipeline/bin/tsh` (reads `./tsh.toml`, and `fabrika.toml` at the repository's root) |
| Typecheck the package | `pnpm --filter @kampus/pipeline typecheck` |
| Test the package | `pnpm vitest run packages/pipeline` |
| Build (`dist/`) | `pnpm build` at the root builds this package and fabrika |
| Lint (whole repo, with the layer and boundary checks) | `pnpm lint` |

Tests run on scripted services and recorded answers under `fixtures/`. None needs a key or the network.

## Not in it yet

- Publishing, and its real name.
- Some files still read repository paths when they run (the fixtures, the review stage's scripted runs). Installed from a tarball, `tsh -c 'programs'` runs; a stage that needs a repository needs a clone.
- The tests of fabrika's `createDraft` and agent spans are here, not in fabrika: they drive the SDK through `draft-scripted.ts`, which is this package's.

## See also

- [`AGENTS.md`](../../AGENTS.md): the six moves, Effect schemas, and the naming rules for new code here.
- [`docs/direction/outcome-names.md`](../../docs/direction/outcome-names.md): the five verbs.
- [`docs/direction/every-machine-has-laws.md`](../../docs/direction/every-machine-has-laws.md): what `laws/` enforces.
- [`docs/direction/packs-are-programs.md`](../../docs/direction/packs-are-programs.md): the core side of packs.
- [`docs/direction/where-each-piece-lives.md`](../../docs/direction/where-each-piece-lives.md): why the pipeline is its own package.
- [`docs/ship-machine.md`](../../docs/ship-machine.md) and [`docs/review-machine.md`](../../docs/review-machine.md): the ship and review stages.
- Experiment 82 in the [experiments index](../../experiments/README.md): what moved into the pipeline and why.
- [Experiment 103](../../experiments/103-move-without-loss.md): moved into `@kampus/fabrika-old`.
- [Experiment 114](../../experiments/114-the-pipeline-moves-out.md): moved out again, into this package.
