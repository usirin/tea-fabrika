# 138. The tracker's details, read off demlik's real history

The owner decided that tickets start in our own tracker
([the note](../docs/direction/tickets-start-in-our-tracker.md)). A ticket is
facts on the ledger: `filed`, `edited`, and `approved` with a hash of the text
the yes saw. Only members write. This experiment reads every kamp-us/demlik
issue and pull request to fill in the details.

```ts
// The three facts, as this experiment's script defines them (a sketch, not in packages/).
{fact: "filed",    ticket: "demlik-1", by: "owner", title: "…", body: "…"}
{fact: "edited",   ticket: "demlik-1", by: "owner", body: "…"}          // title, body or both
{fact: "approved", ticket: "demlik-1", by: "owner", plan: "p-1", text: "sha256:…"}

const covers = (yes: Approved, now: Ticket) =>
	yes.ticket === now.id && yes.text === textOf(now);  // textOf hashes [title, body] as JSON
```

**The answers, short:**

1. **What a ticket uses.** All 447 issues and all 1,463 comments were written
   by 2 member accounts. No outsider ever wrote one. A built ticket leans on
   its title, its body (98% carry an acceptance-criteria task list), links to
   other tickets (90%), labels (100%) and a milestone (98%). It almost never
   uses assignees (1%), images (0) or reactions (0). Labels and milestones
   are today's fabrika's own state. The tracker can leave all of those out.
2. **Would "a yes covers the text it saw" have fired?** Yes, on 8% of
   tickets, if the hash covers the title and the ticket's prose (criteria,
   plans and rulings kept as their own facts). On 32% if it covers the whole
   GitHub body, because review adds criteria to the body after the pull
   request opens. Only 1% had a meaningful edit more than an hour after the
   yes. Renames happen (3 of 291) and 2 of 3 changed the ask, so the title
   belongs in the hash.
3. **What `Closes #N` does.** 76% of merged pull requests close one issue
   this way. Five kinds of reader use the link: GitHub's auto-close (261 of
   351 tickets closed as done were closed by it), today's fabrika's review,
   ship, build and heal-ci, this repo's own review and ship, and people.
   demlik's CI reads none of it. With our tracker there is no GitHub issue to
   close, and this repo's own reader cannot parse an id like `demlik-1`.
4. **Does triage need the comments?** Rarely. 20 of 345 triaged tickets had a
   comment before triage. On 3 of those 20, triage answered differently
   with the comments, in two runs out of two, and the comments' answer
   matched what really happened each time. That is about 1% of all triaged
   tickets.
5. **The prototype.** The three facts are Effect Schemas and `covers` is a
   pure function in the script. A fast-check property test passes 2,000 runs:
   an edit after the yes is never covered, an untouched ticket always is.

Cost: $5.57 for 56 triage calls on opus. Everything else read GitHub through
`gh`, read-only, for $0.

## Who did what

- **The tickets, comments, labels, edits and pull requests:** today's
  fabrika on kamp-us/demlik, before this run. Every `ready-for:agent` label,
  every `pitch-approved` and `plan-approved` comment and every closing
  keyword was written by today's fabrika's agents or by the owners.
- **Parts 1 to 3:** this run, by counting. `STEP=fetch` read every issue and
  pull request through `gh api graphql`, read-only. `STEP=count` counted.
  30 edits the first reading could not place were read by hand
  (`138-truth.json`).
- **Part 4:** this repo's sort stage, run outside its machine, as in
  experiments 133 and 135: `promptFor` and `sortProblems` from
  `packages/pipeline/src/stages/sort/`, `SortReply`, `sorterOptions`, and a
  second try through `nextTry` (no second try was ever needed). Claude opus
  at effort medium, no tools.
- **Part 5:** a sketch in the script, not in `packages/`.
- **Nothing was written to GitHub.** No issue, comment, label or pull request
  on demlik.

## How it was done

- **The data.** Every demlik issue (447, 55 open) with its labels, milestone,
  assignees, parent, children, reactions, up to 100 comments, up to 100
  content edits and up to 250 timeline events. Every pull request (305, 292
  merged) with its body and GitHub's closing list. Nothing was cut off: no
  issue hit a limit.
- **Built** means a merged pull request closed the ticket or said `Part of`
  it: 261 tickets.
