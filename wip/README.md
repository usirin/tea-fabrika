# @tea-fabrika/wip

Everything still being shaped: the stage machines and their programs, the agents, the services they talk to, and fabrika's wiring for tsh.

```sh
bin/tsh -c 'programs'                         # the small ones, acp, ship, review-scripted, build, operate
bin/tsh -c 'ship --describe'                  # its flags, inputs, outputs and machines
bin/tsh -c 'ship --mode read pr=<pull request url>'   # reads only: says what ship would send
bin/tsh -c 'review-scripted --rubrics <folder> pr=<pull request url> | ship --mode read'
bin/tsh -c 'desk-demo
answer --ask plan:kamp-us/demlik#393@1 --reply approve
desk'                                         # the owner's desk on experiment 89's cases
```

`review`, with a live reviewer, is listed too when `tsh.toml` names a `clone`.

The owner's desk (`src/tsh/desk.ts`):

- `desk`: starts the `asks` core with the packs the `packs` line of the repository's `fabrika.toml` names, each with its own `[pack."<name>"]` table. Prints the inbox, the replies that fit, and where the pages are.
- `fabrika.toml` is read once, when tsh starts, from one place. When `tsh.toml` names a target (`repo` or `clone`): the target's file as committed on its default branch, read in its clone. Otherwise: the root of the repository tsh is started in (the nearest folder up that holds `.git`; outside any repository, the folder itself). tsh's first line on stderr says which. Packs are always found from the start folder's root, where fabrika is installed. See `src/settings-source.ts`. A `tsh.toml` that still lists packs stops tsh and says to move them.
- `desk-demo`: the same on a fresh ledger of experiment 89's cases (`src/asks/demo.ts`). Packs get no settings. Pages go under `<TSH_HOME>/desk-demo/`, cleared each time.
- `answer --ask <id> --reply "<reply>"`: hands a typed reply to the first pack with a `shell` (owner-desk). Prints the inbox again, or fails with the replies that fit.
- The ledger is in memory: it lasts one tsh process (one `-c`, or one interactive session). Separate `bin/tsh -c` calls do not share it.
- A real desk's pack folder is `<TSH_HOME>/packs/<pack>` unless its settings name one.

## Where it sits

- Above `packages/tsh` and `programs/`, below `legacy` and `packs` (`layer-rules.json`).
- It may import any package of this repo except `legacy` and the packs.
- It imports `@tea-fabrika/tea-program` and `@tea-fabrika/tsh`.
- Imported by `legacy` and by every pack under `packs/`.
- New work starts here. A part moves to its own package under `packages/` or `programs/` once it is ready.

## What's in it

The `exports` map is `"./*": "./src/*.ts"`, so any file is importable as `@tea-fabrika/wip/<path>`.

| Folder or file | What it holds |
|---|---|
| `src/stages/outcome.ts` | The five verbs every stage answers in (`done`, `send`, `ask`, `skip`, `stuck`), `outcomesOf` and `nameOf` |
| `src/stages/ship/` | The ship machine and the `ship` program |
| `src/stages/review/` | The review machine and the `review` program |
| `src/stages/build/` | The build machine and the `build` program |
| `src/stages/plan/` | The plan machine and the `plan` program |
| `src/stages/operate/` | The operate loop and the `operate` program |
| `src/stages/queue.ts`, `status.ts`, `traced.ts`, `rules.ts` | Shared by the stages: the kept work queue, status lines, trace drawings, the repo's agent rules |
| `src/asks/` | The `asks` core program: what waits on the owner, kept in a ledger. `packs.ts` wires add-on packs to it. `demo.ts` is the demo ledger |
| `src/criteria/` | A plan's criteria, each under an id it keeps, and where verdicts are kept |
| `src/laws/` | The law checker (`explore.ts`) and the laws of each machine |
| `src/agents/acp/` | The `acp` program: an Agent Client Protocol client |
| `src/tsh/` | Fabrika's tsh: `tsh.toml` reading (`config.ts`), the program list, the owner's desk (`desk.ts`), the launcher `bin/tsh` runs |
| `src/settings.ts` | The repository's `fabrika.toml`: its schema, its three load rules, and `repoOf`, which finds the repository's root |
| `src/settings-source.ts` | Where `fabrika.toml` is read from: a target's committed default branch, or the start folder; and the line tsh prints about it |
| `src/trace/` | Agent turns in traces, and fabrika's trace view rules |
| `src/primitives.ts`, `src/combos.ts` | The six moves (Gather, Act, Listen, Draft, Check, Judge) and the combos built from them |
| `src/draft.ts`, `src/schema.ts`, `src/refine.ts` | A Draft over the Agent SDK, `defineCmd` from Effect schemas, the draft-and-vet child |
| `src/services.ts` | The services the stages talk to |
| `src/code-host-github.ts`, `code-host-github-writes.ts`, `code-host-local.ts`, `codeowners.ts` | `CodeHost` and `CodeHostWrites` over GitHub, and `CodeHost` over a local git copy |
| `src/env.ts`, `src/shell-guard.ts`, `src/child.ts` | What a started process is handed, what a shell may not do, one command run to its end |
| `src/ids.ts`, `src/entity.ts`, `src/verdict.ts`, `src/check-runs.ts`, `src/worktrees.ts` | Ids, ledger entities, reading today's review verdicts, local check runs, working copies |
| `src/operator-live.ts` | The live Layers of the old operator in `legacy` that are not fabrika: working copies as git worktrees, and the thread a person answers on, as an issue's comments through `gh` |

