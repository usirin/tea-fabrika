# 60. What happens to a follow-up filed for work a pull request left undone

Today's fabrika lets a builder land a pull request that leaves something
undone, if the builder says so under `## Deviations` and, when it chooses to,
files a follow-up issue. The ticket closes on merge. The design question is:
**should the finished part of a ticket be allowed to land while one criterion
is still open?** This experiment reads what the record says, over every merged
pull request of two public repos.

**Answer: the worry is real but small, and it is not where it first looked.
A closing pull request that files a follow-up for part of a criterion's own
words is rare: about 2 to 3 in 100. The follow-up does not wait in triage. It
is triaged in under an hour and then treated like any other small issue: a
third are built, four in ten are closed as not planned, and most of the rest
sit open for weeks. I am about 90% sure of the counts and about 75% sure of the
hand-sorted shares. The larger pile is one nobody files anything for: one
closing pull request in four says it did a criterion another way. Most of
those leave nothing undone. About one in seven does, and I am only about 65%
sure of that share, because it rests on 20 cases.**

```text
1,612 merged pull requests that closed their ticket     2026-07-26 to 2026-10-12, both repos
  971  no entry about a gap
  446  a gap entry, stated only                   <- nothing filed
   42  a gap entry that points at an older ticket
   10  a gap entry that says "filed", no issue found
  143  a gap entry with a new follow-up issue     <- "gap and file", 8.9%

289 follow-up issues (from any kind of entry)
  101  built: closed by a merged pull request     median 9.9 h after filing
   22  closed as done, with no pull request
  120  closed as not planned
   45  open and triaged                           median age 25 days
    1  open, still in the triage queue            the case that started this, one day old
```

- **Most filed follow-ups are not the ticket's own work.** Of 36 read by
  hand, 10 were part of a criterion's own words. 24 were a neighbouring
  problem, or a limit of the new work that no criterion names.
- **Of those 10, 4 did not close the ticket.** They used fabrika's own
  `Part of` link, which keeps the ticket open. 6 closed it.
- **The exact shape of the case that started this showed up once in 36.** A
  criterion's leftover, the ticket closed, the reviewer passed, nobody asked
  the owner. That one was built 1.4 hours later.
- **The reviewer never passed a leftover in silence, and never held one
  back.** 0 of 36 verdicts skipped it. 4 of 36 failed it first, then passed it
  with the leftover still there. The owner was asked before the merge in 1.
- **Triage is not the wait.** A follow-up leaves the triage queue after a
  median 49 minutes. The wait comes after triage.
- **More follow-ups are dropped than built.** 120 closed as not planned
  against 101 built. Four in ten of the ones closed with no pull request went
  in a bulk clean-up of the backlog.
- **A criterion's leftover gets no better treatment than a neighbour's
  bug.** Once it is a follow-up issue it is judged like any issue. Of the 10
  read by hand, 4 were built and 4 were dropped.
- **When the leftover was built, it was small.** A median 226 changed lines,
  in a pull request open for a median 34 minutes.
- **What holding the work back would have cost is not in the record.**
  Section 7 says what is, and what is not.

## Who did what

