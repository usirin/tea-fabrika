# 133b. Every closed needs-info ticket: does triage need "ask the filer"?

Experiment 133 read 15 of the closed kamp-us/phoenix tickets that once carried
`status:needs-info`. It asked whether triage needs a seventh answer, "ask the
filer for more", and said no at 75%. The doubts were the small sample and a
single reader. This reads all of them by hand, has a second reader check 133's
15 blind, and runs today's sort on the new ones.

**Answer: still no seventh answer, and now 85% sure. 133's answer holds. Of all
69 closed tickets, one waited on the filer. Its body was one external link and
an instruction to paste that link's content in. Nobody answered it, and there
was nothing to ask. A missing fact changed the end on 11 of 69. The code held
it 6 times and an owner 5 times. The filer held it 0 times. 13 parks put their
question to the filer, and the filer never gave the fact. An owner ruled or a
code read answered instead. And 49 of the 69 parks were not waiting on a fact
at all. Triage knew its answer, and a rule held it back. Either the ticket had
no agent footer, so triage could not close it, or no open milestone took its
priority. Today's sort, which has no "ask the filer" answer, reached the real
end on every run for 40 of 69 tickets, and none of its misses needed the
filer.** Cost: $3.06 for 108 sorts on sonnet, 1.45M tokens billed. I did not
sort 133's 15 again.

```ts
// One ticket of the answer key (133b-truth.json), and what today's sort said on it.
"4067": {
	end: "no",                       // closed: the verb it asked for had shipped
	asked: "any scope left, since the verb shipped before filing",
	to: "filer", answered: true,     // the ask named the filer; a re-triage from code answered
	who: "owner_permission",         // triage already knew; no footer, so it could not close
	from: "code",                    // the fact the park turned on sat in the code
	changed: true,                   // that fact moved the end away from the ticket's ask
}
// sort, two runs: plan / plan. A miss: it cannot read the code, so it cannot see the verb shipped.
```

## Who did what

- **The tickets, their labels, comments and closes:** today's fabrika on
  kamp-us/phoenix, before this run. Every `status:needs-info` label, every
  park comment and every answer to one was today's fabrika's triage, its
  agents and the owners.
- **The answer key (`133b-truth.json`):** this run, by hand, from each
  ticket's first body, its park comment and what came after. I wrote it
  before I saw any sort answer on the 54.
- **The blind re-read of 133's 15:** a fresh agent that had not seen 133's
  files. Then I opened 133's labels and read each disagreement again.
- **Sort:** this repo's sort stage, run outside its machine, exactly as in 133:
  `promptFor` and `sortProblems` from `packages/pipeline/src/stages/sort/brief.ts`,
  `SortReply` from `answer.ts`, `sorterOptions` from `sorter.ts`, and a second
  try told what the Check found, with `nextTry` from `combos.ts`. Claude
  `sonnet` at the SDK's default effort, no tools. The brief has the ticket's
  first revision and the 200 issues filed just before it. I did not change
  133's script. `133b-needs-info-all-closed.ts` copies its sort code, because
  133's script runs when it is imported.
- **This run wrote nothing to GitHub.** Every read went through `gh`,
  read-only. No lane ran.
- **Ticket text stays out of the repo.** It lives in the cache under `runs/`,
  which is never committed. A few tickets name a private product or an
  account. I checked the sorter's saved answers for those names and found
  none, so no `‹product›` stand-in was needed.

## Why 69, not 51

133 counted 80 tickets that ever had the label. 52 were closed, or 51 without
the triage self-test #44, and 28 were open. A fresh read of every issue's
label events finds 100 ever, 70 closed and 30 open. Without #44, the closed set
is 69:

- 133's 15;
- the other 36 of 133's 51;
- 18 closed tickets filed from #7852 on, which 133's count never reached.

How 133 missed the 18 is not known. All of them are newer than every ticket it
had. One more trap showed up on the way: the same GraphQL read at 100 issues a
page returned only 65 labelled tickets. At 25 and at 10 a page it returned the
same 100. The large page lost issues without an error. I did not dig into why.

## What each park waited on

The four rows are 133's own. "The code" includes the GitHub API. "An owner's
permission only" means triage already knew its answer and a rule kept it from
acting.