- **The yes.** demlik has no tracker approval yet, so part 2 uses two stand-ins:
  - the first `ready-for:agent` label (291 tickets). Today's fabrika adds it
    when the ticket may be built. Triage, an agent, adds it, not the owner;
  - the first `pitch-approved` comment (23 tickets), the owner's yes on a
    pitch.
- **Each edit after the yes** was diffed line by line against the revision
  before it, then given a first reading by rule:
  - `criteria`: only task-list lines changed;
  - `plan`: a plan ledger was spliced in;
  - `ruling`: an owner's ruling was written in;
  - `other`: the rest, 30 edits, each read by hand for whether it changed
    what is asked (`138-truth.json`).
- **Part 4.** Each of the 20 triaged tickets with a comment before triage,
  twice: once as the tracker would show it (title and body as they stood at
  triage) and once as the GitHub page did (the same, plus each comment before
  triage, headed "Comment by a member" and its date). "Earlier tickets" and
  "open plans" are as in experiment 133: every issue filed before, and every
  open one as a plan summed up by its first revision. 3 cases first, then the
  rest, then a second run of the 4 that differed and 4 that did not, to tell
  a real difference from noise.

```ts
// Part 4, one ticket, two forms. The only difference is the comments.
const tracker = briefOf(issues, ticket, "tracker");  // body as at triage
const github  = briefOf(issues, ticket, "github");   // body + "## Comments" before triage
const a = await sortOnce(tracker, cwd);              // promptFor, sortProblems, nextTry
const b = await sortOnce(github, cwd);
said(a) === said(b);                                  // "plan", "fold #215", "ruling", ...
```

## Part 1: what a demlik ticket uses

- **Who writes.** 2 accounts filed every issue and wrote every comment. All
  are members. 0 outside authors, 0 contributors.
- **Comments.** 1,463 in all, median 3 a ticket, 90th percentile 6, most 43.
  - Half are machine markers (732): claims, lane state, JSON blobs.
  - 311 are closing notes, 86 lane notes.
  - 267 are findings (a review or prototype result) and 67 are rulings.
- **What a builder needed from a comment.** On built tickets, before the first
  pull request: rulings on 25 tickets (10%), findings on 34 (13%). Of those 71
  comments, 31 were later copied into the body by an edit. 40 lived only in
  the comment.

| used | all 447 tickets | 261 built |
|---|---|---|
| a label | 422 (94%) | 260 (100%) |
| a comment | 413 (92%) | 255 (98%) |
| a ruling comment | 40 (9%) | 26 (10%) |
| a finding comment | 147 (33%) | 84 (32%) |
| body edited | 270 (60%) | 216 (83%) |
| renamed | 6 (1%) | 5 (2%) |
| body names another ticket | 381 (85%) | 234 (90%) |
| named by another ticket or PR | 388 (87%) | 233 (89%) |
| task list (acceptance criteria) | 297 (66%) | 257 (98%) |
| image | 0 | 0 |
| milestone | 326 (73%) | 256 (98%) |
| assignee | 11 (2%) | 2 (1%) |
| a parent | 69 (15%) | 44 (17%) |
| children | 10 (2%) | 4 (2%) |
| reactions | 0 | 0 |

- **Labels are today's fabrika's state, not the ticket's.** `status:` 364,
  `type:` 329, `ready-for:` 326, priorities 326, `class:` 100. Each is a
  stage's answer: triage's kind and priority, the build gate, review's class.
  In the tracker those are stage facts already.
- **Milestones are campaigns** ("Kernel hardening" holds 159 tickets). They
  group work for the roadmap. No stage of this repo reads one.

## Part 2: edits after the yes

- **138 edits after `ready-for:agent`**, on 291 tickets: 135 body edits and
  3 renames.
- **First reading:** criteria 85, plan 4, ruling 19, other 30.
  - Criteria edits come late: 71 of 85 after the pull request opened. Today's
    review adds or ticks criteria in the body.
  - The 30 "other", by hand: scope 8, criteria inside a larger edit 6, another
    ticket's work bundled in 5, ruling 2, format 3, wording 2, a revert within
    a minute 2, a field such as appetite 2. 21 of 30 changed the ask.
- **Edits come fast.** Median 0.6 hours after the yes, 36 within 10 minutes.
  Of the prose edits, 24 came within the hour.

