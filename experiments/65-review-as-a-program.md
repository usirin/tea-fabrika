# 65. The review stage as a program, with the agent inside a machine

```ts
// upstream | review | ship, read only, on fakes and a scripted reviewer
const ship = yield* start(shipProgram, {mode: "read"}, {found: found.hear});
const review = yield* pipe({program: reviewProgram, flags, listeners: {verdict, note}}, "passed", ship, "pr");
const up = yield* pipe({program: upstream, flags: {}}, "pr", review, "pr");

for (const n of [11, 12, 13, 14]) tell(up.run, "pr", url(n));
up.close("pr");                 // upstream ends, then review, then ship: nobody stops anything
// verdicts: 11 done, 12 send:builder:checks_red, 13 send:builder:review_failed, 14 done
// ship heard: 11, 14, in that order
// the note the agent filed on 11: in the machine's state while it ran, and in 11's verdict
```

The questions:

1. Can a stage with an agent inside become a machine plus a program, the way
   ship did in experiment 63?
2. Can the agent's tools be typed reads plus inputs its machine opens to it,
   where every call that changes anything is a Msg folded into state? Does
   the judgment still come back once, at the end, as the typed form? Can a
   criterion be only open or met?
3. Does `review | ship` work with `pipe`?

**Answer: yes to all three.** The review is now a tea machine with six
phases and a program that is told pull requests and sends a verdict for
each. The agent's run is a **Subscription** of the machine, not a Cmd: it
keeps saying things while it runs (a note now, the form at the end), and a
Cmd answers once. The one opened input, `file_note`, reaches the machine as
a Msg, and the machine files it with an Act. The form still comes back once,
at the end. Piped between a stand-in upstream and the real ship program in
read mode, four real-shaped pull requests went through: only the two that
passed reached ship, in order, and the whole pipe ended on its own, three
runs out of three. Against the old one-function review on 8 real pull
requests and 2 scripted forms, the new program gave the same answer in 16 of
16. `@demlik/tea` did not change.