Everything counted is **today's fabrika** at work: pull requests, issues,
labels and review verdicts on the public repos
[kamp-us/phoenix](https://github.com/kamp-us/phoenix) and
[kamp-us/demlik](https://github.com/kamp-us/demlik), read through GitHub's
API as it stood at 2026-10-13 00:21 UTC. Nothing was written to either repo.

**This repo's** part is the script, the matching rules in it, and the hand
labels in `60-readings.json`. No agent ran. No model was called and no key was
used. The hand sort is one reader's own reading.

## How it was done

The script pages every pull request and every issue of both repos into a
local cache with `gh api graphql`, then counts from the cache. What it matches
on:

- **The section.** Any heading that starts with "Deviations", at any level,
  outside a code fence. It ends at the next heading, at a link line such as
  `Fixes #N`, or at the Claude Code footer. A section that says `None.` counts
  as none.
- **An entry.** One top-level list item of the section, or one paragraph that
  opens in bold.
- **The label.** fabrika's command line knows seven kinds of entry: Scope
  narrowing, Governing-ADR departure, Known defect left unfixed, Declined
  guidance, Guard or gate bypassed, Pre-existing test or fixture changed, and
  Out-of-scope change. An entry gets a label when its opening words carry one
  of the seven names. Otherwise it is "no label of the seven", which is mostly
  the free-form entries of July and early August.
- **The four fields.** The later form of an entry has `Said`, `Did`, `Why`
  and `Disposition` (what will become of it). 74.5% of phoenix's entries and
  all of demlik's have it.
- **A gap label.** "Known defect left unfixed" and "Scope narrowing". These
  are the two kinds that say something was left.
- **What the builder said would become of it.** Read from the `Disposition`
  field, one sentence at a time. *Filed* means a sentence says an issue was
  filed and names an issue that is new: made between 6 hours before the pull
  request opened and 10 minutes after it merged, or carrying this lane's
  footer. *Older ticket* means it names an issue that already existed. *Says
  filed, none found* means it says filed and no such issue turns up. Anything
  else is *stated only*.
- **An issue's life.** It enters the triage queue at its first
  `status:needs-triage` label and leaves at the first removal of that label,
  or when it is closed with the label still on. "Built" means GitHub records a
  merged pull request as what closed it.

Three piles were read by hand, one reader, one pass. Each case was read with
the whole entry, the ticket's criteria, the follow-up and its last comments,
and the review verdicts on the pull request.

- **Filed, 36 cases.** Of the 274 entries that filed a new issue, in merge
  order, 36 at even steps (about every 8th), starting half a step in.
- **Known defects that filed nothing, 20 cases.** The same rule over the 263
  such entries on pull requests that closed their ticket.
- **Scope narrowings that filed nothing, 20 cases.** The same rule over 463
  such entries. This pile was added late, after the tables showed how large it
  is. See "Guesses that were wrong".

The case that started the question was read the same way and is counted in
neither sample.

## 1. How often a pull request has a Deviations section

**Sure: about 95%. These are counts.**

| Repo | Merged, first to last | With a section | It says None | With entries | Entries |
|---|---|---|---|---|---|
| kamp-us/phoenix | 3,322, 2026-05-10 to 10-10 | 1,520 (45.8%) | 226 | 1,294 | 4,955 |
| kamp-us/demlik | 267, 2026-08-16 to 10-12 | 206 (77.2%) | 18 | 188 | 503 |

- **The section starts on 2026-07-26.** No pull request before that has one.
  From August on nearly every one does: 595 of 679 merged in August, 910 of
  971 in September.
- **1,482 of the 1,726 pull requests with a section list at least one entry,
  3.7 entries each on average.** Listing a deviation is the normal case, not
  the odd one.
- **What the entries are, both repos, 5,458 in all:** out-of-scope change
  1,253, scope narrowing 605, known defect left unfixed 488, pre-existing test
  changed 393, declined guidance 318, guard or gate bypassed 214, governing
  decision departed from 93, and 2,094 with no label of the seven.
- **Most entries are extra work, not missing work.** The two gap labels hold
  1,093 entries, 20% of all.
- **Nine in ten entries file nothing.** 5,018 are stated only, 274 filed a
  new issue, 125 name an older ticket, 41 say filed with none found.

## 2. Gap and file: how many

**Sure: about 90% on the counts. The matcher has known slips, listed at the
end.**

| The entry's label | Entries | Filed a new issue | Names an older ticket | Stated only |
|---|---|---|---|---|
| Known defect left unfixed | 488 | 139 (28.5%) | 41 (8.4%) | 299 (61.3%) |
| Scope narrowing | 605 | 38 (6.3%) | 15 (2.5%) | 549 (90.7%) |
| the other five labels | 2,271 | 36 (1.6%) | 24 (1.1%) | 2,199 (96.8%) |
| no label of the seven | 2,094 | 61 (2.9%) | 45 (2.1%) | 1,971 (94.1%) |

- **Per pull request.** 1,612 merged pull requests closed their ticket and
  carry a section. 143 of them (8.9%) hold a gap entry that filed a new issue:
  136 on phoenix (9.7%) and 7 on demlik (3.4%). Counting any label and any
  link, 241 pull requests filed a follow-up from an entry.
- **Per issue.** 289 distinct follow-up issues, filed between 2026-07-26 and
  2026-10-12. That is 11 weeks and about 26 a week. 187 came from an entry
  under a gap label. 238 carry the footer of an agent-filed issue.
- **A "known defect" is filed far more often than a "scope narrowing".**
  28.5% against 6.3%. Section 5 shows why that matters: the two labels mean
  different things.

## 3. What became of the follow-ups

**Sure: about 90%. These are counts from GitHub's own events.**

| State at the time of reading | All 289 | Under a gap label, 187 | demlik, 7 |
|---|---|---|---|
| closed by a merged pull request | 101 (34.9%) | 71 (38.0%) | 3 |
| closed as done, no pull request | 22 (7.6%) | 14 (7.5%) | 1 |
| closed as not planned | 120 (41.5%) | 67 (35.8%) | 2 |
| open, triaged | 45 (15.6%) | 34 (18.2%) | 0 |
| open, in the triage queue | 1 (0.3%) | 1 (0.5%) | 1 |

How long, all 289:

- **Filed to out of the triage queue (280 issues):** a quarter in 15
  minutes, median 49 minutes, three quarters in 4.3 hours, nine in ten in 20.7
  hours, longest 17.9 days.
- **Filed to built (101):** a quarter in 2.5 hours, median 9.9 hours, three
  quarters in 38.9 hours, nine in ten in 4.9 days, longest 52.8 days.
- **Filed to closed with no pull request (142):** median 15.8 hours, three
  quarters in 5.9 days, nine in ten in 15.2 days.
- **Still open (46):** a quarter are older than 33 days. Median 25.2 days,
  oldest 55.9 days. 43 are triaged, 38 are marked ready for an agent, 38 are
  `p2`, 5 are `p1`, and 5 wait on a person.
- **The long tail is the open ones.** A follow-up that gets built is built
  fast. One that is not built within about five days is mostly either closed
  unbuilt or left open.

Why the 142 were closed with no pull request, from each one's last comment.
The bins are rough: a pattern match on the comment, not a reading.

- **A bulk clean-up of the backlog, approved by the owner: 57 (40.1%).** 46
  closed as not planned, 11 as done. Median 2.7 days after filing.
- **Folded into another ticket, or a duplicate: 31 (21.8%).** Median 34
  minutes.
- **Closed by triage as a hardening idea with no incident behind it: 15
  (10.6%).** Median 1.9 hours.
- **Closed on a person's ruling: 16 (11.3%).** 10 of them are one ruling of
  2026-08-14 that ended whole lines of work.
- **The problem was already gone, or a later decision removed it: 9.** Done
  inside another pull request: 5. Something else: 9.

## 4. The wait in triage, beside other issues

**Sure: about 90%.**

Every issue filed since the first follow-up, by who filed it:

| Issues | Count | Median in the queue | Nine in ten out within | Out within a day | Built | Not planned |
|---|---|---|---|---|---|---|
| follow-ups from a Deviations entry | 289 | 49 min | 20.7 h | 91.1% | 34.9% | 41.5% |
| other issues a build lane filed | 346 | 1.9 h | 36.7 h | 85.5% | 35.0% | 33.5% |
| other issues an agent filed | 2,870 | 31 min | 20.0 h | 92.0% | 34.5% | 39.6% |
| every other issue | 1,641 | 11 min | 17.6 h | 92.7% | 42.8% | 18.3% |

- **A follow-up is triaged about as fast as any agent-filed issue,** and it
  ends the same way: a third built, about four in ten not planned.
- **The issue that started this is the only follow-up in the queue.** It was
  one day old when the data was read. Being in the queue for a day puts it in
  the slowest tenth, not outside what the record shows.
- **So "it waits in `status:needs-triage`" is not the risk.** The risk is
  what happens after: it becomes one more small issue among thousands.

## 5. Was it part of the ticket, or next to it?

**Sure: about 75% for each label, one reader. With 36 cases, any share here
can be off by about 15 points either way.**

The 36 filed cases:

| Reading | Cases | What it means |
|---|---|---|
| next to the ticket, a neighbour | 19 (52.8%) | an older or neighbouring problem the builder noticed on the way |
| a criterion's own words | 10 (27.8%) | part of a criterion was left undone, or done another way |
| next to the ticket, its own limit | 5 (13.9%) | a limit of the work this pull request added, that no criterion names |
| the ticket said to leave it | 1 | the last criterion said: do not do this here, file it |
| asked in the ticket, in no criterion | 1 | a ruling on the ticket read wider than the criteria |

None of the 36 was left as "cannot tell". Two were close calls between the
first two rows
([one](https://github.com/kamp-us/phoenix/pull/8474),
[two](https://github.com/kamp-us/phoenix/pull/10464)), and both went to
"neighbour" because the reviewer read the criterion as met.

**The builder's reason,** in its own words, sorted: outside this ticket 18
(50%), needs a person's decision 7, blocked by something else 6, bigger than
the ticket 3, something else 1, none given 1.

**The label does not say which kind it is.** "Known defect left unfixed" was a
neighbour or an own limit in 16 of 20 cases and a criterion's own words in 4.
"Scope narrowing" was a criterion's own words in 5 of 9.

**The 10 that were a criterion's own words:**

- **4 kept the ticket open with `Part of`**
  ([5306](https://github.com/kamp-us/phoenix/pull/5306),
  [5486](https://github.com/kamp-us/phoenix/pull/5486),
  [8080](https://github.com/kamp-us/phoenix/pull/8080),
  [10326](https://github.com/kamp-us/phoenix/pull/10326)).
- **2 closed a decision ticket, with the owner's approval on the merge**
  ([4327](https://github.com/kamp-us/phoenix/pull/4327),
  [5238](https://github.com/kamp-us/phoenix/pull/5238)).
- **1 proved a criterion another way,** because the command the criterion
  named was broken by another defect
  ([5819](https://github.com/kamp-us/phoenix/pull/5819)).
- **2 were failed by the reviewer first** and passed in a later round once
  the leftover was disclosed and filed
  ([6326](https://github.com/kamp-us/phoenix/pull/6326),
  [6552](https://github.com/kamp-us/phoenix/pull/6552)).
- **1 is the twin of the case that started this**
  ([9824](https://github.com/kamp-us/phoenix/pull/9824)): a criterion's
  leftover, the ticket closed, a pass, nobody asked. Its follow-up was built
  1.4 hours later.

**What became of their follow-ups:** 4 built (median 4.5 hours), 1 closed as
done with no pull request, 4 closed as not planned, 1 open. The four dropped
ones were not forgotten. Two were closed on the owner's ruling, one because
the tooling it was about was removed, and one in a bulk clean-up 12.7 hours
after it was filed. **This is the finding to keep: the moment a criterion's
leftover becomes a follow-up issue, it loses its standing as "promised by an
accepted ticket". It is priced again from zero, as a `p2` among thousands.**

A rough count over all follow-ups agrees. The script marks an entry whose
`Said` field names a criterion ("criterion 3", "AC 1"). 50 follow-ups come
from such an entry, 40 of them on a pull request that closed its ticket. Of
those 40: 13 built, 5 done with no pull request, 16 not planned, 6 open. That
is the same split as every other follow-up. The mark is a stand-in, not a
reading: it found 8 of the 10 hand-read cases, and it misses the case that
started this, whose entry quotes the criterion without calling it one.

**One warning about the sample.** 20 of its 36 follow-ups were built (56%),
against 35% of all 289. The same rule from seven other starting points gives
between 8 and 19 built. This draw is the luckiest of them.
Use section 3 for what becomes of follow-ups, and this section only for what
kind of thing they are.

### The gaps that filed nothing

**Sure: about 65%. Two samples of 20, one reader, and the second was read
knowing what the first had shown.**

| Reading | Known defects, stated only (20 of 263) | Scope narrowings, stated only (20 of 463) |
|---|---|---|
| a criterion's own words, work left over | 0 | 3 |
| a criterion's own words, proof done a weaker way | 0 | 3 |
| a criterion's own words, done another way, nothing left | 0 | 11 |
| next to the ticket | 11 | 0 |
| a check that was red or could not run | 6 | 0 |
| the ticket said to leave it | 0 | 1 |
| not a gap at all | 3 | 2 |

- **"Known defect, stated only" is not about the ticket's criteria.** 0 of
  20. About 8 of 20 are real loose ends in the product with no ticket behind
  them, all neighbours or own limits. 5 name a ticket that already covers
  them, in words the matcher did not catch.
- **"Scope narrowing, stated only" is nearly always about a criterion's own
  words.** 17 of 20. It sits on 393 closing pull requests, which is one in
  four.
- **But 11 of those 20 leave nothing undone.** The builder did what the
  criterion was for, another way, and the reviewer agreed. Examples: a
  criterion asked two commands to refuse a flag that one of them does not
  have ([6319](https://github.com/kamp-us/phoenix/pull/6319)); a criterion's
  own test fixture contradicted itself
  ([571](https://github.com/kamp-us/demlik/pull/571)).
- **In 7 of 20 the criterion could not be met as written.** It was out of
  date, it contradicted itself, or it named a thing that does not exist. In 10
  more, something outside the change stood in the way.
- **3 of 20 leave real work over, with the ticket closed and nothing filed**
  ([4491](https://github.com/kamp-us/phoenix/pull/4491),
  [8376](https://github.com/kamp-us/phoenix/pull/8376),
  [10178](https://github.com/kamp-us/phoenix/pull/10178)). Two name an older
  ticket as the owner of the rest. One wrote the leftover into a decision
  record. None was left with no trace.
- **A guess from that:** 3 in 20 of 463 is about 70 entries in 11 weeks. With
  20 cases the true number could be anywhere from about 15 to about 175. That
  is still more than the 30 to 50 criterion leftovers that were filed with
  the ticket closed. **So if
  the worry is "a ticket closed with part of a criterion undone", most of
  those cases file nothing at all.**

## 6. What the reviewer did, and whether the owner was asked

**Sure: about 80%. The verdicts are public comments and were read whole.**

In the 36 filed cases:

| What the reviewer did | Cases |
|---|---|
| passed, and the verdict names the leftover and accepts it | 26 (72.2%) |
| passed, with the criterion itself marked partly met | 5 (13.9%) |
| gave advice only: the pull request touched the pipeline's own rules, so a person approved the merge | 5 (13.9%) |
| passed without a word about the leftover | 0 |

- **The reviewer always saw it.** That part of the Deviations rule works.
- **The reviewer almost never held it back.** In 4 of 36 a verdict first
  failed the pull request over the leftover. All 4 passed in a later round
  with the leftover still there. In two of them the reviewer itself named the
  repair: disclose it and file it
  ([4689](https://github.com/kamp-us/phoenix/pull/4689),
  [6552](https://github.com/kamp-us/phoenix/pull/6552)).
- **"Partly met" has no fixed word.** Across the five verdicts the words are
  PARTIAL, DEFERRED, "OPEN for 4" and "substance met". The verdict on the case
  that started this says "PASS, with a named limit". These are the reviewer
  inventing a third answer where the form has two.
- **Was the owner asked?** Nobody was asked in 24 (66.7%). In 6 the owner
  approved the merge for another reason, and nothing shows the leftover was
  the question. In 5 the follow-up itself became a question to the owner,
  after the merge. In 1 the owner was asked about the leftover before the
  merge ([6552](https://github.com/kamp-us/phoenix/pull/6552)).
- **So the choice to land with a leftover is made by the builder and accepted
  by the reviewer.** In the case that started this, the follow-up was filed
  half a minute before the pull request was opened. The choice was made
  before any reviewer had seen the work.

## 7. The other side: what holding the work back costs

**Sure: about 85% on what is counted. What is not in the record is said
plainly below.**

A merged pull request's own life, by what its section holds:

| Merged pull requests | Count | Open, median | Open, nine in ten under | Changed lines, median | Force-pushed |
|---|---|---|---|---|---|
| every one with a section | 1,726 | 35 min | 5.2 h | 279 | 8.3% |
| a new issue filed from an entry | 241 | 42 min | 5.0 h | 353 | 9.5% |
| a gap entry, nothing filed | 537 | 39 min | 4.0 h | 444 | 5.8% |
| no gap entry | 948 | 32 min | 5.9 h | 203 | 9.5% |
| one part of its ticket (`Part of`) | 96 | 46 min | 2.8 h | 283 | 15.6% |

- **Pull requests that leave a gap are bigger, and open about as long.**
  Nothing here shows they were cut short to merge sooner.
- **Closed without merging is rare.** 111 of 3,723 pull requests. 16 of
  1,342 from a build lane, open for a median 1.6 hours before they were
  closed. So a pull request going stale and dying is not common under today's
  rule. That says nothing about a stricter rule.
- **The leftover, when it was built, was small.** 101 follow-ups were closed
  by a merged pull request. That pull request changed a median 226 lines
  (nine in ten under 847) and was open a median 34 minutes. The pull request
  that left the gap changed a median 416 lines. The fix was the smaller of the
  two in 65 cases (64.4%).
- **A guess from that:** for the third of leftovers that got built, holding
  the first pull request until the leftover was done would have added about
  half as much work again, and hours, not days. For the four in ten that were
  dropped, holding would have forced either work that nobody wanted in the
  end, or the decision to drop it, made earlier and by a person.
- **Where the builder said "blocked"** (6 of the 36 filed cases, 10 of the 20
  narrowings), holding means the finished part waits on something outside the
  ticket. The record cannot price that wait.

### fabrika already has a third way

The build skill says: write `Fixes #N` only when every criterion is met.
Otherwise write `Part of #N`, and the ticket stays open. So "land the finished
part, keep the ticket open" exists today.

- **It is used little.** 96 merged pull requests, for 87 tickets, against 393
  closing pull requests that narrowed a criterion and 143 that filed a gap.
  14 of the 96 merged into an epic's branch, where `Part of` is the normal
  link and not a split ticket.
- **What became of the 87 tickets:** 21 were closed by hand within the hour.
  22 were closed by a later merged pull request (median 8.5 hours, nine in
  ten within 7.6 days, longest 29.3 days). 25 were closed by hand later
  (median 6.4 hours). 8 were closed as not planned. 11 are still open, a
  median 12.2 days after the part merged, the oldest 37.8 days.
- **So keeping the ticket open does not make the rest get built either.**
  Only a quarter were finished by a later pull request. More than half were
  closed by hand. I did not read why.

### What the record cannot show here

- **What would have happened if a pull request had been held.** No pull
  request was held for this reason, so there is nothing to compare. This is
  the main limit of the whole experiment.
- **Conflicts.** GitHub keeps no history of "this pull request conflicted
  with main at this time". Force-pushes and second trips through the merge
  queue are the nearest marks, and they are weak ones.
- **The cost of one more repair round, in tokens or dollars.** Experiments
  [53](./53-lane-logs.md) and [58](./58-shrinking-list-replay.md) hold what is
  known: the first review passes 57% of the time, and of 682 steps taken from
  a failed round, 488 pass.
- **Whether dropping a follow-up was the right call.** The record shows it
  was closed, and roughly why. It does not show what the missing piece cost
  later.

## 8. The case that started this, placed in the numbers

[The ticket](https://github.com/kamp-us/demlik/issues/622) has 11 criteria.
The seventh says the output names every removed subpath.
[The pull request](https://github.com/kamp-us/demlik/pull/634) does that for
every subpath that published at least one name, says so in a "Known defect
left unfixed" entry, and filed
[a follow-up](https://github.com/kamp-us/demlik/issues/633) for the rest. The
reviewer wrote "PASS, with a named limit". The ticket closed 18 minutes after
the pull request opened.

- **By hand reading it is a criterion's own words, with the ticket closed, a
  pass, and nobody asked.** That is the rarest shape in the filed sample: 1
  of 36.
- **Its label hides it.** Under "Known defect left unfixed", 16 of 20 filed
  cases are next to the ticket. A reader of the label would expect that here
  too.
- **Its follow-up is the only one of 289 still in the triage queue,** and it
  was a day old. demlik's other six follow-ups: 3 built within 4 hours, 1
  closed as done, 2 closed as not planned.
- **On the numbers its follow-up has about a 1 in 3 chance of being built,**
  about 4 in 10 of being closed unbuilt, and the rest of sitting open. That is
  the base rate. The follow-up's own text says the gap is small and rare,
  which is the kind that triage tends to close.

## What the record says about the question

This is a reading of the numbers, not a decision. **Sure: about 70%.**

- **Landing with a criterion's leftover does not lose track of it.** Every
  filed case was seen by the reviewer. The three unfiled ones read each name a
  ticket or a decision record. The worry "nobody will know" is not founded for
  the ticket's own work. It is better founded for neighbours: 6 of 20 unfiled
  known defects have only the entry in a merged pull request as their record.
- **Landing with a leftover does change who decides.** While the criterion is
  open on the ticket, it is a promise the owner accepted. As a follow-up it is
  a new `p2`, and a third of those get built. Nobody was asked in two cases of
  three. If the worry is "the owner's ask was quietly downgraded", the record
  supports it, in a small number of cases: about 2 to 3 closing pull requests
  in 100, plus an unfiled group that is probably larger.
- **"Is this criterion still open?" is often a judgment, not a fact.** In 11
  of 20 narrowings the builder met the point of a criterion and not its
  words, and in 7 of 20 the words could not be met at all. A rule that says
  "hold until every criterion is met" needs someone to say what "met" means
  in those cases. Today the reviewer says it, with invented words like "with
  a named limit".
- **Holding looks cheap where the leftover is small and in reach, and
  unpriced where it is blocked.** Both kinds are in the record. About half of
  the builder's reasons are "outside this ticket", a sixth "blocked", a fifth
  "needs a person".

## Guesses that were wrong

- **"The follow-up waits in the triage queue."** Wrong. Median 49 minutes.
  The case that started this is the only one there.
- **"A 'Known defect left unfixed' entry means a criterion was left open."**
  Mostly wrong. 16 of 20 filed ones and 20 of 20 unfiled ones are next to the
  ticket. "Scope narrowing" is the label that speaks of a criterion.
- **"The stated-only pile is small enough to skip."** Wrong. The first plan
  read only the filed cases and the unfiled known defects. A rough count then
  showed 223 unfiled gap entries on closing pull requests whose `Said` field
  names a criterion, against 30 filed ones. So a third sample was drawn and
  read. It is where the "one in four" and the "about one in seven" come from.
- **"A leftover of the ticket's own criterion will be built sooner than a
  neighbour's bug."** Not shown. Both the hand sample and the rough count give
  the same split as any follow-up.

## What this cannot tell us

- **The cost of holding.** See section 7. No pull request was held, so every
  statement about holding is a guess from the size of the fix.
- **The hand shares, to better than about 15 points.** One reader, one pass,
  36 and 20 and 20 cases. A case with two readings got one.
- **The fates in the filed sample.** The draw was lucky: 56% built against
  35% overall. Section 3 is the number to use.
- **The unfiled leftovers, to better than a wide range.** 3 of 20. The third
  sample was also read last, by a reader who already knew the first two.
- **The labels before mid August.** 2,094 entries carry none of the seven
  names, and most are from the first weeks. Their gaps are counted only when
  they filed something.
- **Every follow-up.** 41 entries say an issue was filed and none was found.
  An entry that names three follow-ups is read once in the sample. One
  follow-up was matched to the wrong entry because a closing line ran into the
  last list item ([9420](https://github.com/kamp-us/phoenix/pull/9420)).
- **"Stated only" as "nothing tracks it".** 5 of 20 known defects and 2 of 20
  narrowings name a covering ticket in words the matcher missed. The true
  "older ticket" count is higher than 125.
- **The final fate of the 46 open follow-ups.** They may still be built.
- **"Not planned" as a judgment on each issue.** 57 of 142 went in bulk
  clean-ups, which close by age and priority, not by reading each one.
- **demlik on its own.** 7 follow-ups. Nearly everything here is phoenix, a
  repo where the pipeline is the product and most follow-ups are about the
  pipeline itself.
- **Why `Part of` tickets were closed by hand.** Not read.
- **Whether any dropped leftover later caused a bug.** Not looked for.

## Run it

```
node experiments/60-filed-follow-ups.ts
```

With no cache it prints every table from `results/filed-follow-ups.json`: no
network and no key. To count again from GitHub:

```
CACHE=<a folder> STEP=fetch node experiments/60-filed-follow-ups.ts   # gh, read-only; a stopped run picks up where it was
CACHE=<a folder> STEP=sample node experiments/60-filed-follow-ups.ts  # writes the hand sample's texts into the cache
CACHE=<a folder> node experiments/60-filed-follow-ups.ts              # counts, saves, prints
```

A fresh fetch reads GitHub as it stands that day, so the numbers move and the
samples may draw other cases.

- `60-readings.json`: the hand labels for the three samples and the one
  known case, with what each label means and a one-line note per case.
- `results/filed-follow-ups.json`: every number above, and one row for each
  follow-up: the pull request, the entry, the issue, dates, labels and the one
  sentence of the entry that matched.

Neither holds an account name, a branch name or a whole body.