| the hash covers | tickets that would need a new yes (of 291) |
|---|---|
| the whole GitHub body | 92 (32%) |
| the title and the whole body | 93 (32%) |
| the title and the prose (no criteria, plan or ruling lines) | 23 (8%) |
| the prose only, no title | 22 (8%) |
| the title and the prose, meaningful edits only | 18 (6%) |
| the same, more than an hour after the yes | 3 (1%) |
| tickets whose every prose edit was cosmetic | 5 (2%) |

- **The owner's own yes went stale too.** 23 tickets had a `pitch-approved`
  comment. 11 edits came after it, on 9 tickets. 1 of those 9 changed the
  prose. The rest were criteria, plan or ruling lines.
- **Renames.** 3 after the yes. 2 changed the ask (#20 widened to name folded-in
  work, #670 narrowed to one of three problems). 1 caught the title up with the
  body (#510).
- **A revert.** #430 added two criteria and took them back 35 seconds later.
  A hash of the text sees the revert as covered again. A counter of edits
  would not.
- **Prior art in today's fabrika.** Its `plan-approved: #N @ <digest>` marker
  binds the plan's structure (stories, tasks, child labels, the number of
  criteria), not the prose. 8 epics carry one; #604 carries two, a second yes
  2 minutes after the first because the plan changed.

What this means for the hash:

- Hash the title and the body together. A title-only edit changes the ask as
  often as a body edit does.
- Keep criteria, plans and rulings out of the body. They are their own facts,
  with their own writers. Hashing them into the ticket would ask a new yes on
  a third of tickets, mostly for review's own lines after the pull request is
  open.
- A plan that changes is a new plan id, so `approved.plan` binds it.

## Part 3: what `Closes #N` does for demlik

| a merged PR's body | merged PRs (292) |
|---|---|
| closes one issue | 222 (76%) |
| closes several | 7 (2%) |
| only `Refs` or `Part of` | 21 (7%) |
| names no issue | 42 (14%) |

- **GitHub agrees with the body** on 288 of 292. No `Closes #N` ever named a
  pull request. 32 pull requests named more than one ticket.
- **The ones with no issue** are mostly releases, changesets, roadmap and
  bootstrap chores, plus a few early or one-off features.
- **How 351 tickets got closed as done:** by a merged pull request's closing
  word 261, by hand after a merged pull request named them with `Refs` or
  `Part of` 25, by hand with no pull request 65, by a commit 0.

Every reader of the link:

- **GitHub's auto-close.** Closes the issue on merge. With the tracker there
  is no GitHub issue, so nothing is closed. The tracker's done comes from the
  ship stage's own fact.
- **Today's fabrika.** Review reads the first closing keyword to find the
  criteria it grades. Ship refuses a code or skill pull request with no
  `Fixes #N` or `Part of #N`. Build finds the ticket it serves from the body.
  heal-ci reads the linked issue's labels and body. The lane reconciler reads
  `Part of #N` on merged pull requests.
- **This repo's machine.** `ticketIn` in
  `packages/pipeline/src/code-host-github.ts` parses the body: a closing word,
  else `Part of #N`, as `owner/name#N`. Review sends a pull request with no
  ticket back to build (`no_ticket`, `stages/review/gate.ts`). Ship reads the
  criteria by that ticket id. Build and the lane write `Closes #N` into the
  body. A tracker id like `demlik-1` does not parse.
- **demlik's CI.** `build.yaml` and `publish.yaml` do not read the body.
- **People.** A reader of the pull request on GitHub follows the link to see
  why it exists.

```ts
// Today: the ticket is read back out of the PR body.
ticketIn(pr.body)  // "Closes #631" -> "kamp-us/demlik#631"; "Closes demlik-1" -> none -> no_ticket

// Sketch: the ticket comes from the lane's own fact, written by code.
{fact: "built", ticket: "demlik-1", task: 1, commit: "a1b2c3…"}  // push-after-review.md
```

What a demlik rule change would need (not done; demlik was not changed):

- `CLAUDE.md` line 105: "Write `Closes #N` in the body, where `N` is an
  issue number." It would accept a tracker id, or the approved ticket's text,
  in place of an issue number.
- `CLAUDE.md` "What fabrika reads here" and ADR 0013 ("fabrika is the work
  pipeline"): the list of what the pipeline reads would gain the tracker and
  lose issues for new work.
- While today's fabrika still runs on demlik: its ship skill refuses a code
  pull request without `Fixes #N` or `Part of #N`, and its heal-ci sweep looks
  at every open pull request. That is today's fabrika's rule, not demlik's,
  but it would meet the rebuild's pull requests.

## Part 4: triage with and without the comments

20 of 345 triaged tickets (6%) had a comment before triage. Each ran in both
forms. 8 ran a second time.

| ticket | the tracker's shape | the GitHub page |
|---|---|---|
| #36 | no, then duplicate #273 | duplicate #273, twice |
| #68 | duplicate #69, twice | ruling, twice |
| #221 | fold #215, twice | plan, twice |
| #428 | fold #422, twice | fold #422, then plan |
| #631 | plan, twice | ruling, twice |
| the other 15 | the same answer in both forms | |

- **3 differ in both runs: #68, #221, #631.** Each time the GitHub page's
  answer matches what happened.
  - #68: the comment said #69 had been folded into it. Without it, triage
    called #68 a duplicate of #69, the wrong way round. With it, triage saw
    the open choice the ticket names and asked for a ruling. The owner ruled
    minutes later.
  - #221: the comment bundled a second finding into the ticket. Without it,
    triage folded the ticket into an older plan. With it, a plan of its own.
    It shipped as its own pull request.
  - #631: the comment was a downstream trial's findings: one criterion could
    not be met. With it, triage asked for a ruling, and a ruling came.
- **2 differences were noise.** #36's tracker answer and #428's GitHub answer
  each changed between runs: 2 of 16 repeated answers.
- **What the 3 comments were:** a fold note, a bundled finding, a trial's
  findings. In the tracker, the first is a fold fact and the other two are an
  edit to the body before the yes, which costs no new yes.

## Part 5: the facts and `covers`, tested

The facts are in the script (`138-tracker-on-demlik.ts`, part 5), with
`Id` from `@kampus/pipeline/entity`:

```ts
const Edited = Schema.Struct({
	fact: Schema.Literal("edited"),
	ticket: TicketId,                        // /^[a-z]+-[1-9][0-9]*$/, "demlik-1"
	by: MemberId,
	title: Schema.optionalKey(Title),        // a non-empty string
	body: Schema.optionalKey(Schema.String),
}).check(Schema.makeFilter((e) => e.title !== undefined || e.body !== undefined
	|| "an edit changes the title or the body"));

const Approved = Schema.Struct({
	fact: Schema.Literal("approved"), ticket: TicketId, by: MemberId, plan: PlanId,
	text: TextHash,                          // "sha256:<64 hex>", branded
});

const textOf = (t) => sha256(JSON.stringify([t.title, t.body]));   // a pair, not a join
const ticketOf = (facts, id) => /* fold: filed sets, edited replaces what it names */;
```

- **Two findings from writing it:**
  - The note's sketch, `sha256(title, body)`, would let "ab" + "c" and
    "a" + "bc" share a hash. Hashing the pair as JSON does not.
  - A union of three edit structs (title, body, both) would lose data: Effect
    drops keys a struct does not know, so an edit of both decodes as the
    title-only one. One struct with a filter does not.
- **The property test** (fast-check, seed 138, 2,000 runs each):

| property | result |
|---|---|
| an untouched ticket is covered, whatever came before the yes | ok |
| an edit after the yes that changes the text is never covered | ok |
| an edit that puts the text back is covered again (#430) | ok |
| a yes never covers another ticket, even one with the same text | ok |
| moving text between title and body changes the hash | ok |
| every fact decodes as itself, no key dropped | ok |
| a planted body-only hash is caught (by a title-only edit) | ok |
| the schema refuses an empty edit, an empty title, a bad hash, `kamp-us/demlik#1` as an id | 4 of 4 |

## Recommendations

**The v1 ticket: id, title, body, who filed it. Nothing else on the ticket.**

```ts
// v1: on the ticket
{fact: "filed", ticket, by, title, body}
{fact: "edited", ticket, by, title?, body?}
{fact: "approved", ticket, by, plan, text}
// already elsewhere on the ledger: criteria (the plan), rulings (asks), lanes, folds
// left out: labels, milestones, assignees, reactions, images, a comment thread, backlinks
```

- Why: built tickets lean on title, body and links. Labels are stage answers
  the ledger already holds. Assignees, images and reactions were never used.
- The doubt is the comment thread. 40 findings or rulings lived only in a
  comment on built tickets, and 3 of 20 triage answers changed with a
  comment. All of those fit an edit before the yes, a ruling fact or a fold
  fact. None needed a thread.
- Cost: a filer adds a finding by editing the body, not by replying. After the
  yes, that edit asks for a new yes.
- **How sure: 75%.** What would settle it: the first 10 demlik tickets filed
  in the tracker. If people want to reply rather than edit, add a `noted`
  fact that triage and plan read, outside the hash.

**Hash the title and the body, as a JSON pair. Not the criteria.**

- Why: renames changed the ask 2 times of 3. Criteria in the hash would ask a
  new yes on a third of tickets, mostly for review's lines. Without them, 8%,
  and 1% more than an hour after the yes. A version in the plan's id covers
  the plan.
- Cost: a cosmetic edit still asks for a new yes (2% of tickets). Cheap: the
  owner says yes again.
- **How sure: 80%.**

**`Closes #N`: the rebuild reads the ticket from its own fact, never from the
pull request body. Put the approved ticket's title and text in the body for
people. Ask demlik to accept that instead of `Closes #N`.**

- Why: no stage needs a GitHub issue once the lane's facts name the ticket.
  [Push after review](../docs/direction/push-after-review.md) already makes
  build and review work from a commit and a fact. No outsider ever wrote a
  demlik issue or comment, so a GitHub copy would have no readers that the
  body does not reach. And comments on a copy reach nobody.
- This goes against the tracker note's lean (a GitHub copy at approval, 70%).
- Cost: `ticketIn` and the review and ship gates move to the lane's fact.
  demlik's `CLAUDE.md` rule and ADR 0013 change. While today's
  fabrika runs on demlik, its ship rule and heal-ci will meet pull requests
  with no issue.
- **How sure: 65%.** The doubt: an outside reader of the repo may want a
  public issue to follow, and there may be a GitHub feature (a project board,
  release notes) that reads the link and that this count missed. What would
  settle it: the demlik maintainers' answer on the rule change, and one
  release cut with no issue links.

**Ticket ids: not a bare `#N`.** 85% of bodies name another ticket, today as
`#N`. A tracker id like `demlik-1` cannot be mistaken for an old GitHub issue.
How sure: 70%; the id's form is still the note's open guess.

## Cost

- **Part 4:** 56 sorts (40, then 16 repeats), 56 calls, no second try. $5.57.
  603,389 input tokens (with cache writes), 291,211 cache reads, 29,494 output
  tokens. The estimate before the run was $2.14 for the 34 after the first 3,
  at list price before the cache; those 34 cost $4.44. The repeats cost $0.29,
  on a warm cache.
- **Parts 1 to 3 and 5:** $0. `gh` reads and local counting.
- One field row per sort in `field/runs.jsonl`, and note 2026-10-24-05.

## What it cannot tell us

- **The yes is a stand-in.** `ready-for:agent` is added by triage, an agent,
  not by the owner after reading a plan. The tracker's yes comes later, on a
  plan. Edits between triage and that yes would not count against it, so the
  8% may be high. The 23 `pitch-approved` tickets are closer to the real yes,
  and only 1 of them had a prose edit after it.
- **One repo, two accounts, ten weeks** (2026-08-17 to 2026-10-24). demlik has never had an outside
  filer. A repo with outsiders may lean on comments much more.
- **The hand reading is one reader's.** 30 edits were judged meaningful or
  not by hand; the rule-based first reading placed the other 108.
- **Part 4 is small.** 20 tickets, 8 repeated. One more difference moves the
  rate by 5 points. Opus at medium only.
- **The GitHub form is a guess at what an agent saw.** The comments were
  appended to the body. Today's triager reads them through `gh`, in its own
  way.
- **Nothing ran on the tracker.** No ticket was filed as facts, no stage read
  one. The prototype is a sketch in the script.
- **Who reads demlik on GitHub was not measured.** Views, stars and outside
  readers of pull requests are not in the data.