### More on some of these

- `src/stages/outcome.ts`: the one shape every stage machine answers in.
  - Five verbs, and one way to spell an answer: `send:builder:checks_red`, `ask:owner:approval`, `done:part`.
  - A stage writes only its own words (`outcomesOf`). `nameOf` makes the name from the data.
  - The name's pattern is a type, so a misspelled name does not compile.
- `src/stages/ship/`: one pull request in, one typed outcome out, no agent ([`docs/ship-machine.md`](../docs/ship-machine.md)).
  - `outcome.ts`: its own words for the five verbs, 24 names in all.
  - `facts.ts`: the facts it reads. `gate.ts`: go, wait, or the one reason not to.
  - `ready.ts`: "ready to merge" as a value that exists only with its proof: a passing verdict row for every criterion at the head, and green checks at that head. The enqueue and merge Cmds take nothing else.
  - `machine.ts`: read the facts, pass the gate, put the head in the merge queue (or merge it when the repository has no queue), listen to the queue, tidy up.
    - It waits for checks that are still running, and runs red checks again once before the builder is called. Both waits have a limit.
    - A machine is made with its own limits: `createShip({ waits })`. Nothing is read from the computer it runs on.
  - `handlers.ts`: its handlers and the runners of its two Listens, the reads kept apart from the writes.
  - `look.ts`: the machine stepped as far as its first write or wait, with that write handed back, never sent.
  - `program.ts`: the `ship` program, the thing you start. A mode as its flag, pull requests told on its input `pr` at any time, a fresh run of the machine per pull request, one at a time. `CodeHost` and `CodeHostWrites` come through Effect's context.
  - `run.ts`, with `launch.ts` behind it: `node wip/src/stages/ship/run.ts <pull request url>... --own <account>` only reads. It prints the facts, the machine's answer and the write it would send. With `--write` the machine runs to its end on each pull request. A url that is not a pull request's answers `bad_shape` before anything runs. Every option is in the comment at the top of the file.
  - Its live runs: [experiment 56](../experiments/56-first-live-run-of-the-ship-machine.md), and [63](../experiments/63-ship-as-a-program.md) for ship as a program.
- `src/stages/review/`: one pull request at one head commit in, one typed outcome and a report out ([`docs/review-machine.md`](../docs/review-machine.md), last section).
  - `pack.ts`: code reads everything a reviewer needs. `gate.ts`: stops before any agent when a required check is red or the pack is not whole.
  - `reviewer.ts`: the one agent. It gets a copy of the code at the commit, three read tools (Read, Grep, Glob) and the tools its machine opens to it (`tools.ts`, such as filing a note), and fills a form of rows and findings.
  - `sheet.ts`: code checks the form and gives each finding an id. A form it refuses goes back to a new run with its problems, up to a limit of tries.
  - `verdict.ts`: the verdict of each kind. `render.ts`: the comment's text.
  - `machine.ts`: the review machine around the reviewer. `program.ts`: the `review` program. It only reads: a note the reviewer files goes out on the output `note`, and nothing is posted.
  - `outcome.ts`: its own words for the five verbs, 19 names in all.
  - `run.ts`: `node wip/src/stages/review/run.ts <pull request url> --rubrics <folder> --repo <local clone>`. It prints the notes, the verdict, the comments it would post, and the cost. Every option is in the comment at the top of the file.
  - The rubric texts are a folder named on the command line. None is kept here.
  - Tested on recorded answers under `fixtures/review/`, with a scripted reviewer. Its real runs: [`docs/review-machine.md`](../docs/review-machine.md), "The three runs beside today's reviewer".
