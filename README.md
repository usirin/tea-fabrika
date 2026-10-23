# tea-fabrika

fabrika is a set of tools for building your own software factory: a pipeline that takes a ticket
to a merged pull request, where code runs the steps and agents only do the writing. It is built
on [`@demlik/tea`](https://github.com/kamp-us/demlik), the Elm architecture in TypeScript.

- **It is an experiment.** Some parts are proven on real tickets. Others are still drafts.
- **You get it by cloning this repository.** The package, `@kampus/fabrika`, is not on npm yet.
  It is marked `"private": true` and has no license yet.
- **It is for TypeScript developers** who want to run, study or build an agent pipeline, and for
  the people working on this one.

## What fabrika is

Five parts, from the bottom up:

- **Programs.** A program is a thing you start: a name, typed flags, typed inputs and outputs,
  and a `main` that runs tea state machines.
- **A host.** A host is a process that runs programs. It runs each program under a name, on one
  ledger.
  - The **ledger** is a shared, durable record: every program's state and messages live there.
  - A host holds a **lease** on a name: a hold that runs out unless renewed. If the host dies,
    another host takes the name over and replays from the ledger.
  - This is Erlang/OTP's idea of a node, for tea programs.
- **A shell, tsh.** A Unix-style shell that runs only tea programs. Pipes are typed: `seq | upper`
  is refused before it starts, because numbers do not fit an input of text.
- **Agents.** An agent run is one step inside a program, with a budget in dollars. It runs Claude
  through the Agent SDK, or any harness (a tool that runs an agent, like Claude Code) that speaks
  the Agent Client Protocol.
- **The work pipeline.** Programs for each step of the work, where a **stage** is one step:
  plan, build, review and ship. A **lane** is one plan's whole path, from ticket to merged pull
  request. The pipeline's own name is still open.

## Why it is built this way

- **Code holds the loop.** Which step is next, what to wait for, when to stop and when to ask a
  person: code decides all of that. An agent does one bounded job inside it, such as writing code
  or review findings. See [Control lives in code](./docs/direction/control-in-code.md).
- **Code is cheap, fast, testable and the same every time.** An agent is none of those. So every
  fixed step moves out of agent prose and into a state machine.
- **Every outside thing sits behind a typed service.** The ledger, GitHub and the agent harness
  are each a service, so a test swaps in a fake and no step calls a command-line tool directly.
  See [The backend is a library](./docs/direction/backend-as-a-library.md).
- **Nobody grades their own work.** The reviewer is a different agent from the builder, and no
  agent approves a pull request. See
  [Nobody grades their own work](./docs/direction/nobody-grades-their-own-work.md).

Every decision has a short note in [`docs/direction/`](./docs/direction/README.md).

## Try it in two minutes

You need Node 26 (the repository pins `26.12.0`), pnpm 10 and git. Nothing here needs an API key
or spends money. Run it with `TYPESAFE_API_KEY` unset.

1. Clone this repository, open its folder, and install:

   ```sh
   pnpm install
   ```

2. List the programs tsh knows:

   ```sh
   bin/tsh -c 'programs'
   ```

   tsh first prints where it read its settings from, and one line per setting it picked. With no
   `fabrika.toml` every pick is a default:

   ```text
   fabrika.toml: <this folder>/fabrika.toml, not there: every default
     agents.plan: opus (default), effort medium (default), at most $2 a run (default)
     ...
     ledger.at: local (default)
   say  Says a text once, and ends. tsh's echo.
   seq  Counts from 1 up to a number, one value at a time, and ends.
   double  Doubles each number it is told, and ends when its input closes.
   ...
   ```

3. Pipe two programs together:

   ```sh
   bin/tsh -c 'seq --to 3 | double'
   ```

   ```text
   double 2
   double 4
   double 6
   ```

4. Pipe two that do not fit. Nothing starts:

   ```sh
   bin/tsh -c 'seq --to 3 | upper'
   ```

   ```text
   tsh: does not fit: seq's outputs (n: integer) fit no input of upper (text: string). Nothing was started
     seq --to 3 | upper
                ^
   ```

5. Look at the owner's desk, the inbox of everything that waits on a person. This one is a demo,
   kept in memory:

   ```sh
   bin/tsh -c 'desk-demo'
   ```

   It lists ten asks: plans to approve, a stuck task, and questions to rule on.

`bin/tsh` with no arguments opens an interactive prompt. tsh keeps its history, its job storage
and its local ledger in `~/.tsh` (set `TSH_HOME` to move it).

## Use it on a real repository

This is the path as it stands today. **It is wired, but it has not yet taken a real ticket to a
merged pull request.** Experiment 105 ran the same lane against a fake GitHub. Read
[experiment 105](./experiments/105-the-plan-lane-dry-run.md) before you try it.

- **It writes to the repository you name.** It pushes a branch and commits, and opens one pull
  request per plan.
- **It spends money.** By default each agent run may cost up to $2, and one step of the lane,
  with its retries, up to $20.

Steps:

1. Make sure these work in your shell:
   - `gh` is logged in, with write access to the target repository.
   - Claude is logged in for the Agent SDK: the system keychain, `CLAUDE_CODE_OAUTH_TOKEN` or
     `ANTHROPIC_API_KEY`.
   - `git push` to that repository works from this machine. fabrika clones it over https.

2. Make a folder for the target inside this clone. `runs/` is ignored by git:

   ```sh
   mkdir -p runs/widgets && cd runs/widgets
   ```

3. Write a `tsh.toml` there that names the repository:

   ```toml
   repo = "acme/widgets"
   ```

   Every other key has a default. The keys are listed at the top of
   [`packages/fabrika/src/pipeline/tsh/config.ts`](./packages/fabrika/src/pipeline/tsh/config.ts).

4. In the target repository, commit a `fabrika.toml` on its default branch that turns on the
   owner's desk. Without it, nothing can take your answers:

   ```toml
   packs = ["@tea-fabrika/owner-desk"]
   ```

   Its other keys (agent models, install, checks, approval) are listed at the top of
   [`packages/fabrika/src/pipeline/settings.ts`](./packages/fabrika/src/pipeline/settings.ts).
   See also [One fabrika.toml per repo](./docs/direction/one-fabrika-toml-per-repo.md).

5. Start tsh from that folder, and read its first lines:

   ```sh
   ../../bin/tsh
   ```

   - tsh clones the repository under its home (`~/.tsh/work/`) and reads `fabrika.toml` from
     its default branch, as committed.
   - Each pick is printed with why. Fix any line that warns you, for example a missing
     `.github/CODEOWNERS`, which stops ship at `approval_unknown`.
   - `programs` now lists three more: `review`, `plan` and `deliver`.
   - `deliver` is listed only when each review has a check to run: the install that the
     repository's lockfile names, or a `[[checks.run]]` in its `fabrika.toml`.

6. Look before you run. These only read:

   ```sh
   deliver --describe
   ship --mode read pr=https://github.com/acme/widgets/pull/12
   ```

7. Deliver one ticket, in the background, and answer the desk:

   ```sh
   deliver plan=https://github.com/acme/widgets/issues/42 &
   desk
   answer --ask plan:acme/widgets#42@1 --reply /approve
   ```

   - `deliver` plans the ticket, then waits for you to approve the plan on the desk.
   - Once approved, it builds each task on one branch, reviews it, opens one pull request and
     ships it under the repository's own merge rules.
   - Killed or crashed, run the same line again. It goes on from where the lane stood.
   - Only one tsh may use a home at a time, so run `desk` and `answer` in the same tsh.

### Older paths, kept for now

These still run, but they are not the way forward:

- `operate ticket=<url>` in tsh: the older one-ticket loop (build, review, ship). It is going to
  be deleted. Use `deliver`.
- `pnpm demo`: the first-generation factory (`legacy/`) on a toy ticket, with scripted agents. It
  costs nothing and prints every step.
- `pnpm demo:claude` and `pnpm demo:hard` (a harder toy): the same with real Claude Code. They
  need the `claude` CLI and they spend money. With `TYPESAFE_API_KEY` set, the sort step uses
  Jev, a small paid classifier, instead of a script.
- `pnpm real`: the first-generation factory on one GitHub issue. See
  [Run a real ticket](./docs/how-to/run-a-real-ticket.md).

## Where to go next

| You want to | Go to |
|---|---|
| Write code with `@kampus/fabrika` | [`packages/fabrika/README.md`](./packages/fabrika/README.md) |
| Learn the host by doing it | Tutorial: [Two hosts, one ledger](./docs/tutorials/two-hosts/README.md), then [Agents on two hosts](./docs/tutorials/agents/README.md) |
| Know why a choice was made | [`docs/direction/`](./docs/direction/README.md) |
| See what was tried, and what came back | [`experiments/`](./experiments/README.md) |
| See what happened on real tickets | [`field/`](./field/README.md) |
| Read one finding, short | [`singles/`](./singles/README.md) |
| Check a change against old tickets | [`replay/`](./replay/README.md) |

## What is in this repository

A pnpm workspace. A package may import the ones listed before it, never the ones after.
`layer-rules.json` holds the order, and `pnpm lint` checks it.

- [`packages/fabrika`](./packages/fabrika/README.md), `@kampus/fabrika`: the tools, in one
  package. Its parts, bottom first:
  - [`program`](./packages/fabrika/src/program/README.md): programs.
  - [`host`](./packages/fabrika/src/host/README.md): the host and the ledger.
  - [`shell`](./packages/fabrika/src/shell/README.md): tsh.
  - [`pipeline`](./packages/fabrika/src/pipeline/README.md) and `agents`: the stages, the
    agents, the services they use, and fabrika's wiring for tsh.
- [`programs/`](./programs/README.md): one package per program that runs on its own. Empty for
  now.
- `wip`: the old operator's live wiring that `legacy` still uses. Nothing new goes here.
- [`legacy`](./legacy/README.md): the first-generation factory and the old operator. Nothing new
  goes here.
- `packs/`: add-on packs. A repository turns one on with one line in its `fabrika.toml`; the core
  names none of them.
  - [`packs/owner-desk`](./packs/owner-desk/README.md): the owner's inbox, and their answers back.
  - [`packs/ask-log`](./packs/ask-log/README.md): one line per ask and answer, in a file.
  - [`packs/ui-verification`](./packs/ui-verification/README.md): holds a build that changes
    what a user sees, and asks the owner yes or no.
- [`docs/tutorials/`](./docs/tutorials/): tutorials, with their finished files type-checked.
- `docs/`: drafts too: [`skill-map.md`](./docs/skill-map.md),
  [`review-machine.md`](./docs/review-machine.md), [`ship-machine.md`](./docs/ship-machine.md)
  and [`fabrika-sdk.md`](./docs/fabrika-sdk.md).
- `fixtures/`: toy projects the tests use.
- `blog/` and `video/`: finished pieces about earlier stages.

## Working on this repository

Read [`AGENTS.md`](./AGENTS.md) before you change anything. It says where each kind of note
goes, how to write here, and the rules for a live run.

Run the formatter first, then the three checks. All three must pass before you push. None needs
a key or the network.

```sh
pnpm format      # formats and sorts imports, in place
pnpm typecheck
pnpm lint        # fails on a warning too
pnpm test
```

Other commands:

| What | Command |
|---|---|
| Build `@kampus/fabrika`'s `dist/` (nothing in the repo needs it) | `pnpm build` |
| tsh, the same as `bin/tsh` but without its check for missing packages | `pnpm tsh` |
| tsh with only its small programs | `packages/fabrika/bin/tsh-small` |
| Start or stop a local Jaeger, to see tsh's traces (`TSH_TRACE=1`) | `pnpm trace:up`, `pnpm trace:down` |