About 80% sure of the shape. The doubts: the whole brief rides in the Sub's
deps and is hashed on every update; a restart pays for a new agent run; and
the Sub stream's Msgs are not checked by tea, so the form is decoded by hand
on the way in. See [Limits](#limits).

## The machine

```text
idle ── start ──▶ gathering ── pack read ──▶ (the gate, pure code)
                                             ├─ stop (red check, draft, merged, no ticket…) ──▶ over
                                             ├─ a required check still runs ──▶ waiting
                                             └─ go ──▶ reviewing
waiting ── checks settled ──▶ gathering again (read at the same head)
waiting ── the clock runs out ──▶ over (stuck:checks_stuck)
reviewing ── review_note ──▶ reviewing (note kept, an Act files it)
reviewing ── review_reviewed / review_failed ──▶ judging (a note still being filed) or over
judging ── each note answered ──▶ over
```

| Phase | What is in it | What runs |
|---|---|---|
| `idle` | nothing | nothing |
| `gathering` | the ask, the read in flight | Cmd `review_pack` (a Gather) |
| `waiting` | the head | Sub `review_checks` (a Listen on the checks) and Sub `review_checks_overdue` (a timer, 15 minutes) |
| `reviewing` | the brief, the run number, the notes so far | Sub `review_run`: the agent |
| `judging` | the outcome and the judgement, the notes still being filed | nothing but the open `review_file_note` Acts |
| `over` | the outcome and the report | nothing |

Cmds: one Gather, `review_pack`, and one Act, `review_file_note`, whose
intent (`review/<pr>/<head>/note/<id>`) is in the state before it is sent.
Subs: the agent's run, the checks, the clock. The verdict, the comment's
text and the outcome are pure code over the form, in `update`, as before.

## The program

```ts
defineProgram({
  name: "review",
  flags:   {rubrics: string, model: string, effort: "low"|"medium"|"high", budget: number > 0},
  inputs:  {pr: ReviewTarget},          // .../pull/<n>, or .../pull/<n>/commits/<40 hex> to replay
  outputs: {
    verdict: Reviewed,                  // once per pull request: outcome, criteria met/open, notes, cost
    passed:  PullRequestUrl,            // ship's own input type: `review | ship` is one pipe
    note:    Filed,                     // each note as it is filed. Kept here, posted nowhere
  },
  machines: {review},
  main: inputs.pr → for each: run the machine to `over`, send `verdict`, and `passed` if done and not a replay,
})
```

The old `--head <sha>` flag is gone: a replay is a url with
`/commits/<sha>`, so each value on the input says everything about one
review. `passed` is not sent for a replay, since a replayed commit is not the
head now and ship would refuse it anyway.

`run.ts` is now a thin launcher, like ship's: it checks the command line
before making any service, starts the program on GitHub's read side and the
live reviewer, tells each url, closes the input and prints what comes out.

## How `file_note` travels

```text
agent calls mcp__review__file_note({title, body, at})
  → the in-process MCP tool's handler calls the door: tools.file_note(note)
  → the door offers {kind: "note", note} to the Sub's stream and answers "taken"
  → the stream maps it to Msg review_note {pr, head, run, note}
  → update: a note not seen before (by id from its title) is kept as "asked",
           and Cmd review_file_note is sent with its intent
  → the program's handler sends it on the output `note`, answers "kept"
  → update: the note is "kept" (or "failed"); the report lists it
```

The agent's other tools are Read, Grep and Glob over a copy of the code at
the head. Nothing else that changes anything is open to it.

Two things make the order safe. The SDK hands back its result only after
every tool call it made has been answered, so every note is offered before
the form is. And a run that ends with a note still being filed waits in
`judging` until that note is answered, so the verdict always lists it.

A live probe checked the in-process tool on the real SDK with a string
prompt: the agent saw `mcp__review__file_note` in its tool list, called it,
and the call came through the door. Two small haiku runs, about $0.001.

## Why a Subscription, and the shapes that were rejected

Elm's answer: a Cmd asks for one thing and gets one Msg back. Something that
keeps sending while it runs is a Sub. The agent is the second kind: it can
file a note at any time and then hands back the form.

**The Sub.** `review_run` is on while the phase is `reviewing`. Its deps are
`{pr, head, run, brief, settings}`. Its runner is a `Stream`:

```ts
export const reviewStream = (draft: (tools: Tools) => Effect<Drafted>): Stream<Said> =>
  Stream.callback<Said>((line) =>
    Effect.forkScoped(Effect.gen(function* () {
      const tools: Tools = {
        file_note: (note) => Effect.sync(() =>
          Queue.offerUnsafe(line, {kind: "note", note}) ? "taken" : "refused"),
      };
      const drafted = yield* draft(tools);
      Queue.offerUnsafe(line, {kind: "ended", drafted});
      Queue.endUnsafe(line);
    })));
```

The doors are made inside the stream's own scope, so they exist exactly as
long as the run does. There is nothing to fill in later. When the phase
leaves `reviewing`, the Sub is off, the stream is cut, and the agent with it.

Rejected:

- **A Cmd handed a dispatch door.** The handler would need the runtime's
  `dispatch`, which exists only after `handle.ready`. That means a
  `Deferred` holding the runtime, or a `let dispatch` filled in after
  start: a slot bound late. It is the smell the owner named, and it routes
  Msgs around the machine's own subscription bookkeeping.
- **A plain Cmd that returns notes with the form.** No slot, but a note is
  only seen at the end. If the run is cut or goes over its budget, the notes
  are lost. It also breaks (2a): a call that changes something must be a Msg
  when it happens, not a field of the final answer.
- **A Cmd per tool call, the agent paused between them.** The SDK runs the
  agent's loop. There is no clean way to pause it on a tea Cmd and resume it
  with the answer.

## Restarts

The machine's state is the only thing kept, so a restart is `resume` on it:

- In `gathering`: the read is asked again.
- In `reviewing`: the agent is started again as run `n + 1`. A new run is a
  new Sub (the run number is in its deps), so any late Msg from the old run
  is dropped by `update`. The notes so far stay, notes still being filed are
  filed again, and a note the new run files again is kept once (same title,
  same id). Each run pays again; after `MAX_RUNS` (2) the review ends as
  `stuck:over_budget`.
- In `judging`: the notes not yet answered are filed again.

## Decoding the form inside the stream

tea checks a Cmd's answer against its schema. It does not check a Msg that
comes from a Sub. So `msgOf`, which turns what the run said into a Msg,
decodes the form with Effect Schema there and then. A form that does not fit
becomes `review_failed` with why `misfit`, a declared outcome, and never
reaches `update` as a form. The cost: this check is by hand, in one place,
and a new Sub that carries data has to remember to do the same.

## What changed for "only open or met"

The form the agent fills is unchanged: rows with pass, fail or unseen, and
findings. Only the view of the result changed. `criteriaOf` turns the sheet
into `Judged` rows, each `met` or `open`:

- a ticket criterion is `met` when its row passed and no finding against it
  is open; otherwise `open` (a failed row, an unseen row, a missing row);
- a standing check's finding that no criterion covers becomes a new
  criterion, numbered after the ticket's last, and it is `open`.

An open criterion means the review did not pass. The kinds' verdicts and the
outcome names are as before. The report (`verdict` output) now carries the
criteria, the notes and the runs; the `note` output is new.

## Old and new, side by side

`experiments/65-review-old-vs-new.ts` runs the old one-function review from
`main` in a temporary worktree (removed after) and the new program from this
branch, both read only, both with the same scripted reviewer and the same two
forms worked out from the brief (`lib/scripted-forms.ts`). 8 targets times 2
forms: **16 of 16 the same**: the same brief handed to the reviewer (by
hash), the same gate stop, the same verdict per kind, the same comment text
(by hash) and the same outcome.

| Pull request at | Pass form | Fail form |
|---|---|---|
| 628 at 6f4907a | checks_red | checks_red |
| 628 at b695a2a, 634, 650, 687 at ddfa24d | done | review_failed |
| 683 at 48f1feb | done:part | review_failed |
| 687 now | skip:merged | skip:merged |
| 675 now | skip:draft | skip:draft |

Results: `experiments/results/65-review-old-vs-new.json`.

## Live runs

Three runs of `run.ts` on real kamp-us/demlik pull requests, read only,
opus at medium effort, a $3 limit each. Nothing was posted.

| Pull request | Today's reviewer | The program | Cost | Tokens (all / context) | Minutes |
|---|---|---|---|---|---|
| [#687](https://github.com/kamp-us/demlik/pull/687) at ddfa24d, merged (replay) | PASS code, PASS doc | `done`: 8 of 8 met, PASS, PASS | $0.67 | 404,009 / 61,319 | 1.2 |
| [#650](https://github.com/kamp-us/demlik/pull/650) at 4814280, a known fail (replay) | FAIL code, FAIL doc: one false sentence in the `Cmd.define` doc comment | `send:builder:review_failed`: 7 met, 2 open, FAIL, FAIL | $0.30 | 60,623 / 30,122 | 0.6 |
| [#596](https://github.com/kamp-us/demlik/pull/596) at af2e898, open | PASS code, PASS doc | `done`: 7 of 7 met, PASS, PASS, one note filed, sent on `passed` | $0.54 | 538,297 / 40,137 | 1.3 |

Total $1.51, under the $10 limit. One more probe of the opened tool on haiku
cost about $0.001.

The verdicts match today's on all three. Where they differ:

- **#650** found the same fault today's reviewer did: the `Cmd.define` doc
  comment names `Schema.toType` as the way through for a schema that needs a
  service, which drops that schema's check. That is criterion 9, open. It
  also left criterion 3 open, because that criterion's proof is a ruling in
  a comment on the ticket's thread, and the pack does not hold the thread
  (step 6 is not built). Today's reviewer reads the thread. Both say FAIL;
  the program's reason list is one longer.
- **#596**: the agent filed a real note through `file_note`: the repo's
  list of doc places names no home for dated reports, and the change adds a
  `reports/` folder. The call came through the door as a Msg, the Act
  answered, the note was in the verdict and on the `note` output, and the
  pass still went out on `passed`. Today's reviewer has no such tool; it
  would have put this in its comment or said nothing.
- **Cost:** the first piece's live runs (in `docs/review-machine.md`) cost
  $0.90 and $1.12; these cost $0.30 to $0.67. Three runs on other pull
  requests do not show the program is cheaper. It adds no agent work: one
  agent per review, as before.

## Tests

The user's job (`program.test.ts`): a stand-in upstream told four pull
requests built from recorded fixtures, piped into review, piped into the
real ship program in read mode, on fake services and the scripted reviewer.
11 passes and its agent files a note twice; 12 has a red check; 13 fails a
criterion; 14 passes. Three runs, each asserting: one verdict per pull
request in order; the red one started no agent; ship heard and read only 11
and 14, in order; the note was in the machine's state while the agent ran,
kept once, in 11's verdict and on the `note` output; every criterion met or
open; all three programs ended on their own; and the three runs are the
same.

Mechanism rows, each a test: a run over its budget ends as
`stuck:over_budget` with its cost kept; a red check stops with no agent; a
problem no criterion covers becomes criterion 6, open, and the review does
not pass; the handle shows `idle → gathering → reviewing → over`; a note is
in the state while the agent is held mid-run. `machine.test.ts` steps the
machine by hand, including each restart case and the misfit decode.

## Simpler and harder than ship

Simpler:

- One read and one Act. No write side at all, so no `CodeHostWrites` and no
  read/write split in the handlers.
- `main` is the same shape as ship's: for each value on the input, run the
  machine to its end, send what came out.

Harder:

- The agent is a Sub, not a Cmd. Ship has only Cmds and one Listen.
- A Sub's Msgs are not checked by tea, so the form is decoded by hand.
- A restart costs money. Ship's restart re-reads; review's starts a new
  agent, so it needs a cap.
- A `judging` phase exists only to wait for notes still being filed.
- About a fifth more code: machine 412 lines against ship's 336, program 164
  against 107.

## Limits

- **The brief is in the Sub's deps.** tea finds a Sub by a hash of its
  deps, so the brief (with the whole diff) is hashed on every update while
  reviewing. It is cheap at today's sizes; a large diff would make it
  noticeable. A brief id in the deps and the brief in state would avoid it.
- **One opened input.** `file_note` proves the path. Scouts (agents the
  reviewer starts) are the next step and need a supervisor: a machine that
  owns child runs.
- **Notes go nowhere.** The Act sends a note on an output. Posting it, or
  filing an issue, is a write the read-only program does not do.
- **A pipe has no back pressure.** Same as experiment 64.
- **Three live runs** are three. They show the program runs the real agent
  end to end, not that its verdicts match today's reviewer in general.
