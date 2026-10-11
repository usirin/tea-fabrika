# 48. The operator, built from six moves and no agent

Fabrika's lane is already a tea machine. On top of it sits an agent, the
operator, that reads the lane, starts the shell its state names (builder,
reviewer, shipper), reads the lane again, and parks to a person. It was meant
to be thin. On the two lanes that ran clean today it took 26.5% and 31.9% of
the lane's tokens.

The question: can that loop be code, with no agent of its own? And can it be
built from small parts that the rest of tea-fabrika reuses, instead of as a
one-off "machine that spawns skill agents"?

**Answer so far: yes, against a fake.** The six moves are code now, five
combos join them, and the operator is a hand-written parent that uses nothing
else. It drives a scripted lane from `queued` to merged through a failed
review, a repair, a wait on CI and a wait in the merge queue, and spends no
tokens of its own. Nothing here has touched a real lane, a real agent or
GitHub. That is the next decision, and it is not made here.

## Step 0: what the operators decided today

Before building, a count of what today's operators did that was not "the state
says X, so start Y". The sources are `field/runs.jsonl`, `field/notes.jsonl`
and the transcripts of the 13 operator runs on kamp-us/demlik on 2026-10-10
(10 finished and 3 still running when counted). The choices were counted by
hand from each run's commands, so the totals are rough; the rows are exact.

About 132 next-step choices in all. About 88 were routing: claim, open, brief,
start the shell the state names, record, release. 44 were not. Of those 44,
20 were the agent working around its own setup (rows 1 and 2). That leaves 24
real judgment calls: 14 that a code rule decides, 9 that fit one narrow Jev
question, and 1 that needed a person.

| # | Lanes (times) | What the operator decided | What it read | Where it goes |
|---|---|---|---|---|
| 1 | 7 lanes (8) | Which fabrika binary to run: its working copy had none installed | a missing binary, a "global install" warning | Code. The machine calls fabrika through a service; no agent looks for a binary |
| 2 | 12 runs (12) | The skill named `lane worktree`, `lane cleanup` and `lane leave`; it ran them, got "unknown subcommand", and went on | exit 1 | Code. The machine makes and removes the working copy itself (below) |
| 3 | #616 | Started the reviewer though the PR's mergeability still read unknown after 3 reads | mergeability `unknown` | Code. The review turn listens until it settles |
| 4 | #605 #599 (2) | Waited for CI before starting the reviewer | checks pending | Code. Same Listen |
| 5 | #599 #604 (4) | Posted a fact the issue body did not have (a parallel PR on the same file, a merged dependency, a dropped plan edge, a wrong file list) | open PRs, the builder's report | Judge: "does this fact change what the builder or reviewer of issue N must do?" no, add a note, blocks the lane. A merged dependency is a code rule |
| 6 | #599 | The PR conflicted in review; fabrika 0.9.0 refused the conflict token, so it parked the lane itself and started a repair builder | mergeability `conflicting`, a refused report | Code. Conflicting before review goes back to the build |
| 7 | #599 | Cleared its own park once the PR read mergeable on a new head | its own cause, mergeability | Code. A recipe: a base-conflict park clears when a newer head merges clean |
| 8 | #605 #599 (2) | The reviewer agent type was gone after a plugin reload; it stopped instead of using a general agent | a spawn error | Code. A shell that cannot start is a typed stop |
| 9 | #612 #608 (2) | An epic's child cannot have a lane of its own; it stopped and said so | lane open refused | Code. The claim answers `not_a_lane` |
| 10 | #604 | The epic's plan pointed at an issue outside it; it re-made the lane without that edge and later checked by hand that the issue had merged | emit refused | Code. An outside edge is a wait on that issue's merge |
| 11 | #604 | A decision issue was parked with no cause; it read the owner's comment, checked who wrote it, and recorded the ruling | a comment and its author | Judge: "is this comment a ruling on the issue's open question?" yes or no. The author check is code |
| 12 | #604 | The recipe refused the cause-less park, so it left it for a person, though the ruling was already recorded | recipe refused | Code. A typed cause, cleared once a ruling newer than the park stands |
| 13 | #604 | The builder stopped because the ruling answered 1 of 3 questions; it read both, agreed, and asked the two that were left | the builder's report, the ruling | Judge first ("is each question answered?"), then ask |
| 14 | #605 | Told to report early, it released the lane and handed back a status | the driver's message | Nothing. The lane outlives whoever drives it |
| 15 | #599 #604 (3) | Filed a fabrika defect, or found the same one already filed and added to it | a refused verb, search hits | Judge: "same defect as issue X?" (experiment 37's question) |
| 16 | #604 (2) | A PR body failed a format check; it rewrote the body, and fell back to another API when the edit failed | a "malformed" check | Code. One verb owns the PR body |
| 17 | #599 | The builder said a criterion's file list was wrong; it passed the warning to the reviewer instead of parking | the builder's report | Judge: "does the criterion's file list match the real uses?" |

