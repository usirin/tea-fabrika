# 52. A lane parked on purpose, and the machine asks a person

Sections 49 and 50 both ended on the same gap: nothing parked, so the machine
never asked anyone anything. This run was picked to park.
[kamp-us/demlik#623](https://github.com/kamp-us/demlik/issues/623) is a small
bug in tea's `api:ratchet` script, and one of its criteria makes the builder
edit a comment in `.github/workflows/build.yaml`. Everything under `/.github/`
has owners. The pull request cannot ship until an owner who is not its author
approves it, and no machine may give that approval.

**Answer: it parked, asked, gave up cleanly, and a second run shipped it. The
person's reply was never read.** Run 1 built and reviewed the fix. Fabrika's
shipper parked the lane, and the machine posted one question on the issue.
Nobody answered for 10 minutes, on purpose, and the run ended parked with
nothing left held. Then a person approved the pull request and replied. Run 2
started, fabrika's recipe saw the approval, and the park was clear 15 seconds
in, before the machine had looked for its question.
[PR 629](https://github.com/kamp-us/demlik/pull/629) merged through the queue.
Two runs, 45 minutes from claim to end, $3.51, four shells, 39 Cmds, and no
Jev call by the machine.

So the ask works as far as it was exercised, and the half I most wanted to
see, a reply read and acted on, still has not run live.

## Who did what

| Part | Whose | Here |
|---|---|---|
| The driver: claim, working copy, routing, the wait on CI, the park's gate, the question, the wait for an answer, the listen on the merge queue, the clean-up | tea-fabrika (`src/operator.ts`, `src/turn.ts`) | 39 Cmds over two runs, no tokens |
| Builder, reviewer, shipper | today's fabrika: its skill agents, started by the machine through the Agent SDK | 4 runs, $3.51 |
| The lane's ledger, the park, the recipe that re-checks an approval, the queue verbs | today's fabrika: CLI 0.9.0, behind the `Fabrika` wrapper (`src/fabrika-cli.ts`) | 67 verbs |
| The question on the issue, and the listener for replies | tea-fabrika (`Thread`, `src/operator-live.ts`) | 1 comment |
| Reading a reply in words | Jev, asked by tea-fabrika's `park_read` Judge | not called by the machine |

## Before the run

- **Who may answer, and how long a question waits, come from the run's
  environment.** `WHO=<login>,<login>` and `ASK_WAIT_MIN`, read by `knobsOf`
  in `src/operator-host.ts` before anything is claimed. The default list was
  empty, so with the defaults nobody's reply would ever have counted. A run
  that names nobody is refused now. This run named two logins, the account the
  machine posts from and a second owner's, and waited 10 minutes.
- **A lane's claim is not a reply.** Found by reading fabrika's source, not by
  a test. Fabrika 0.9.0 posts a claim on the issue as a plain line,
  `lane-claim: …`, with no hidden mark, under the account the owner answers
  from. A second run claims the lane after the first run's question, so its
  own claim is a later comment by a listed person. The thread Layer took every
  comment without a hidden mark for a person's, and would have sent the claim
  to the Judge. On a made-up claim line Jev answered `leave` at 0.46. That is
  under the 0.8 floor, so the cost would have been one wasted call, this time.
  The Layer now knows fabrika's unmarked records by their keyword.
- **The Check refuses an approval.** The shells run under an account that
  could approve, and the ship skill only asks the shipper not to. A review
  that approves and a comment that carries the owner's self-approval words are
  refused. Reading for them is not.
- **Tests for both halves.** On the scripted fake, with the lane shaped as it
  would be live (parked out of `ship`, waiting on an approval): an unanswered
  question ends the run parked, the copy removed and the lane let go. A later
  run either has its recipe clear the park, or finds its question, posts
  nothing, and reads the reply made since. The live thread Layer had no tests
  at all. It has three now, over a stand-in `gh`.

No dry run started a shell. Three Jev calls on made-up replies checked the
Judge's wiring.

## Run 1: build, review, park, ask

Times are UTC on 2026-10-11.

| Time | What happened | Cost |
|---|---|---|
| 04:49:52 | Claim, boot the lane, make the working copy, write "started" |  |
| 04:50:12 | **Builder.** The script now refuses when no base is given. Opened PR 629, with the `build.yaml` comment in it | $1.90, 9.3 min |
| 04:59:35 | Read the PR: checks pending. Waited 5.2 minutes | Listen |
| 05:04:45 | **Reviewer: PASS**, on the code and on governance, which the `.github` file made a required verdict | $1.02, 2.4 min |
| 05:07:18 | **Shipper.** No owner approval on the head. It noted that on the PR, reported `AWAITING-CP-APPROVAL`, and ended | $0.31, 0.6 min |
| 05:07:58 | Read the lane: `human:cp-approval`, cause `awaiting-cp-approval` |  |
| 05:08:03 | Tried fabrika's recipe: not yet. The cause is a person's, so no second try | Act |
| 05:08:04 | Posted the question on the issue | Act |
| 05:18:08 | Ten minutes, no reply. Removed the working copy, released the lane | Act |
| 05:18:11 | Ended `parked` |  |

The review passed on its first round, so there was no repair. The machine sent
23 Cmds, which became 42 fabrika verbs. Two came back non-zero and both were
answers: "no lane yet" and "not yet".

Afterwards I checked what was left. The run's state said `parked`. The trees
folder was empty and git listed no working copy. Fabrika's seats read zero
held, with lane 623 idle, and no claim comment was on the issue. The question
was there. The PR was open, green, with no review and no merge armed, and its
last comment was the shipper's note from 05:07:49. The repo's main checkout was
on `main` at the commit it started on, clean. One leftover, as in both earlier
runs: the builder's local branch.

## The question, as a person met it

```
The lane on https://github.com/kamp-us/demlik/issues/623 stopped at `human:cp-approval` (`awaiting-cp-approval`). It waits on a call or an act only a person can make.

The machine driving it has no rule that clears this, so it is waiting on you.

Answer in words, or with one of these:
- `/resume`: It is handled: carry on from where the lane stopped
- `/more`: Give the work one more round of repairs, then carry on
- `/leave`: Leave the lane parked: a person will take it from here
```

It does not say what to do. It names a state and a cause, and neither the pull
request nor the approval. The shipper's note on the PR said it plainly, but the
person was asked on the issue. Its second paragraph is also wrong for this
park. Fabrika does have a rule that clears it, once the approval is there.

I left it as it was for run 2, so the run met the question it had posted. It
is fixed now. The question names the pull request whenever the lane has one,
and for an approval park it reads:

```
To clear it: approve https://github.com/kamp-us/demlik/pull/629. The approval has to come from an owner of the files it changes who is not its author, on the pull request as it stands now. Then answer `/resume` here.
```

## Between the runs

Nothing of the machine's was running. At 05:23:40 a second owner approved the
PR on its head. At 05:24:28 a reply went up under the question, in plain words
with no slash command, from the owner's account:
[the comment](https://github.com/kamp-us/demlik/issues/623#issuecomment-6105808219).
It says the approval is on the pull request and to carry on.

## Run 2: the recipe got there first

| Time | What happened | Cost |
|---|---|---|
| 05:24:55 | Claim, make a working copy, read the lane: still parked |  |
| 05:25:10 | Tried fabrika's recipe: **cleared**. The lane was back at `ship` | Act |
| 05:25:16 | **Shipper.** Approval, both verdicts, checks, threads: all pass. Queued the PR and watched the queue for 8 minutes | $0.29, 8.7 min |
| 05:33:56 | The shipper's watch ran out with the PR still queued. It reported that and ended |  |
| 05:34:03 | Read the lane: `ship:queued`. Listened to the queue | Listen |
| 05:34:24 | The PR merged |  |
| 05:34:37 | Second read of the queue: landed. Recorded it on the lane | Act |
| 05:34:45 | Posted the record, removed the working copy, released the lane | Act |

16 Cmds, 25 verbs, none of them non-zero. Afterwards: the PR merged, the issue
closed as completed, the lane `complete` with its record on the issue, no
claim, no working copy, the main checkout untouched.

Two things happened here for the first time.

**The recipe cleared a park.** A park's gate tries the recipe before it asks,
and on a second run that order holds again. The approval was in, so `recipe
unpark` appended the unblock itself and the machine never reached the code
that looks for its question.

**The merge-queue Listen ran.** In both earlier runs the shipper saw the PR
land inside its own turn. This time its watch ended 28 seconds too early. The
machine picked the wait up, read the queue twice, and recorded the landing.
The shipper had held an opus session open for 8 minutes to do the same wait.

## The reply that was never read

The person was asked for a reply, wrote one, and nothing read it. I ran the
`park_read` Judge once on the real texts, offline, with no writes
(`experiments/52-park-read.ts`). Jev read the reply as `resume` at 1.00,
against a floor of 0.8. The machine would have acted on it.

It would also have been the wrong thing to act on alone. `resume` unblocks the
lane, the shipper checks the approval again, and without the approval it parks
again. For this park the approval is the answer and the reply is noise. The
machine asked for two acts where one decides.

There is a worse side to the same thing. Once the question is up, the machine
never tries the recipe again in that run. If the approval had come four
minutes into the wait with no reply, the run would still have ended parked six
minutes later, and the lane would have sat until someone started another run.
With the default wait that is up to twelve hours of a lane that is ready to
ship.

The fix I would make: for a park whose recipe re-checks something a person
does, keep re-checking on a clock while the question is open. Then the
question can say "approve this, and you need not answer".

## An agent that posts as the owner is the owner

The builder left a hand-off note on the issue. It carries no hidden mark, and
its author is the account the owner answers from, because every shell and the
machine itself use that one account. It was posted nine minutes before the
question, so it was not a reply. Posted after a question, it would have gone
to the Judge as the owner's answer, and a sure reading would have cleared a
park on a machine's words.

The claim fix above closes one case by keyword. It does not close this one.
Whose reply counts is decided by the comment's author, and here every writer
has the same author. Not fixed, by decision. The options I see:

1. **Give the shells an account of their own.** Then the author says who
   wrote it, and the list of people means what it says. It is the only option
   that also covers agents outside this lane. It needs a second account or an
   app, with its own rights on the repo.
2. **Set aside every comment made while one of the run's shells was
   running.** The machine knows those windows exactly. Cheap, and only in
   tea-fabrika. It misses an agent the machine did not start, and it would
   drop a person's comment made in the same minutes.
3. **Count only a reply that names a choice outright.** `/resume` and nothing
   else. No agent writes that by accident. It gives up reading words, which is
   the reason the Judge is there.

I would do the first, and the second until then.

## Cost, beside the other lanes

`tokens` is the size of each run's conversation at its last turn, summed per
role.

| | #600 (agent) | #601 (agent) | #559 (machine) | #625 (machine) | #623 (machine, 2 runs) |
|---|---|---|---|---|---|
| Driver, tokens | 115,872 | 119,072 | **0** | **0** | **0** |
| Builders | 183,811 | 127,284 | 67,488 | 453,558 (5 runs) | 108,951 |
| Reviewers | 100,536 | 90,722 | 54,537 | 172,019 (2 runs) | 83,399 |
| Shippers | 36,354 | 36,387 | 30,407 | 31,099 | 62,403 (2 runs) |
| Lane total | 436,573 | 373,465 | 152,432 | 656,676 | 254,753 |
| Shell runs | 3 | 3 | 3 | 8 | 4 |
| Minutes, claim to end | 33.8 | 31.3 | 18.8 | 40.2 | 45.0 |
| Minutes inside shells | 31.5 | 28.8 | 11.1 | 32.8 | 21.0 |
| Dollars | not recorded | not recorded | $1.74 | $7.68 | $3.51 |

The 45 minutes are 28.3 in run 1, 6.7 with nothing running while a person
approved, and 9.9 in run 2. Ten of run 1's minutes are the wait for an answer,
which was set short for the experiment. The park cost one extra shipper,
$0.31, and no driver tokens. An operator agent sitting through the same park
either stays up and pays for it, or ends and has to be started again by a
person who remembers why.

## What else went wrong

- **The field rows called two shippers `stopped`.** One had parked the lane
  for the approval, one had queued the PR and run out of watch. Both did what
  the skill asks. Fixed: the first is `parked`, the second a `pass`, and this
  lane's rows in `field/runs.jsonl` use those words.
- **The question left no line in the run's log.** Between the park and the
  give-up the log is empty. Only fabrika's verbs are logged as they run, and
  the thread's calls to GitHub go another way. I found the question by reading
  the run's message file and then the issue.
- **The builder shipped with fabrika's own `build check` red** on one guard
  about CODEOWNERS, and said so in its note, pointing at
  [phoenix#10542](https://github.com/kamp-us/phoenix/issues/10542). CI was
  green. That is today's fabrika, and it did not change this run.
- The Check refused nothing in either run. The new approval rule did not fire.

Nothing was done by hand during either run. I read logs and GitHub.

## What this run still did not test

- **A reply read live.** By code or by Jev, and a park cleared on a person's
  word. It has run in tests and once offline.
- **A second run that finds its question and posts nothing.** The recipe ran
  first, so that code was not reached. It is tested over a stand-in `gh`.
- A reply that arrives inside the wait. An unsure reading. `/more`, `/leave`.
- The twelve-hour wait.
- A recipe that cannot say. `recipe unpark` answers 11, not 13, while GitHub
  has not settled whether the PR merges. The wrapper takes 11 for "could not
  read", and the run would stop without asking.
- An approval that stops counting: a push after it, or a later comment review
  by the same owner.
- A park with no recipe, the size stop, a recipe tried again on a clock.
- A shell stopped for time or for money. A restart. Two lanes at once, a
  conflict with a moved base, an epic.

Seen once now: a park, a recipe that says not yet, a question posted, a wait
that ends parked, a second run on a parked lane, a recipe that clears a park,
and the machine recording a landing from the merge queue.

## Next

1. Re-check the recipe while a question is open, and say in the question when
   no reply is needed.
2. Park a lane where the reply is the only way through, so a reply is read
   live. A park with no recipe would do.
3. Tell the owner from an agent: the time-window rule now, an account for the
   shells later.
4. Log the question's link when it is posted, and each reply with how it was
   read.
5. Treat the recipe's "cannot say yet" as a reason to try again, not to stop.
6. Take the queue wait out of the shipper. This run shows the machine's Listen
   does that job.
