# Fabrika as a library: a first draft

Status: a draft for discussion. Nothing in it is built. Where I am less sure, the text says "Less sure".

Today the fabrika backend is a command-line tool, version 0.9.0. The operator machine and the agents both start it as a separate process and read what it prints. This document asks what the backend should look like if code imported it instead: a set of typed Effect services, like the `Fabrika` service in [`src/fabrika.ts`](../src/fabrika.ts).

Every claim here comes from two live runs of the operator machine on kamp-us/demlik. It does not design from imagination. Where the runs say nothing, the document says so.

| | Run 1 | Run 2 |
|---|---|---|
| Issue | [kamp-us/demlik#559](https://github.com/kamp-us/demlik/issues/559), one doc paragraph | [kamp-us/demlik#625](https://github.com/kamp-us/demlik/issues/625), a small code bug |
| What happened | Straight through | A failed review, a repair, three builders that ended without reporting |
| End | Merged, 18.8 minutes, $1.74 | Merged, 40.2 minutes, $7.68 |

The write-ups are experiments 48, 49 and 50 in [`experiments/`](../experiments/). The field data is in [`field/`](../field/README.md).

## The short version

- The machine started 60 CLI processes in run 1 and 83 in run 2. More than half were `lane status` and `lane history`.
- The workers started more: at least 34 and 117. About four in five asked for something the machine already had, or were shipper steps that code could run.
- The wrapper maps 31 exit codes by hand. The two runs exercised one of them.
- Section 5 lists eight gaps. The costly ones: no event when checks finish, no way to continue a worker's conversation, a dead worker's claim left behind, red checks still sent to a reviewer, and a shipper that is an agent doing code's job.
- The proposal keeps `Fabrika`, `Worktrees` and `Thread`, adds `PullRequests` and `Verdicts`, and puts what the machine knows into the brief.
- First step: `PullRequests`, read-only, run beside the wrapper and compared.

## Words used here

| Word | Meaning |
|---|---|
| Lane | One issue's trip from claimed to merged |
| Ledger | The lane's list of events, kept by fabrika |
| Pass | One round of the machine's loop: read the lane, do one thing, read again |
| Verb | One CLI subcommand, such as `lane status`. Each call is one new process |
| Worker | A builder, reviewer or shipper agent. The code calls them shells |
| Park | A lane that stopped and waits for something |

## How I counted

- **The machine's calls.** One line per CLI process in `runs/operate/<run>/verbs.jsonl`, and one line per machine message in `msgs.jsonl`. These are exact.
- **The workers' calls.** A pattern match over the command text in `runs/operate/<run>/shell-*.jsonl`. The log keeps the first 600 characters of each command, and 36 of the 171 worker shell commands were cut. So every worker count is "at least". The workers' exit codes are not in the log.
- **Time per verb.** The gap between the logged end of one verb and the end of the next, inside one service call.
- The `runs/` folder is local and not in git. A reader cannot re-run these counts from the repo alone.

## 1. Why a library

The first table is what the machine itself did.

| | Run 1 | Run 2 |
|---|---|---|
| Commands the machine sent | 22 | 49 |
| CLI processes those became | 60 | 83 |
| from the commands | 34 | 72 |
| from polling the pull request while checks ran | 26, in 13 polls | 11, in 11 polls |
| `lane status` calls | 10 | 23 |
| `lane history` calls | 24 | 22 |
| Passes | 4 | 9 |
| Lane reads | 9 | 22 |
| Lane reads at one per pass, plus the first | 5 | 10 |
| Non-zero exits seen | 1 | 1 |

`lane status` and `lane history` together were 34 of 60 processes in run 1 and 45 of 83 in run 2. One lane read is two processes, because no single verb gives both answers.

Seconds are not the main cost. A local read takes about 0.7 seconds and a verb that reaches GitHub about 3. By that measure the 45 `lane status` and `lane history` processes of run 2 took about 30 seconds of a 40 minute run. The real costs are these four.

**The workers shell out more than the machine does.** They ran at least 34 fabrika verbs in run 1 and 117 in run 2. 88 of their 171 shell commands called the CLI through a long path to `bin.js`, because the binary is not on the path in a worker's working copy. Section 3 shows that about four in five of those verbs asked for something the machine already had.

**The wrapper guesses at exit codes.** [`src/fabrika-cli.ts`](../src/fabrika-cli.ts) names 31 non-zero exit codes. Six of them mean different things under different verbs. Exit 31 is "another driver holds the lane" from `lane claim`, and "nothing to release, fine" from `lane release`. Exit 14 is "already open" from `lane open` and "cleared" from `recipe unpark`. The two runs saw exactly one non-zero exit, code 7 for "no lane yet", once each. The other 30 mappings have met, at most, a stand-in binary in tests.

**The wrapper reads text.** It finds a brief's worker, issue and pull request with a regular expression over the prompt. It takes the pull request number out of a URL the same way. It parses JSON and trusts the shape without a schema. And 57 of the 59 successful verbs in run 1, 80 of 82 in run 2, also printed prose on stderr that the wrapper throws away.

**The CLI has no key for a repeated write.** The machine names every write so a restart can send it again safely. The CLI cannot take that name, so the wrapper keeps its own file of writes done: 7 entries in run 1, 15 in run 2.

Two more things the runs showed that a typed import would have caught before any run started:

- Workers called two verbs that 0.9.0 does not have. `lane cleanup` ran twice, once per shipper, and exited 1. Both shippers then told the reader that working copies were left on disk, which was false. `build comments` ran at least 5 times, and one builder said in its closing message that the verb was missing.
- Nothing can wait on an event. So four different things waited on the same checks: the machine's poll, `review ci --wait`, `ship checks --wait`, and a builder's own `gh pr checks --watch`. The last one broke run 2. See section 5.

One fact from the installed package, not from the runs. `@kampus/fabrika-cli` 0.9.0 already has a library entry point, built on Effect. It has 22 exports: the decision-record verbs, exit codes, file and git and GitHub access, and spend records. It exports nothing from the `lane`, `build`, `review` or `ship` groups. So the code this document asks for partly exists. It is not reachable by import.

## 2. What the machine calls today

Every method of `Fabrika` and `Worktrees`, with the count of calls in each run.

| Method | What it is for | CLI verbs today | Run 1 | Run 2 | Kind |
|---|---|---|---|---|---|
| `Fabrika.claim` | Take the lane, and start its ledger if it has none | `lane seats`, `lane claim`, `lane status`, `lane open` | 1 | 1 | write |
| `Fabrika.view` | The lane's status, the task's state, park cause, pull request and ledger length | `lane status`, `lane history` | 9 | 22 | read |
| `Fabrika.brief` | The prompt for the worker the state names | `lane brief` | 3 | 8 | read |
| `Fabrika.pr` | Can the pull request be reviewed: does it merge clean, are checks done | `build verdicts --pr` | 14 | 13 | read |
| `Fabrika.queue` | The merge queue, read once | `ship reconcile --polls 1` | 0 | 0 | read |
| `Fabrika.dispatched` | Say a worker is about to start | `lane dispatched` | 3 | 8 | write |
| `Fabrika.record` | Write what the machine saw | `lane transition` or `lane report --token` | 1 | 4 | write |
| `Fabrika.unpark` | Clear a park by its known recipe | `recipe unpark` | 0 | 0 | write |
| `Fabrika.clear` | Clear a park on a person's word | `lane clear`, `lane transition UNBLOCKED` | 0 | 0 | write |
| `Fabrika.finish` | Post the finished lane's record on its issue | `lane record` | 1 | 1 | write |
| `Fabrika.release` | Give the lane back | `lane release --token` | 1 | 1 | write |
| `Worktrees.make` | Make the lane's working copy | `git fetch`, `git worktree add --detach`, the install | 1 | 1 | write |
| `Worktrees.remove` | Remove it | `git worktree remove --force` | 1 | 1 | write |

Notes on the table:

- `Fabrika.pr` was 1 command and 13 polls in run 1, and 2 commands and 11 polls in run 2. In run 1 each call also ran `lane history` to find the pull request again. That was fixed before run 2.
- `Fabrika.record` wrote "the build started" once per run. In run 2 it also wrote "the worker is dead" three times.
- `queue`, `unpark` and `clear` have never run live. Neither has the `Thread` service, which posts a question to a person and listens for replies. No lane parked, and both shippers saw the merge land inside their own run.
- Of the seven facts `record` can write, the runs used two.

So anything this document says about parks, the merge queue as a listener, or questions to a person rests on tests against the in-memory fake, not on a live run.

## 3. What the workers call today

The workers were today's fabrika skill agents. All counts are "at least", for the reason in "How I counted". The last column says what would happen to the call if the backend were a library the machine holds.

### Builder: 1 run in run 1, 5 runs in run 2

| Call | Run 1 | Run 2 | With a library |
|---|---|---|---|
| `build tree`: is my copy clean and on the right branch | 4 | 17 | Gone. The machine made the copy |
| `build claim` | 1 | 8 | Gone. The machine holds the lane |
| `build confirm`: is my claim still mine | 2 | 8 | Gone |
| `lane working` | 1 | 5 | Gone. The machine wrote `dispatched` |
| `build eligible` | 1 | 1 | Gone. The lane is at `build` |
| `build claims stale`, `build adopt`, `build release` | 0 | 10 | Gone. The machine recorded the dead worker |
| `lane status`, reading the ledger's files directly, `ps` on the old worker | 0 | 12 | Gone. The machine has the lane |
| `gh pr checks`, three of the five as a wait | 0 | 5 | Gone. The machine listens for free |
| `build issue` | 1 | 4 | In the brief |
| `build comments`, a verb 0.9.0 lacks | 1 | 4 | In the brief |
| `build verdicts --pr` | 0 | 4 | In the brief |
| `gh pr view`: body, head commit, checks | 0 | 6 | In the brief |
| `build scratch`: a scratch folder | 1 | 1 | In the brief |
| `gh issue list`, `gh issue view`, `gh pr list` about one red guard | 2 | 4 | In the brief |
| `build branch` | not seen | 5 | Moves to the machine. Less sure |
| `lane report` | not seen | 1 | Moves to the machine |
| `build check`: run the guards on the change | 1 | 10 | Stays |
| `build commit`, `build push`, `build pr-body`, `build note` | 3 | 8 | Stays. Real work |
| Read, Edit, Write | 3 | 18 | Stays. Real work |
| `git` commands: `status`, `diff`, `log`, `show`, `add` and a few others | 5 | 38 | Stays. Real work |
| Tests, lint, typecheck, reading code | not counted | not counted | Stays. Real work |

"Not seen" means the call sat in a part of a command the log cut off. Both run 1 calls happened: the builder said it cut the branch, and its report landed. Two of the four `build pr-body` calls in run 2 were `--help`.

### Reviewer: 1 run in run 1, 2 runs in run 2

| Call | Run 1 | Run 2 | With a library |
|---|---|---|---|
| `review ci --wait --budget-seconds 480` | 1 | 2 | Gone. The machine had already waited for the checks |
| `review scope`, `review criteria`, `review verdicts`, `review deviations` | 4 | 8 | In the brief |
| `gh issue view`, `gh pr view` | 2 | 5 | In the brief |
| `gh pr checks`, `gh run list`, `gh run view --log-failed` | 0 | 7 | In the brief, when checks are red |
| `lane report` | 1 | 2 | Moves to the machine |
| `review diff` | 1 | 2 | Stays |
| `git show`, `git grep` and other reads of the code | 2 | 32 | Stays. Real work |
| `review post`: the verdict | 1 | 4 | Stays. Real work |

### Shipper: 1 run in each

Both shippers ran the same 10 verbs in the same order:

`ship disarm`, `ship scope`, `ship gate`, `ship checks --wait`, `ship threads`, `ship enqueue`, `ship reconcile`, `ship release`, `lane cleanup`, `lane report`.

No `gh`. No `git`. No file read. No judgment that the log shows. One command, `ship enqueue` with `ship reconcile`, held 354 of the shipper's 390 seconds in run 1 and 325 of 366 in run 2. That is an opus session kept open to wait on a merge queue. The two shippers cost $0.30 and $0.33.

All 10 move to the machine. I am less sure this holds off the happy path. In both runs every gate passed. A shipper that meets a red gate may need judgment these logs never showed.

### The totals

| | Run 1 | Run 2 |
|---|---|---|
| Fabrika verbs the workers ran | 34 | 117 |
| Gone, in the brief, or moved to the machine | 28 | 93 |
| Real work that stays | 6 | 24 |

That is 82% and 79%. The split is my reading of each verb's name and of what the worker did next. Nobody has checked it against the skills line by line.

## 4. The proposed services

Seven groups. The style follows `src/fabrika.ts`: Effect services, zod schemas for every input and answer, and the same two kinds of failure. An answer fabrika gives on purpose is a typed value. Only "could not read or write at all" is an error, and it stays the one `Unknown`.

Only what changes or is new is shown. Each new thing names the log evidence that asked for it.

### Lanes and the ledger

`Fabrika` keeps its name and its methods. Four changes.

```ts
/** New. The worker now on a task. The machine names the run before it starts. */
export const WorkerRun = z.object({
  /** For example `625-1/4/issue/shell`. */
  run: z.string(),
  shell: Shell,
  /** The agent's conversation, so a later turn or a later run can continue it. */
  session: z.string(),
});
export type WorkerRun = z.infer<typeof WorkerRun>;

export const TaskView = z.object({
  // task, state, cause, pr, seq: as today
  /** New. The commit the pull request points at. `null` with no pull request. */
  head: z.string().nullable(),
  /** New. The worker that was dispatched and has not ended yet. */
  worker: WorkerRun.nullable(),
});

/** New. What a write answers: was it taken, and the lane as the write left it. */
export const Written = z.object({ taken: z.boolean(), view: LaneView });
export type Written = z.infer<typeof Written>;

// On Fabrika. The other methods stay as they are.
readonly dispatched: (request: At & Intended & { readonly worker: WorkerRun }) => Effect.Effect<Written, Unknown>;
readonly record: (request: At & Intended & { readonly fact: DriverFact }) => Effect.Effect<Written, Unknown>;
```

| New | Evidence |
|---|---|
| `Written.view` | After every write the machine read the lane back, then read it again a second later to start the next pass. Run 2 made 22 lane reads for 9 passes |
| `record` drops its `pr` argument | The ledger knows the pull request. Run 1 spent 15 `lane history` calls finding it again |
| `TaskView.worker` | In run 2 three builders read `in-flight.jsonl` and `events.jsonl` directly, 7 file reads in all. Two ran `ps` or `pgrep` on the old worker's session id to see if it was alive |
| `TaskView.head` | Workers fetched the head commit in 7 commands and passed `--sha` 20 times |

### What the brief hands over

Today `Brief.prompt` is one block of text, and the wrapper reads three fields out of it with a regular expression. Workers then ask the CLI and `gh` for the rest. The proposal: the brief carries what the machine already knows, typed. `Verdict`, `ReviewClass` and `FailedCheck` are defined in the next two groups.

```ts
/** New. What a worker would otherwise ask for. */
export const Handover = z.object({
  issue: z.object({
    url: z.string(),
    title: z.string(),
    body: z.string(),
    comments: z.array(z.object({ author: z.string(), url: z.string(), body: z.string() })),
  }),
  /** The acceptance criteria, one per row. */
  criteria: z.array(z.string()),
  pr: z.object({ url: z.string(), body: z.string(), state: PrState }).nullable(),
  /** Which repair round this is. 0 for a first build. */
  round: z.number(),
  /** Every verdict so far. */
  verdicts: z.array(Verdict),
  /** The reviews this pull request owes. */
  owed: z.array(ReviewClass),
  /** The required checks that failed at the head. Empty unless checks are red. */
  failures: z.array(FailedCheck),
  /** Guards that are red here for a known reason, with the issue that says so. */
  knownRed: z.array(z.object({ guard: z.string(), issue: z.string() })),
  /** A folder for throwaway files. */
  scratch: z.string(),
});

export const Brief = z.object({
  // shell, prompt, issue, pr: as today
  handover: Handover,
});
```

| Field | Evidence |
|---|---|
| `issue`, `criteria` | `build issue` 5 times, `review criteria` 3, `gh issue view` on the lane's own issue 3, `build comments` 5 times against a verb that is not there |
| `pr`, `round`, `verdicts` | `build verdicts` 4 times by builders, `review verdicts` 3, `gh pr view` 10 |
| `owed` | `review scope` 3 times, and `ship gate --require` twice |
| `failures` | The first reviewer of run 2 made 6 `gh` calls to find and read the failing job's log |
| `knownRed` | `build check` was red on one guard, `codeowners-cp`, in both runs. Two builders, one per run, each searched for and read the same older issue to learn it was known noise. A later builder repeated the finding in its closing message |
| `scratch` | `build scratch` twice |

Less sure: how much of this belongs in the brief and how much behind a tool the worker calls when it needs it. A long issue thread in every prompt costs tokens on every turn.

### Pull requests and checks

New service. It takes `pr` and `queue` from `Fabrika`, because neither is about the ledger.

```ts
export const PrState = z.object({
  mergeable: z.enum(["mergeable", "conflicting", "unknown"]),
  checks: z.enum(["pending", "green", "red"]),
  /** New. The commit these two answers are about. */
  head: z.string(),
});

/** New. One required check that failed. */
export const FailedCheck = z.object({ name: z.string(), url: z.string(), logTail: z.string() });

/** New. `problems` are sentences, each one a reason it may not merge yet. */
export const Enqueued = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), problems: z.array(z.string()) }),
]);

export class PullRequests extends Context.Service<
  PullRequests,
  {
    /** Asked once: the pull request now. Was `Fabrika.pr`. */
    readonly read: (pr: string) => Effect.Effect<PrState, Unknown>;
    /** New. Stays open: the state now, then again on every change, until the listener leaves. */
    readonly watch: (pr: string) => Stream.Stream<PrState, Unknown>;
    /** New. The required checks that failed at this head. */
    readonly failures: (at: { readonly pr: string; readonly head: string }) => Effect.Effect<readonly FailedCheck[], Unknown>;
    /** New. The merge gates at this head, as problems. None is a pass. */
    readonly ready: (at: { readonly pr: string; readonly head: string }) => Effect.Effect<readonly string[], Unknown>;
    /** New. Put it in the merge queue. It runs `ready` itself and refuses on any problem. No flag skips that. */
    readonly enqueue: (request: { readonly pr: string; readonly head: string } & Intended) => Effect.Effect<Enqueued, Unknown>;
    /** Stays open: what the merge queue did. Was `Fabrika.queue`, one read at a time. */
    readonly queue: (pr: string) => Stream.Stream<QueueReading, Unknown>;
  }
>()("PullRequests") {}
```

| New | Evidence |
|---|---|
| `head` | Run 2 recorded three builders dead while the pull request's head had moved. The machine had no way to see that |
| `watch` | The machine polled 13 and 11 times. Workers waited on the same checks 8 more times across the two runs |
| `failures` | The reviewer's 6 `gh` calls above |
| `ready`, `enqueue` | The shippers' `ship scope`, `ship gate`, `ship checks`, `ship threads` and `ship enqueue`, twice each, with no judgment in between |
| `queue` as a stream | `ship reconcile` blocked a paid session for 354 and 325 seconds |

Less sure: `ready` returns plain sentences. The CLI's ship gates have their own exit codes and I have not read what each one separates.

### Verdicts

New service. Today a verdict is a comment the reviewer posts with `review post`.

```ts
export const ReviewClass = z.enum(["code", "doc"]);
export type ReviewClass = z.infer<typeof ReviewClass>;

export const Verdict = z.object({
  class: ReviewClass,
  polarity: z.enum(["PASS", "FAIL"]),
  /** The commit it judged. A verdict on an older commit counts for nothing. */
  head: z.string(),
  round: z.number(),
  /** One line that says why. */
  clause: z.string(),
  /** The full finding. */
  body: z.string(),
});
export type Verdict = z.infer<typeof Verdict>;

export const Posted = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), url: z.string() }),
  /** `own_work`: the run that built this head may not judge it. */
  z.object({ ok: z.literal(false), why: z.enum(["not_a_reviewer", "own_work", "stale_head"]) }),
]);

export class Verdicts extends Context.Service<
  Verdicts,
  {
    /** Every verdict on the pull request, oldest round first. */
    readonly on: (pr: string) => Effect.Effect<readonly Verdict[], Unknown>;
    /** Post one verdict, as the worker run named. */
    readonly post: (
      request: Intended & { readonly pr: string; readonly verdict: Verdict; readonly by: WorkerRun },
    ) => Effect.Effect<Posted, Unknown>;
  }
>()("Verdicts") {}
```

Evidence: `review post` ran 5 times, once per review class per round. Each call passed the class, the polarity, the head, the round and a one-line clause as flags, and the body on stdin. Those are the fields of `Verdict`. The two classes are the two the runs used. The worker list in `src/fabrika.ts` also has a reviewer for rendered pages. Neither run used it, so its class is left out here.

Less sure: `by` is a plain value here. A stronger shape would be a token only the machine can make when it starts a reviewer, so a builder cannot hold one at all. I have not worked out how that token reaches a worker that is a separate process.

### Claims

No new service. `claim` and `release` stay on `Fabrika` as they are. One new method.

```ts
// On Fabrika.
/** New. Free everything one worker run still holds on the lane. Safe to repeat. */
readonly releaseWorker: (request: At & Intended & { readonly run: string }) => Effect.Effect<Written, Unknown>;
```

Evidence: each of the three builders that ended early in run 2 left its build claim behind. The next builder found it with `build claims stale`, took it over with `build adopt`, and released it with `build release`. That happened 3 times and took 9 verbs. Across both runs the workers spent at least 35 verbs on their own claims: `build claim` 9, `build confirm` 10, `lane working` 6, and 10 on `build claims stale`, `build adopt` and `build release`.

Less sure, and bigger: a lane the machine drives may need no worker claim at all. The machine holds the lane's one claim and starts one worker at a time. Then all 35 verbs go, and so does `releaseWorker`. A worker claim still matters when a person starts a builder by hand with no machine, so it cannot simply be deleted.

### Working copies

`Worktrees` keeps `make` and `remove`. Two additions and one change.

```ts
/** New. A working copy, read. */
export const TreeState = z.object({
  clean: z.boolean(),
  branch: z.string().nullable(),
  head: z.string(),
  /** Is `head` on the remote. */
  pushed: z.boolean(),
});

// On Worktrees.
/** New. Put the lane's branch in the tree: a new one, or the pull request's as it stands. */
readonly branch: (
  request: { readonly name: string; readonly from: "default" | { readonly pr: string } } & Intended,
) => Effect.Effect<void, Unknown>;
/** New. */
readonly state: (name: string) => Effect.Effect<TreeState, Unknown>;
/** Changed. It also deletes the local branch the lane made. */
readonly remove: (request: { readonly name: string } & Intended) => Effect.Effect<void, Unknown>;
```

| New | Evidence |
|---|---|
| `branch` | `build branch` at least 5 times in run 2. Each of the four repair builders ran `build branch --resume` in the lane's one working copy, where the first builder had already made that branch |
| `state` | `build tree` 21 times and `git status` 15 times by builders, mostly to confirm what the machine set up |
| `remove` deletes the branch | Both runs left the builder's local branch in the repo |

Less sure about `branch`. The branch name is the builder's choice today, and its slug comes from the issue's title.

### Questions to a person

`Thread` stays as it is: `post` and `replies`. I propose no change, because no lane parked in either run and no question was ever posted live. Designing here now would be designing from imagination. Section 7 puts a parked lane before any change to it.

## 5. What the runs showed is missing

### A dead worker's claim stays behind

In run 2 the machine recorded three builders dead. Each left a build claim. The next builder cleaned it up by its own judgment, 3 times out of 3. It worked, but it is the machine's job, and a builder that judges "the last worker is dead" from `ps` output can be wrong.

Smallest API: `Fabrika.releaseWorker`, above.

### No event when checks finish

The machine waited 7.0 minutes in run 1 and 5.7 in run 2 by asking every 30 seconds. That wait is free. The same wait inside a worker is not. Builder 2 of run 2 pushed its fix, started a wait on checks in the background, and ended its turn. Its session ended with the turn, so its report never ran. Builders 3 and 4 did the same. Those three laps cost $1.94 to find a finished fix three more times.

There are two shapes for this, and the library should have both.

- **Asked once.** `PullRequests.read`. One question, one answer. The machine uses it when it enters the review state, and again after a restart.
- **Stays open.** `PullRequests.watch`. It gives the state now and then every change. The machine keeps it on only while it sits in the waiting state.

A caller that wants "block until the checks finish" takes the first finished value from `watch` and sets its own time limit. So there is no third method. That third method is what `review ci --wait` and `ship checks --wait` are today, and each one has its own budget flag.

The first implementation of `watch` can poll, as the host does now. A later one can listen to GitHub. The type does not change.

### The lane is read more than once per pass

Run 2 read the lane 22 times: 10 to start a pass, 8 to confirm a worker's report, 4 to read back a write. A confirm read and the next pass's read are one second apart and see the same lane.

Smallest API: `Written.view`. Every write answers with the lane as it left it. Together with the machine handing its confirm read to the next pass, run 2 needs 10 reads and run 1 needs 5. A direct implementation then reads the ledger once per read. Today it starts two processes.

### Red checks still go to a reviewer

In run 2 the checks finished red at 02:36:53. Three seconds later the machine started a reviewer. It cost $1.00 and 2.2 minutes, and its finding was the failing job's log.

Smallest API: `PullRequests.failures`, and one more fact for `record`.

```ts
// A new member of DriverFact.
/** The required checks finished red at this head: back to the builder, with what failed. */
z.object({ kind: z.literal("checks_red"), head: z.string(), failures: z.array(FailedCheck) }),
```

Less sure, and not decided. That reviewer added one sentence the log does not carry: fix the product, not the test. The repair builder followed it. Also, 0.9.0 already has a park cause named `head-ci-red` with a recipe. No run has used it, so I do not know what it does with the work.

### A worker that stops early cannot be asked to finish

Each early builder's conversation was still there when the machine called it dead. One short turn in it, "you ended without reporting, finish your last step", costs cents. A new builder cost $0.49 to $0.83 to read the issue, the pull request and the change again.

The runner can already continue a conversation by its id. What is missing is where the id lives. Today the machine builds it from its own run's name and keeps it in its own saved state. A second run of the machine has another name and cannot find it.

Smallest API: `WorkerRun.session` on `dispatched`, shown back in `TaskView.worker`. No new method.

### "Dead" is decided without looking

The machine's rule was: the worker ended, the lane did not move, there is no last word, so it is dead. Builder 2 had pushed a correct fix. "Ended without reporting, but pushed" is a different fact from "died".

Smallest API: `PrState.head`. The machine compares the head before and after the worker. A moved head means continue the conversation first, and record a death only if that fails.

### Workers are told about verbs that are not there

The skills the workers read are newer than the pinned CLI. `lane cleanup` and `build comments` ran 7 times in all and never worked. One of them put a false sentence in two closing messages.

Smallest API: none. It is a packaging rule. The library, the tools a worker gets and the text that tells a worker about those tools ship as one version. If the worker's tools are made from the service types, a tool that does not exist cannot be on the list.

### The shipper is an agent doing code's job

See section 3. Ten verbs, the same order twice, no judgment in the log, and about 90% of its time inside one blocking command.

Smallest API: `PullRequests.ready`, `enqueue` and `queue`. The machine's `ship` state becomes a check, a write and a listener. The time limit for a merge queue that does nothing is already in the machine.

## 6. What stays outside the library

**The agent work.** Reading the code. Writing the change, its tests and its docs. The commit message, the pull request's text and the hand-over note. Finding why a check failed, as builder 2 did when it traced a stray line to how a child process shuts down. The review itself: reading the change against the criteria and writing the finding. The library can carry these words. It does not write them.

**Decisions a person must make.** Parks whose cause the table in `src/fabrika.ts` gives to a person: an owner's approval, and work that has spent its size. Any park no recipe covers. One more round of repairs after the budget is spent. `Fabrika.clear` takes a person's own words as `said`. Those words come from `Thread`, which skips every comment a machine marked, and the machine reads replies only from the people on its list.

**No code path lets an agent approve its own work.** The library keeps this rule in four places.

- There is no `approve` method anywhere.
- `Verdicts.post` refuses a verdict from the run that built the head, and from any run that is not a reviewer.
- `PullRequests.enqueue` checks the gates itself, at the head it is given. No argument skips them.
- A worker's tools never include `clear`, `unpark`, `enqueue`, `releaseWorker` or anything on `Worktrees`. Those are the machine's.

The check that runs before each worker step, in [`src/shell-guard.ts`](../src/shell-guard.ts), stays where it is. It refuses a direct merge, among other things. It is a second lock, not a part of the library.

## 7. How to get there in steps

The rule for every step: the CLI wrapper stays as one implementation of the services. A direct implementation grows beside it, one service at a time. The in-memory fake is the third. All three must pass the same tests, and the machine does not know which one it runs on.

| Step | What changes | What shows it worked |
|---|---|---|
| 1 | `PullRequests` on its own, read-only: `read`, `watch`, `failures`, and `head` on `PrState`. A direct implementation runs beside the wrapper and both answers are logged | The two agree on every read of a live lane |
| 2 | Writes answer with `Written`. The machine reads the lane once per pass | A lane shaped like run 2 makes about 10 lane reads, not 22 |
| 3 | `WorkerRun` on `dispatched`, `releaseWorker`, and continuing a worker's conversation | A worker that ends early costs one short turn, and leaves no claim |
| 4 | `Handover` in the brief | A builder's run has no `build tree`, `build claim`, `build confirm` or `build issue` in it |
| 5 | `ready`, `enqueue`, `queue`. The shipper is code | A lane merges with two agents, not three |
| 6 | A worker's result is its typed last answer, and the machine records it. `lane report` goes | The "its report never landed" branch is deleted from the machine |
| 7 | The ledger and its rules move behind `Fabrika` directly. The wrapper can go | Runs 1 and 2 replay with no CLI process at all |

**The smallest useful first step is step 1.** It only reads, so it can run next to the wrapper on a real lane and be compared answer by answer with nothing at risk. It needs none of the ledger's rules. And three of the gaps in section 5 need what it adds: the checks event, the red-checks hand-back, and looking before calling a worker dead. The tradeoff: step 1 saves almost no money by itself. The money is in steps 3 to 5. I put my confidence in this order at about 70%. Reading how the CLI decides which checks are required would raise it, because the direct implementation must give the same answer.

Before any step changes how parks work, park one lane on purpose, so `Thread`, `unpark` and `clear` meet a real person once.

The wrapper may be worth keeping after step 7 as a thin command line over the library, for people. That is not this document's call.

## 8. Open questions

1. Does the direct implementation import the CLI package's own verb code, once it exports the `lane`, `build`, `review` and `ship` groups, or is it written again here?
2. The CLI pins a release candidate of Effect 4. This repo is on 4.0.0. Can one process load both?
3. How does a worker reach the library: typed tools, or only its typed last answer?
4. Red checks: straight back to the builder, or a reviewer first?
5. Does a worker need its own claim when a machine drives the lane?
6. Who names the branch: the machine or the builder?
7. How much goes in the brief, and how much behind a tool?
8. Can a reviewer's right to post a verdict be a token only the machine can make?
9. Does `Fabrika` keep its name once four services sit beside it?
10. Epics and chores: no live run has touched them. Do they change any type here?