Stops: 7 of the 13 runs ended short of the lane's end. Three were the driver's
doing (told to report early, started on an epic's child, stopped by hand). Two
lost their agent types to a plugin reload. Two parked for a person, and one of
those needed one (row 13). The other (row 12) waited on a ruling that was
already written down.

One more number, and the one that surprised me. An operator's first turn
already holds about 88,000 tokens: the operate skill is 2,556 lines. A run
that made 9 tool calls still reported 104,000. So most of what an operator
costs is being told how to operate, before it decides anything.

## The six moves, as code

Each is an Elm thing with one rule added. None adds an engine.

| Move | Elm | The rule | In code |
|---|---|---|---|
| Gather | Cmd | Typed answer, changes nothing, so a restart asks again | `gather(name, { input, ok, err })` |
| Act | Cmd | Carries an `intent`, a name for this one write. The model keeps the Cmd before it goes out; a restart re-sends it; the service answers a repeated intent without writing twice | `act(name, { input, ok, err })`, `intentOf(run, pass, task, what)` |
| Listen | Sub | On while the state asks for it. The runner turns what arrives into typed Msgs | `listen(type, deps)` |
| Draft | Sub | The agent's run as a stream (experiment 43). The conversation id is picked first; leaving the phase stops the agent; the answer is typed by a schema, `null` when it does not fit | `createDraft({ name, output })`, `sdkRunner(draft, options)` |
| Check | pure function, or Cmd | Returns problems as sentences. None is a pass | `Check<O, B>`, `checkRun(name, { input, verdict })` |
| Judge | Cmd | One Jev question, fixed choices, a confidence. The floor is applied in update; below it is "unsure" | `createJudge({ name, instructions, choices })`, `judge.rule(answer, floor)` |

They are in `src/primitives.ts` and `src/draft.ts`. Intents and conversation
ids are built from where the step stands in the run (`run/pass/task/what`),
never from a clock or a random id, so a replay names the same write.

## The combos

In `src/combos.ts`. Each is plain data and pure functions that a parent calls
from its own update: Elm's nested model and update, with no wrapper type.

- **refine.** Draft, Check, the problems back in the same conversation, up to
  a limit. `createRefineLoop({ draft, check, prompt })`. The older
  `src/refine.ts` is the same loop with the writer as one `claude -p` turn
  behind a Cmd; triage and the lane still run on it. Its checker is now
  declared with `checkRun`. Moving its writer to the Draft Sub touches about
  60 places in the lane, the factory, the hosts and their tests, so it is its
  own change and not hidden in this one.
- **gate.** `gateCheck(problems)` and `gateJudge(ruled, passes)`: pass, or
  park with why.
- **ask.** Post a question (Act), listen for replies (Listen), read each one.
  Code reads a reply that starts with `/choice`. A Judge reads one in words.
  An unsure reading is set aside and the ask keeps waiting, so the parent only
  ever gets one of the fixed answers. Replies from people not on the list are
  passed over.
- **remember.** Write (Act), then read back (Gather), and count the write only
  when the read shows it.
- **spawn.** A child per item, each stepped by the parent, joined when all are
  over. tea's `subs` is a fixed list, where Elm's `Sub.batch` takes a list
  built from the model. So each child takes the lowest free slot of a fixed
  number, and the parent declares one Sub entry per slot (`slotSubs`). This is
  the one place tea's shape pushed back. It works, but a model-built Sub list
  in tea would delete the slots.

Every Cmd and Sub a child asks for carries the child's `key`, and so does
every Msg back. That is Elm's `Cmd.map` done with data.

## Fabrika as a service, not a CLI

`src/fabrika.ts`. The operator talks to fabrika through an Effect service,
like `Tracker` and `Router`. The methods come from what the operate skill
does with a lane, not from the CLI's verbs:

| Method | Kind | Answers |
|---|---|---|
| `claim` | Act | won with a token, or `held`, `no_seat`, `not_a_lane` |
| `view` | Gather | the lane's status, and each active task's state name, park cause, PR and ledger length |
| `brief` | Gather | the shell and its whole prompt, or one of 7 refusals |
| `pr` | Gather | mergeable, conflicting or unknown, and checks pending, green or red |
| `queue` | Gather | waiting, landed, ejected or parked |
| `dispatched` | Act | nothing |
| `record` | Act | whether fabrika took it. The fact is one of 7: started, a shell's last word, a dead shell, a base conflict, a queue reading, a park, a rewind |
| `unpark` | Act | cleared, not yet, or no recipe |
| `clear` | Act | whether fabrika took a person's clearance, with or without one more repair round |
| `finish`, `release` | Act | nothing |

Two kinds of failure. What fabrika answers on purpose is a typed result. Only
"could not read or write at all" is an error, and the machine stops on it.

The same file holds what the skill keeps in prose: the routing table (state
name to action, 14 rows plus "every `human:*` is a park"), who owns each of
the 21 park causes, and which parks a recipe covers.

**The working copy is the machine's.** A separate service, `Worktrees`, with
`make` and `remove`. The run names the copy in its state (`<lane>-<run>`)
before the Act that makes it goes out. Every shell of the lane runs in that
one copy. Every way out of the run passes through one closing step that
removes it. I kept it off `Fabrika` because a working copy is git on the
machine that runs the lane, not the lane's ledger, and it is the same whoever
keeps the ledger. It is not the existing `Workspace` either, which runs an
issue's tests in a folder it is handed. Today's runs left about 150 agent
working copies on one machine, because the skill told agents to clean up with
verbs the CLI did not have (field notes 06 and 27).

## The operator

`src/operator.ts` (the run) and `src/turn.ts` (one task's turn). The loop:

```
claim                   Act
make the working copy   Act, the copy named in the state first
read the lane           Gather
per active task         spawn: one turn each
  route by state name   the code table, type-blind
  queued                remember: Act "started", Gather it back
  a stage               Gather the brief, Act "dispatched", Draft the shell
                        (it records its own result), Gather: did it land?
                        If not, remember its last word, or that it died
  review                Gather the PR first; Listen while its checks run
                        or nobody can say whether it merges
  the merge queue       Listen; remember what it did
  a park                gate: a known recipe is an Act, tried again on a
                        clock; anything else is ask
all turns over          read the lane again, and loop
the end, however        Act: post the record, remove the copy, release
```

The route is a table, and starting a turn is one switch on it:

```ts
export const ROUTES: Readonly<Record<string, Route>> = {
  queued: { kind: "start" },
  build: shell("builder", 40),
  "build:ui": shell("ui-builder", 40),
  "build:mixed": shell("mixed-builder", 40),
  review: shell("reviewer", 15, true),
  "review:ui": shell("ui-reviewer", 15, true),
  ship: shell("shipper", 10),
  "ship:queued": { kind: "queue" },
  landed: FINAL,
  shipped: FINAL,
  diagnosed: FINAL,
  blocked: PARK,
  frozen: PARK,
  integrate: { kind: "unbuilt", why: "landing an epic's child on its branch is not built here yet" },
};

export function startTurn(t: TaskView, p: Pass): Step<Turn> {
  const route = routeOf(t.state);
  if (route === null) return stop(t, `no route for the state \`${t.state}\``);
  switch (route.kind) {
    case "start":
      return recording(t, p, "the start of the build", { kind: "started" });
    case "shell": {
      if (!route.settled) return briefing(t, p, route);
      const asked = readPr({ key: t.task, lane: p.lane, task: t.task });
      return [{ ...of(t), phase: "reading_pr", route, asked }, [asked]];
    }
    case "queue":
      return [{ ...of(t), phase: "queued", pass: p.pass }, []];
    case "park":
      return gatePark(t, p);
    case "final":
      return moved(t);
    case "unbuilt":
      return stop(t, route.why);
  }
}
```

And the run's own step, once every turn is over (types and the Cmd plumbing
cut):

```ts
function joined(s, cmds) {
  if (!allOver(s.turns, (t) => t.phase === "over")) return [s, cmds];
  if (whys("stopped") !== "") return closing(s, { kind: "stopped", why: whys("stopped") });
  if (whys("parked") !== "") return closing(s, { kind: "parked", why: whys("parked") });
  return reading(s, s.pass + 1);
}
```

Things the code does that the skill asks an agent to remember:

- **The shell is checked against the table.** If fabrika briefs a different
  shell than the table names for that state, the run stops and says both
  names. Two versions drifting apart (rows 1, 2 and 6 above) becomes a stop
  with a reason, not an agent improvising.
- **A shell has a time limit.** 40, 15 and 10 minutes, the skill's own
  numbers. The limit is a timer Sub beside the Draft. When it fires the turn
  leaves the phase, which stops the agent, and the turn records it dead.
- **A write counts when the lane shows it.** After a shell ends, the turn
  reads the lane. If the shell's own report landed, good. If not, the turn
  writes the shell's typed last word, or that it gave none. The same read-back
  follows every write of the machine's own, and a recipe's "cleared". A write
  the lane does not show stops the run. Without that, a park nothing moves
  would go round forever. The first version of the fake did exactly that.
- **Every end removes the working copy and releases the lane.** Merged,
  cancelled, parked or stopped. Only a lost claim skips it, because nothing
  was made.

What the machine spends: Cmds, plus one Jev call for each reply a person
writes in words. A reply of `/resume` costs nothing.

## Tests

`src/operator.test.ts` runs the real machine on the Effect engine against
`src/fabrika-scripted.ts`: one lane in memory, folded by a small copy of
fabrika's issue-lane arms, scripted shells, a thread a person answers on, and
working copies kept in a set. The Listens run on the real polling runners.
No CLI, no GitHub, no agent.

The first test is the whole job: an issue goes through a build, a failed
review, a repair, a second review that waits through pending checks and an
unknown merge state, a ship, and four readings of the merge queue. It ends
merged with 5 shells run, 12 writes in order, no question to a person and no
Jev call. The others: three lanes run the same way; the field-log rows; a
shell whose report did not land, one that broke, one that hung past its time;
a conflicting PR before review; a shell mismatch; a park cleared by its recipe
on the third try; a recipe that lies; a park answered with `/resume`, one
answered in words that Jev was unsure of and then sure of, a founder park, the
size stop; a lost claim, an unreadable lane, an unknown state. For the working
copy: made on claim, removed after ship, after cancel, after a park and a
stop, never made on a lost claim, and made once and removed once when the run
is killed mid-build and a second run boots from the saved state.

`src/combos.test.ts` steps each move and combo by hand. 383 tests in all
(345 before), and `pnpm typecheck` is clean.

## Cost: what there is to compare

Not measured. The machine has only met a fake. What a live run would be
compared against is the two clean lanes of today, one build, one review and
one ship each, with no repair and no person:

| Lane | Operator tokens | Lane tokens | Operator share | Minutes |
|---|---|---|---|---|
| kamp-us/demlik#600 | 115,872 | 436,573 | 26.5% | 33.8 |
| kamp-us/demlik#601 | 119,072 | 373,465 | 31.9% | 31.3 |

The other operator runs are not a fair baseline. Five stopped for reasons the
driver or the setup caused, and they are now marked `driver_caused` in
`field/runs.jsonl`. The claim to test live is narrow: the same kind of lane,
under the machine, costs what its three shells cost and nothing more, and
takes no longer. The shells themselves are unchanged, so the other 68% to 74%
stays.

## What it does not do

- **Epics and chores.** `integrate` and the recipe-routed chore states stop
  the run with "not built". One issue, one task, is what a first run needs.
- **Rows 5, 11, 13, 15 and 17 of the table.** The Judge questions are named,
  not built. A cause-less park goes to ask, which is the safe side.
- **The dead shell's leftovers.** The skill has the operator release the
  builder's claim and retire its branch. Here that is the Layer's job inside
  `record({ kind: "shell_dead" })`, and no Layer exists yet.
- **A restart while a shell runs.** The Sub reopens with the same
  conversation id, marked as a new conversation. The fake starts a fresh
  shell. The real SDK may refuse an id that exists (experiment 43 never
  tried). The runner needs "resume if it exists" before a live run can
  survive a kill.
- **What a stopped shell cost.** A shell stopped for time is logged with zero
  tokens, because the runner stops listening before the SDK's last result.
- **A line for the person.** The skill prints what is happening in the chat.
  The machine's state says it; nothing prints it yet.
- **An ask that nobody answers** waits forever. No reminder, no timeout.

## A live Layer: adapter or own the lane

Two ways to serve `Fabrika` live.

1. **A thin adapter over fabrika-cli 0.9.0.** Each method runs one or two
   verbs and maps exit codes to the typed answers.
2. **tea-fabrika owns the lane machine.** The ledger, the fold and the proofs
   move here, and the CLI is gone.

My pick is the adapter first, and the lane machine after the shells change.
The reason is the shells. They are fabrika skills. Each one reads its prompt
from `lane brief` and writes its result with `lane report`, into fabrika's
ledger. The machine and its shells have to read the same ledger, and today
that can only be fabrika's. Owning the lane becomes the right move once a
shell's result is the Draft's typed answer and the machine records it. Then
`lane report` goes away, and with it the whole "the report never landed"
branch. The tradeoff: the adapter inherits 0.9.0's gaps (it has no conflict
arm out of review, so that fact has to be recorded as a park and cleared by
the adapter, as today's operator did by hand), pays about a second per verb,
and breaks when the CLI's exit codes change. It is throwaway code by design,
maybe 300 lines. Confidence in this order: about 75%. What would raise it is
reading how much of `lane prove` (the check that a PR really backs an event)
the lane machine would have to re-do here.

What the adapter maps:

| Method | Verbs |
|---|---|
| `claim` | `lane seats`, `lane claim`, then `lane status`, and `lane open` when there is no lane |
| `view` | `lane status` for the state names, `lane history` for the ledger length, the last park's cause and the PR |
| `brief` | `lane brief` (stdout is the prompt; exits 18, 19, 20, 22, 25, 59 and 71 are the refusals), and the shell name from `lane dispatched` |
| `pr` | `build verdicts --pr`, and the PR's checks |
| `queue` | `ship reconcile <pr> --polls 1`, and `ship disarm` on `parked` |
| `record` | `lane transition` for started, a park and a rewind; `lane report --token` for a shell's word, a dead shell, a conflict and a queue reading |
| `unpark`, `clear` | `recipe unpark --rationale` (exits 0, 13, 12); `lane clear`, then `lane transition UNBLOCKED --rationale` |
| `finish`, `release` | `lane record`, `lane release --token` |
| `Worktrees` | `git worktree add --detach`, `git worktree remove --force` |

The CLI has no intent key, so the adapter keeps its own list of intents done,
beside the lane, and checks it before each write.

## What a first live run needs

Not run. This is the list for whoever decides to.

**The issue.** One plain issue on demlik: not an epic, not an epic's child,
no UI, triaged and `ready-for:agent`, small. It should touch no control-plane
path, so it cannot park for an owner's approval. Nothing else should be open
in the same package, so its PR cannot conflict (field note 28). The clean
lanes #600 and #601 are the shape.

**Before it can start:**

- The adapter above.
- A `Worktrees` Layer on git, and a `Thread` Layer on issue comments.
- A decision on what the shells may do without asking. `shellOptions` sets
  `acceptEdits`, which approves file edits and nothing else. A builder needs
  `git push` and `gh`. Run that way, it would stop at its first shell command.
  The choice is a tool allow-list or bypassing permissions inside the copy.
- A dollar limit per shell (`maxBudgetUsd`), and the knob for whose replies
  count.

**What could go wrong, most likely first:**

1. The shells make their own working copy. The brief's rules tell a shell to
   work in an isolated copy, and the builder's `build branch` may add one
   under the machine's. Then the machine removes its copy and the shell's
   stays. Check on a dry run what `build branch` does when it already sits in
   a clean detached copy.
2. The typed last word. The Draft asks the SDK for `{ token, pr }`. A shell
   that follows a long skill may end without it. Then the turn reads the
   lane, which is the real answer, and only a shell whose report also failed
   is recorded dead. A wrong "dead" costs one lap and one more shell run.
3. `agent: "fabrika:builder"` with the plugin loaded from a folder. The SDK
   documents both; nothing here has run them together. The plugin reload that
   stopped two operators today is the same kind of failure.
4. A kill mid-shell (above). For a first run: do not restart it; let it end.
5. Fabrika 0.9.0 against a skill written for a newer CLI. The brief may tell
   a shell to run a verb that is not there. The machine no longer runs those
   verbs, but the shell still reads about them.
6. A second driver. The claim is fabrika's own, so a person's operator on the
   same lane loses the race cleanly. Two machines on one checkout would share
   `.fabrika/`, which is fine, and nothing else.

**What to look at after:** the machine's row in `field/runs.jsonl` (tokens 0,
its Jev calls, the dollars its shells cost), the three shell rows against
#600 and #601, the minutes, and `git worktree list` before and after.