- `src/code-host-github.ts`, `src/codeowners.ts`: `CodeHost` on GitHub, the read side only.
  - A pull request's facts for the ship gate, read through `gh` GraphQL calls at one head commit.
  - The owner's approval comes from the base branch's CODEOWNERS (which files are protected, who owns them) and the approving reviews at the head.
  - The kinds of review a change needs come from the files it touches and the repo's `.fabrika.jsonc`.
  - Where a fact cannot be read it is `unknown`, never a guess. `NOT_READ` lists what a fact still cannot be taken for.
  - Two waits, the checks and the merge queue, each a read asked again every `pollMs`. The queue's wait says a pull request was thrown out only on GitHub's own record of it, never on one "not in the queue" answer.
  - `readChange` reads a change for a review: the pull request at one commit, its ticket's text, the files and the whole diff against the base, and the required checks.
  - Tested on recorded answers under `fixtures/code-host/` and `fixtures/review/`.
- `src/code-host-github-writes.ts`: `CodeHostWrites` on GitHub. Every write the ship machine makes on a pull request is listed whole at the top of the file.
  - Put a head in the merge queue. GitHub itself refuses when the head is no longer that commit.
  - Merge a head straight in, only on a repository with no merge queue.
  - Start the failed jobs of red runs again.
  - Never "merge when ready", a deleted branch, an owner's bypass, a label or a comment.
  - Tested against a scripted `gh`, every argument list checked whole.
- `src/primitives.ts`, `src/draft.ts`: the six moves every step is made of, each an Elm thing with one rule.
  - Gather: a Cmd that only reads.
  - Act: a Cmd that carries a name for its one write, kept in the state first, so a restart never writes twice.
  - Listen: a Sub.
  - Draft: an agent's run as a Sub over the Agent SDK's stream, its conversation named up front and its answer typed by a schema.
  - Check: a pure function, or a Cmd when it runs code.
  - Judge: one Jev question with fixed choices. The floor is applied in update.
- `src/schema.ts`: `defineCmd` is tea's `Cmd.define` with the Standard Schema wrapping done inside, and the moves go through it. Also what a Draft needs from its output schema: the JSON Schema the Agent SDK takes, and a reader for the agent's answer. It takes a zod schema too, until the repo is off zod.
- `src/combos.ts`: the moves joined, as data and pure functions a parent calls: refine (Draft and Check in a loop), gate (pass, or park with why), ask (post a question, listen for replies, read each by code or a Judge into one of a fixed set of answers), remember (write, then read back) and spawn (a child per item).
- `src/refine.ts`: draft and vet, a small child machine made per use. `createRefine({ name })` names its Cmds `<name>_write` and `<name>_check`. A writer agent turn, a checker in code, the checker's problems back to the writer in the same conversation, up to a limit, then it stops for its parent. Triage's enrichment in `legacy` is its first use.
- `src/shell-guard.ts`: the Check before each tool call of a shell.
  - No merge by hand, no approval, no `--auto`, no `--delete-branch`, no push to main, no second working copy, no write outside its own.
  - No command left in the background: a shell's session ends with its turn, so nothing would ever read it.
  - With its `readOnly` rule on, as the review stage's reviewer runs, only the read tools its machine opened pass, and only inside the folder it was given.
- `src/env.ts`: the environment a started process is handed, as a keep-list of variable names in place of this process's whole environment.
  - `runEnv`: the path, the home folder, the temp folder, the locale and the time zone.
  - `agentEnv`: that, and what `claude` reads to find its login.
  - `shellEnv`: that, and where git finds a key an ssh agent holds.
  - `hostEnv`: for code's own `git` and `gh`, never an agent's: the first list, where `gh` finds its login, and where git finds its key.
  - It takes variables away and nothing else. A process still reads the files its user can read.

## Commands

| What | Command |
|---|---|
| Run fabrika's tsh | `bin/tsh`, `pnpm tsh`, or `wip/bin/tsh` (reads `./tsh.toml`, and `fabrika.toml` at the repository's root) |
| Typecheck this package | `pnpm --filter @tea-fabrika/wip typecheck` |
| Test this package | `pnpm vitest run wip` |
| Lint (whole repo, with the layer check) | `pnpm lint` |

Tests run on scripted services and recorded answers under `fixtures/`. None needs a key or the network.

## See also

- [`AGENTS.md`](../AGENTS.md): the six moves, Effect schemas, and the naming rules for new code here.
- [`docs/direction/outcome-names.md`](../docs/direction/outcome-names.md): the five verbs.
- [`docs/direction/every-machine-has-laws.md`](../docs/direction/every-machine-has-laws.md): what `src/laws/` enforces.
- [`docs/direction/packs-are-programs.md`](../docs/direction/packs-are-programs.md): the core side of packs.
- [`docs/ship-machine.md`](../docs/ship-machine.md) and [`docs/review-machine.md`](../docs/review-machine.md): the ship and review stages.
- [Experiment 82](../experiments/82-monorepo.md): what moved here and why.