| Waited on | Tickets (133's 15 + other 36 + late 18) | The fact changed the end | Someone answered |
|---|---|---|---|
| The filer | 1 (1 + 0 + 0) | 0 | 0 |
| The code | 2 (1 + 1 + 0) | 1 | 2 |
| An owner's ruling | 17 (1 + 10 + 6) | 5 | 14 |
| An owner's permission only | 49 (12 + 25 + 12) | 5 | 40 |

- **Permission only, 49.** Two rules made all of these:
  - **No leave to close, 38.** Triage found a duplicate, a covering ticket or
    a false premise, and parked instead of closing. Mostly because the ticket
    had no "filed by an agent" footer; a few times because that triage run had
    no right to close at all.
  - **No home, 11.** In the 18 late tickets the label mostly meant "no open
    milestone takes this priority yet". The owner let the ticket in anywhere
    from two minutes to 15 days later. 10 of the 11 were built.
- **An owner's ruling, 17.** A real question only an owner could answer: a
  policy, whether a guard is wanted, a choice between two fixes. 5 rulings
  went against the ticket's ask.
- **The code, 2.** #3535 came from a stale checkout, and CI on main was
  green. On #4017 a code change landed after the park and made the report
  right.

## The facts that changed the end

A missing fact moved the end away from the ticket's own ask 11 times:

- **In the code, 6.** Each was a premise that did not hold on main: filed from
  a stale checkout (#3535) or a build branch (#6363, #6382), a count that was
  right for its file (#4610), an auto-close that had worked (#5806, from the
  API timeline), a verb that had shipped 32 minutes before filing (#4067). In
  5 of the 6, triage had read the code itself before it parked. The park only
  waited for leave to close.
- **With an owner, 5.** On #3795, #4174, #5269, #5473 and #9391 an owner
  ruled the ask moot or unwanted.
- **With the filer, 0.**

## Every question put to the filer

13 parks put their question to the filer. The filer answered none of them
with a fact:

- **Nobody answered, 1:** #1919, below.
- **An owner ruled or gave leave, 8:** #3795, #4579, #4610, #5056, #5059,
  #5098, #5472, #5473. On #5056 and #5059 a ruling withdrew the question. The
  founder ruled that a ticket under his own account is filed by an agent he
  drives, so triage may close it.
- **A code read answered it, 4:** #3535 (CI), #4065, #4067, #4068.

One caveat matters here. On phoenix a ticket with no footer is often filed
from the founder's own account by an agent he is driving. So "the filer" and
"an owner" can be the same person. Where that person answered, it was as an
owner, with a ruling or a leave to close. It was never a fact about the ticket
that only its writer knew.

One more case is worth showing. On #9451 the filer's own word did matter. The
filer had confirmed a fix worked. But that was on the board a week before
triage ran, so triage read it and did not need to ask.

## The filer-only case

There is one, and it is the same as in 133:

- **#1919.** The body was one external link, to a service that shows web
  requests, and an instruction to paste that link's content in as the body.
  Triage did not open the link. It said that pulling a link's content into
  the repo is an injection risk, and parked the ticket for the filer. The
  ticket closed a minute later with no answer.
- Asking the filer would have added nothing. Today's sort said `no` by
  `not_work` on both runs in 133.

## The blind re-read of 133's 15

The second reader agreed with 133 on all three fields, `end`, `who` and
`changed`, for 7 of 15 tickets. Field by field it agreed on `end` 12 times, on
`who` 10 times and on `changed` 14 times. I read the 8 disagreements again by
hand.

| Ticket | 133 | Blind | Kept | Why |
|---|---|---|---|---|
| #4065 | code | permission | blind | the duplicate was known from the first comment |
| #4610 | code | permission | blind | triage refuted the premise from the code itself |
| #5806 | code | permission | blind | triage refuted it from the API timeline itself |
| #6363 | code | permission | blind | triage found the premise false on main itself |
| #6382 | code | permission; ended built | blind on who, 133 on end | parked to fold into its parent; a sweep closed it when the parent landed |
| #1919 | ended no answer | ended no | 133 | closed a minute after the park, with no answer |
| #4017 | did not change the end | changed it | 133 | it ended in a campaign kill that had nothing to do with the fact |
| #6062 | ended no | duplicate | 133 | a standing ruling said no to every fix it asked for |

- **133 broke its own rule 5 times.** Its note defines permission as "triage
  already knew the answer". On those 5, triage knew. It knew from the board
  on #4065, and from its own read of the code or the API on the other 4. So
  133's "the code, 6" is really "the code, 1 (#4017), and 5 parks for
  permission".
- **This does not move the answer.** Under either reading the filer held no
  deciding fact on the 15. The 4 facts that changed the end still sat in the
  code. Only their row in the table moves.
- After this, the second reader matches the kept labels on all three fields
  for 11 of 15, and on `who` for 15 of 15.

## What today's sort said

108 sorts on the 54, two runs each, cost $3.06 and 1.45M billed tokens. A sort
took a median of 3.7 seconds. Every answer passed the Check on its first try.
49 of the 54 tickets got the same answer on both runs. For 133's 15, the
tables read 133's saved answers.

I read "the real end" as 133 read it. A ticket that was built wants `plan`. A
ticket that was ruled, or whose park waited on a ruling, may get `ruling`. A no
wants `no`. A duplicate wants a duplicate of the ticket the record names, or a
`no` by `carried`.

- **Over all 69, sort reached the real end on every run for 40 tickets**, and
  on 83 of 138 answers. On the 54 new ones: 32 tickets, 67 of 108 answers.
- **Not one miss needed the filer.** The 29 tickets it missed at least once:

| Why it missed | Tickets | Which |
|---|---|---|
| The fact was in the code | 7 | #3535, #4017, #4067, #4610, #5806, #6363, #6382 |
| The ticket it needed was not in the brief | 9 | #5292, #5858, #5872, #5910, #5945, #6062, #6395, #7852, #9451 |
| An owner later ruled against the ask | 5 | #3795, #4174, #5269, #5473, #9391 |
| It said plan on a duplicate whose ticket was in the brief | 3 | #4739, #5837 (one run), #5970 |
| It said research on a ticket that was built | 3 | #4797 (one run), #4927, #8666 |
| Something else | 2 | #7870, #8494 (one run) |

- **The code, 7.** Sort said plan on 6 and research on #5806. It has no
  tools, so it cannot see that a premise fails on main.
- **The brief, 9.** 7 needed an older ticket outside the 200-issue window.
  A real host lists every ticket, so this is the replay's limit. The other 2
  needed a ticket filed after them: #7852 was folded into #8018, filed later
  that day, and #9451's twin #9454 came later that day too. No brief could
  have shown those.
- **An owner's later no, 5.** Sort said plan. The no was not in the ticket's
  text; it came from the owner afterwards.
- **Duplicates it did not take, 3.** The ticket was in the brief and sort
  still said plan. That was #4739, #5970, which an epic covered, and one run
  of #5837.
- **Something else, 2.** #7870 ended no only because the whole product was
  removed later; sort said plan. One run on #8494 said `no` by `carried` on
  a ticket that was built.
- **Rulings.** Of the 17 parks that waited on an owner's ruling, sort asked
  for one on 3 (#4356, #4934, #7871). On 5 more it said plan, and the ticket
  was built after the ruling, which counts. In most of the rest, by my read,
  the question came from what triage found in the code or on the board, not
  from the ticket's text. A cited record that never existed is one example.
  Two records that disagreed is another.
- **Permission parks.** On 31 of the 49, sort reached triage's own answer on
  every run. That was a duplicate of the right ticket, or plan for a ticket
  waiting for a home.

## What this means

- **No seventh answer, 85% sure.** 133 had 75%. This read the whole closed
  set, not a sample, and a second reader agreed on the field that decides it.
  In none of the 15 did the filer hold the deciding fact. Across 69, the filer
  held it 0 times. What keeps it under 90:
  - phoenix's filers are agents, or the founder driving one. A repo where
    outside people file tickets could need the filer far more.
  - The 30 open tickets are not read. They may be the ones still waiting on
    a filer.
  - The 54 new labels had one reader.
- **The parks that waited on permission do not exist in today's design.**
  Today's sort closes a duplicate or a no itself (`writes.ts`), with no footer
  rule, and nothing in the pipeline reads a milestone
  ([a project is a parent plan](../docs/direction/a-project-is-a-parent-plan.md)).
  So these 49 parks would not happen. Sort reached triage's own answer on 31
  of them; the rest are the misses above. Whether sort should close a ticket
  a person filed is a separate question this does not answer.
- **The owner's rulings already have their answer.** 17 parks waited on an
  owner. That is `ask:owner:ruling`, which sort already has. The names picked
  on 2026-10-24 call it escalate. Sort used it on only 3 of the 17. Most
  of those questions seem to come from what triage read, not from the
  ticket's text, so a scout would help here too. That is a guess; this run
  did not test it.
- **The scout still earns a measure of its own.** 6 of the 11 deciding facts
  sat in the code, and sort missed all 7 tickets whose fact was there. Today
  the planner, which reads the code, would meet the fact one stage later. A
  scout that asks "does this hold on main?" before sort would meet it first.
  That is 133's lean, and it holds. The fix is a Gather before the Draft,
  not a new answer.

## What it cannot tell us

- **The 30 open tickets are out of scope.** This read only closed tickets. A
  ticket that still waits may be the kind that waits on a filer.
- **One repo, and its filers are agents.** On phoenix almost every ticket is
  written by an agent, often under the founder's account. The founder is then
  both filer and owner, and this reading counts his answers as an owner's.
- **One reader for the 54.** The blind re-read covers only 133's 15. There
  the two readers matched on all three fields 7 times in 15, before I read
  the disputes again.
- **`changed` is a judgment.** It asks whether the park's fact moved the end
  away from the ticket's ask. A later event with nothing to do with the park
  does not count, such as a product removed or a batch kill-sweep. Another
  reader could draw that line elsewhere on a few tickets, such as #4017.
- **The sort replay is not today's machine.** It sees the 200 issues filed
  just before the ticket, titles as they stand today, and no plans. A real host
  lists every ticket.
- **"The real end" is a strict bar.** A ticket closed for a later reason sort
  could not know counts as a miss, as on #7870, whose product was removed. So
  does `research` on a ticket that was built, though research leads to a plan.
  The 40 of 69 is a floor for "sort did the right thing", not a measure of it.
- **How 133 missed 18 tickets is not known.** The count here is from two
  label reads that agree. A third way of reading could still find more.
