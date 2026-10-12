# The review stage today: a step list

Status: **a draft.** It lays out what today's fabrika reviewer does, one step
at a time, so a design conversation can walk through it. It holds no design
and no machine.

**Everything described here is today's fabrika**: the reviewer agent, its
skill, its verbs, the verdict comments and the lane ledger. One thing is this
repo's, and it is named where it matters: the six logged runs were started by
this repo's operator machine (`src/operator.ts`), not by fabrika's operator
agent. This repo also has an older review machine for toy tickets
(`src/review.ts`, experiments 27 to 30). This page is not about it.

It is read from three places.

- **The skill.** Fabrika's [`review` skill][skill], its [contract page][contract],
  its three rubrics ([code][rubric-code], [doc][rubric-doc],
  [skill][rubric-skill]) and the [`reviewer` agent file][agent], at commit
  `0ac2c6b` of the plugin's public repo, CLI 0.9.0. The logged reviewers ran
  that same text.
- **The logs.** Six reviewer runs on five tickets of one repo,
  [kamp-us/demlik](https://github.com/kamp-us/demlik), kept under `runs/` on
  one machine (ignored by git, never committed). Their verdicts are public on
  the pull requests and are linked below.
- **The bigger record.** Experiments
  [54](../experiments/54-why-reviews-fail.md),
  [57](../experiments/57-repeat-findings-read-by-hand.md) and
  [58](../experiments/58-shrinking-list-replay.md), which read the reviews
  fabrika recorded on [kamp-us/phoenix](https://github.com/kamp-us/phoenix).

Where the skill says one thing and the logs show another, both are given. The
logs win for "what happens".

## The whole stage in one block

```text
today's reviewer: one pull request, one head commit, one run

read     1  which kinds of review the change needs            code
         2  the ticket's criteria and the owner's rulings     code
         3  the verdicts already posted                       code
         4  the diff at the head commit                       code
         5  the builder's list of deviations, plus a scan     code
         6  the ticket's thread and the pull request's text   code
         7  the rubric for each kind                          code

checks   8  governance review, if a protected path changed    not sure
         9  wait for the checks on this commit                code
        10  a red required check fails the review             code
        11  read the failing log, say where to look           reader

think   12  read more of the code than the diff shows         reader
        13  grade each criterion, with file and line          reader
        14  look for what the criteria do not name            reader
        15  does such a finding belong to this ticket?        not sure
        16  add it to the ticket, or file it                  code
        17  hold the builder's deviations against the diff    reader
        18  PASS or FAIL for each kind                        not sure

say     19  write the verdict                                 reader
        20  post one verdict per kind                         code
        21  write the ending in the lane ledger               code
        22  tell the person what happened                     not sure

22 steps: 12 code, 6 reader, 4 not sure
```

`code` is short for `code can do this`: no judgment is involved, or an
experiment measured it. `reader` is `needs a reader`. `not sure` means the
evidence does not settle it.

The order is the order the logs show. A "kind" is what fabrika calls a
namespace: the name a verdict is posted under. There are four this reviewer
or its helper posts: `review-code`, `review-doc`, `review-skill` and
`governance`.

## What today's reviewer does

The reviewer agent is an empty shell. It has six tools (a shell, three ways to
read files, the skill loader and a way to start helper agents) and no
behaviour of its own. Everything it does comes from the `review` skill.

The six logged runs:

| Run | Ticket, pull request | The change | Ended | Time | Cost | Tool calls |
|---|---|---|---|---|---|---|
| A | 559, [#626](https://github.com/kamp-us/demlik/pull/626) | docs, one paragraph | PASS doc | 64 s | $0.56 | 8 |
| B | 561, [#632](https://github.com/kamp-us/demlik/pull/632) | docs, three files and one test | PASS code, doc | 80 s | $0.67 | 9 |
| C | 622, [#634](https://github.com/kamp-us/demlik/pull/634) | code, 11 files | PASS code, doc | 137 s | $1.01 | 13 |
| D | 623, [#629](https://github.com/kamp-us/demlik/pull/629) | code and a workflow file | PASS code, governance | 145 s | $1.02 | 15 |
| E | 625 round 1, [#628](https://github.com/kamp-us/demlik/pull/628) | code and docs | FAIL code, doc | 131 s | $1.00 | 19 |
| F | 625 round 2, [#628](https://github.com/kamp-us/demlik/pull/628) | the same, repaired | PASS code, doc | 147 s | $0.87 | 19 |

All six ran on the same model at the same effort. Together: 11.7 minutes,
$5.12, 11 verdicts (9 PASS, 2 FAIL).

**How to read the times.** A log line is stamped when a call was sent. The
time to the next line is that call plus the model's thinking before its next
call. So a step's time below is the most the call can have taken, and writing
a verdict shows up as the gap before the post. One logged command often chains
several verbs. Commands are cut at 600 characters. Exit codes and outputs are
not logged.

### 1. Which kinds of review the change needs

Asks fabrika what this pull request is: its head commit, its ticket, which
kinds of file it touches (code, doc, skill, ui), which verdicts it therefore
owes, and whether a protected path changed. The head commit it prints is
passed to every later verb.

```text
fabrika review scope <pr>
  prints: head, issue, class rows, namespace rows, routed rows, self, harness,
          governance required | not-required
```

- **Logged:** 6 of 6 runs, always the first call. 2 to 8 s.
- **Move and tag:** Gather. `code can do this`. It is one verb today, and the
  kind of a file is a fixed path rule inside the CLI: plugin and skill folders
  are skill, other `.md` files are doc, everything else is code.

In the logged repo only code and doc came up, and governance once. That repo
ships no screens, so the rendered-visual kind (`review-ui`, posted by another
gate) never appeared.

### 2. The ticket's criteria and the owner's rulings

Reads the ticket's acceptance criteria, plus any comment the owner marked as a
ruling. Each row comes back as `body` or `ruling`, and `open`, `checked` or
`superseded`. Owner comments with no ruling mark are listed too, to be read
but not graded. The skill says code with no ticket fails right here.

```text
fabrika review criteria <issue>
fabrika review report <pr>        optional: a criterion that asks the author to report something
```

- **Logged:** `criteria` in 6 of 6. About 1.5 s where it ran alone (2 runs);
  chained with step 3 in the other four. `report` in 0 of 6. All six had a
  ticket.
- **Move and tag:** Gather. `code can do this`. One verb, and the rows come
  from marks in the text, not from reading what the text means.

### 3. The verdicts already posted

Lists every verdict comment already on the pull request. Each one is `current`
(it is about this head), `stale` (about an older head) or `unbindable`, and
`standing` or `superseded`.

```text
fabrika review verdicts <pr>
```

- **Logged:** 6 of 6. With step 2, 2 to 10 s. Five of the six were a first
  round, so there was nothing earlier to find.
- **Move and tag:** Gather. `code can do this`. The verb compares a commit and
  a 12-character digest. Nothing is read for meaning.

### 4. The diff at the head commit

Reads the whole diff at the head from step 1. The verb refuses to hand over a
diff that was cut off. A large diff is written to a file whose path fabrika
picks, and read from there. The reviewer never checks the branch out.

```text
fabrika review diff <pr> --sha <head>
fabrika review scratch <pr> --slug diff --lane <lane> --sha <head>     prints the path for a large diff
```

- **Logged:** `diff` in 6 of 6, 1.5 to 2 s where it ran alone (3 runs).
  `scratch` in 1 of 6: run C, 11 files, which then read the file twice.
- **Move and tag:** Gather. `code can do this`. One verb with no choice in it.

### 5. The builder's list of deviations, plus a scan

Reads the `## Deviations` section of the pull request's text: is it there, is
it well formed, what does it list. The same verb scans the diff for things
nobody should hide, like a switched-off check or a removed assertion.

```text
fabrika review deviations <pr> --sha <head>
  prints: found | none-declared | absent | malformed, the entries, the scan's hits
```

- **Logged:** 6 of 6. About 1 s where it ran alone.
- **Move and tag:** Gather. `code can do this`. The scan is pattern matching
  inside the CLI. Whether an entry is honest is step 17.

### 6. The ticket's thread and the pull request's text

Reads the ticket with all its comments, and the pull request's own text. These
are plain `gh` calls. The skill has no verb for them.

```text
gh issue view <issue> --json body,comments
gh pr view <pr> --json body,title,files         the fields differ by run; run F added comments
```

- **Logged:** the ticket's thread in 6 of 6. The pull request's text in 5 of 6
  (not run B). 1 to 14 s.
- **Skill and logs disagree.** The skill says the pull request's text is "not
  an input", apart from the deviations section, a report section and the
  ticket reference. Five of six reviewers read all of it. In run D one
  criterion was marked `[evidence: …]` and pointed at a section of that text,
  and the reviewer graded the criterion on the builder's pasted output there.
- **Move and tag:** Gather. `code can do this`, for the fetch: the same two
  calls in every run. What the reviewer makes of a comment is step 13.

### 7. The rubric for each kind

Opens one rubric page for each kind of file step 1 named: code, doc or skill.
The rubric says what to grade and what a verdict must show.

```text
claude-plugins/fabrika/skills/review/rubrics/code.md
claude-plugins/fabrika/skills/review/rubrics/doc.md
claude-plugins/fabrika/skills/review/rubrics/skill.md
```

- **Logged:** 5 of 6. Run D's log shows no rubric read. 3 to 8 s.
- **Move and tag:** Gather. `code can do this`. The rows from step 1 pick the
  files.

### 8. Governance review, if a protected path changed

When step 1 says `governance required`, the reviewer loads a second skill,
`governance`, inside the same run and posts a `governance` verdict. The skill
says this is owed in every round, before the wait in step 9. In the logged
repo the protected paths are `.claude/`, `.github/`, `.fabrika.jsonc` and two
`biome.jsonc` files.

```text
Skill fabrika:governance
fabrika governance scope <pr>
fabrika governance guards <pr> --sha <head>
fabrika status settings
cat .decisions/index.md ; git show <head>:.decisions/<one record>.md
fabrika governance post <pr> --polarity PASS|FAIL --sha <head> --clause "…"
```

- **Logged:** 1 of 6 (run D, a workflow file). 52 s, six calls. The
  [verdict](https://github.com/kamp-us/demlik/pull/629#issuecomment-6105683858)
  has a part a verb produced and a part marked "read by hand": five decision
  records.
- **Move and tag:** Draft. `not sure`. One run, and the governance skill was
  not read for this page. Whether it is owed is step 1, which is code.

### 9. Wait for the checks on this commit

Waits for the repo's required check to end at this head, for up to eight
minutes. The answer is one of `settled` (green or red), `budget-exhausted`,
`head-moved`, `governance-owed` or `governance-stale`. The skill says the
reviewer never sleeps or polls by hand.

```text
fabrika review ci <pr> --sha <head> --wait --budget-seconds 480
```

- **Logged:** 6 of 6. 2 to 16 s. Never a real wait.
- **Why so short here.** This repo's operator had already waited for the
  checks before it started the reviewer: about 5.5 minutes in lane 625 and 7.4
  in lane 561. Under fabrika alone the reviewer does the waiting. On phoenix,
  92 failed reviews had the red check arrive while the reviewer ran, and those
  took 10.9 minutes at the median
  ([experiment 54](../experiments/54-why-reviews-fail.md)).
- **Skill and repo guide disagree.** The logged repo's guide says the reviewer
  runs the first criterion's end-to-end fixture. The skill says no kind of
  review runs again what CI enforces. In the logs, 0 of 6 reviewers ran a
  test, a type check or a fixture. They read CI's answer, and two verdicts
  say so in words: "Not re-run locally."
- **Move and tag:** Listen. `code can do this`. In the logged lanes this
  repo's operator did this very wait in code.

### 10. A red required check fails the review

If the required check is red at the head, the review fails. No reading is
needed to know that much.

```text
reads: the answer of step 9 (settled, red)
```

- **Logged:** 1 of 6 (run E). No time of its own. The operator's last poll
  already said red, three seconds before it started the reviewer.
- **Move and tag:** Check. `code can do this`. On phoenix, when code checks a
  red check again one round later, it agrees with the reviewer 88% of the
  time, 65 of 74
  ([experiment 58](../experiments/58-shrinking-list-replay.md)).

### 11. Read the failing log, say where to look

Opens the check's log to see what broke, and writes down where the builder
should look. These are plain `gh` calls outside the skill's verbs.

```text
gh pr checks <pr> ; gh run list --commit <head>
gh run view <run> --log-failed
gh run view <run> --log | grep <a test's name>
```

- **Logged:** 2 of 6. Run E: four calls, 29 s. Its verdict names the failing
  test, quotes the two lines CI printed, and adds a guess marked "my reading,
  not proven". The repair went after the cause the guess named. Run D: one
  call on a green run, to see that the new test had really run.
- **Move and tag:** Draft. `needs a reader`. The guess in run E came from
  holding the log against code the diff did not touch.

### 12. Read more of the code than the diff shows

Reads files at the head that the diff only touches or does not show: the rest
of a changed file, a sibling page, a workflow file, and once the source of a
pinned dependency.

```text
git show <head>:<path>
git grep <pattern> <head> -- <paths>
git diff --stat <old head> <new head>          run F only
Read node_modules/<package>/<file>             run F only
```

- **Logged:** 6 of 6. One to eight calls a run, from a few seconds to about
  50 s in run F.
- **Move and tag:** Draft. `needs a reader`. The paths differ in every run,
  and no list says which to read. The reviewer picks them from what the diff
  made it doubt.

### 13. Grade each criterion, with file and line

Gives every criterion from step 2 a row: PASS or FAIL, with the file and lines
that show it. A criterion marked `[evidence: …]` is graded on the source it
names. This step has no call. It shows only in the verdict's text.

```text
reads: steps 2, 4, 6, 7, 9 and 12
writes: nothing yet. The rows go out in step 19
```

- **Logged:** rows in all ten review verdicts (the eleventh is governance).
  Their spelling is not fixed: `[PASS]`, `[FAIL]`, `[PASS on the text]`,
  `[PASS on the diff, unproven at head]`, `[PASS, with a named limit]`, and
  once a table. With steps 14 to 19 it is the 13 to 44 s gap before the first
  post.
- **Move and tag:** Draft. `needs a reader`. Code alone can check about 15% of
  recorded findings again
  ([experiment 58](../experiments/58-shrinking-list-replay.md)).

### 14. Look for what the criteria do not name

Checks the things every change owes, whatever its ticket says. For code: no
test was loosened, the release note matches the change, comments are right,
nothing was left stale, and each claim about behaviour was traced to code. For
docs: the right place, one kind of page, status lines, claims traced, plain
prose. The skill adds a sweep for silent failures, weak types and missing
tests, "as checklist lines in this same pass".

```text
reads: the same as step 13
writes: nothing yet
```

- **Logged:** a "Standing checks", "Hygiene" or "Doc rubric" block in the
  verdicts of all six runs. The sweep leaves no trace in a log, and one
  verdict of ten names it: run B, "nothing found". The skill lets the reviewer
  start helper agents; 0 of 6 did.
- **Move and tag:** Draft. `needs a reader`. On phoenix two failed reviews in
  three needed a reader, and the largest part was text that says something the
  code no longer does
  ([experiment 54](../experiments/54-why-reviews-fail.md)).

### 15. Does such a finding belong to this ticket?

A finding the criteria do not cover gets one yes or no question: does it trace
to the ticket's goal? The skill allows no "minor" or "major".

```text
reads: the finding, the ticket's goal
answers: in scope | out of scope
```

- **Logged:** 0 of 6. Run E's verdict held two side notes beside its blocking
  finding. Neither was added to the ticket or filed. On phoenix this comes up
  in a fifth to a third of failed reviews (experiment 54).
- **Move and tag:** Judge. `not sure`. A small classifier got this question
  right 30 times in 36 with none wrong, but on 12 clean cases made by hand
  ([experiment 27](../experiments/27-review-router.md)). No real case is in
  the six logs.

### 16. Add it to the ticket, or file it

In scope: the finding becomes a new criterion on the ticket, and the round
must fail. Out of scope: it is filed as a new report and blocks nothing. At
the last round the budget allows, a new finding goes out as a tagged comment
only.

```text
fabrika review append-criterion <issue> --pr <pr> --round <n>
/report                                    fabrika's report skill, for the out-of-scope ones
```

- **Logged:** 0 of 6.
- **Move and tag:** Act. `code can do this`. One verb. The CLI already
  enforces the rule beside it: a PASS in a round that added a criterion is
  refused.

### 17. Hold the builder's deviations against the diff

For each thing the builder declared in step 5: does the diff bear it out? And
did the scan find anything the builder did not declare?

```text
reads: step 5, the diff, the reviewer's own findings
writes: nothing yet
```

- **Logged:** a deviations block in a verdict of all six runs, one row or line
  per entry. On phoenix this line fails in about 5% of failed reviews
  (experiment 54).
- **Move and tag:** Draft. `needs a reader`. Each row in lane 625 is an
  argument: one file "is untouched", one function "has nothing left to drop",
  so the entry is "Sound".

### 18. PASS or FAIL for each kind

Each kind gets one word. The skill's rule: any failing row fails the kind, the
required check must be green, and "an unseen input blocks PASS, never FAIL".

```text
reads: the rows of steps 10, 13, 14 and 17
answers: PASS | FAIL, once per kind
```

- **Logged:** 11 verdicts, 9 PASS and 2 FAIL.
- **Move and tag:** Check. `not sure`. The rule is simple, but the rows are
  prose, so no code can apply it today. And a row is not always a plain yes or
  no. Run E has `[PASS on the diff, unproven at head]`. Run C has
  `[PASS, with a named limit]`. Run F passed a point on its own reading of a
  criterion's words, adding "The owner can rule otherwise".

### 19. Write the verdict

Writes the comment's body: free markdown, one per kind. The findings exist
only in this text.

```text
writes: the text piped into step 20
```

- **Logged:** 11 bodies, 1,521 to 4,351 characters. The headings differ from
  one verdict to the next. 13 to 44 s before the first post in a run.
- **Move and tag:** Draft. `needs a reader`. Today, writing a finding and
  having it are one act. On phoenix a failing verdict is 4,760 characters at
  the median, and a quarter of them list no finding a program could pick out
  (experiment 54).

### 20. Post one verdict per kind

Posts the comment. The verb checks the head again, writes the first line
itself, posts, and reads the comment back. It is a comment only, never a
GitHub approval. A second post at the same head keeps the old text under
`## Superseded verdict`.

```text
fabrika review post <pr> --namespace <kind> --polarity PASS|FAIL --sha <head> --round <n> --clause "…"
  the body comes in on stdin; --round is required on PASS only
```

- **Logged:** 6 of 6, one post per kind (run B sent both in one command). 10
  to 20 s each, with the model's next turn. In run D the first post left no comment, and the same command was
  sent again 20 s later. The log does not say why. Run E's two FAIL posts
  carried no `--round`.
- **Move and tag:** Act. `code can do this`. The verb does all of it. The
  reviewer supplies only the text and one short clause.

### 21. Write the ending in the lane ledger

Records how the run ended, as one of six words: `PASS`, `FAIL`, `UNKNOWN`,
`STALE`, `UNBINDABLE` or `ROUTED`. Before it accepts a `PASS`, the verb checks
it against the pull request.

```text
fabrika lane report <lane> --root <ledger folder> --task issue --token <word> --pr <url> --class code --class doc
```

- **Logged:** 6 of 6. With step 22, 5.5 to 9 s. Governance is not a class:
  run D reported `--class code` alone.
- **Skill and logs disagree.** The brief's fixed rules tell a shell to record
  its working copy "before anything else". 0 of 6 did. Under this repo's
  operator the shell is told the folder is already its working copy.
- **Move and tag:** Act. `code can do this`. One verb, and the word follows
  from the verdicts just posted.

### 22. Tell the person what happened

Ends with a short message. The skill asks for two plain lines: what happened,
and what the person does next.

```text
What happened: the review passed and the lane moved from review to ship.
What you do next: nothing — the operator can ship it.
```

- **Logged:** 6 of 6. The two lines above are run D's. Each also ended with one JSON line,
  `{"token": …, "pr": …}`. That line is asked for by this repo's operator
  (`src/shell-skill.ts`), not by fabrika.
- **Move and tag:** Draft. `not sure`. In all six runs a program read the
  ending, not a person. Nothing here measures what a person needs from it.

## What comes out

Three things leave a review today: comments on the pull request, one line in
the lane ledger, and a short closing message.

**The verdict comment.** One per kind, per head commit. Only its first line
has a fixed format:

```text
<kind>: <PASS|FAIL> @ <head commit> content:<12 hex characters> — <one short clause>
```

The `content:` part is a digest of what the verdict looked at. It lets a
verdict stay good when the head moves but the reviewed files did not change.
Everything under the first line is free text. The last line is
`Verdict-written:` and a time.

A real one, trimmed
([the comment](https://github.com/kamp-us/demlik/pull/628#issuecomment-6104688946),
run E):

````markdown
review-doc: FAIL @ 6f4907a3ca552cf482652dd0f01b3aea3aa0853f content:d3965bda7ae1 — the docs promise one stderr line; CI at this head measured two

## What has to change

Three doc files state the same runtime fact: a crash prints one stderr line. […]

At this head that is measured false. Both CI runs (38105398220, 38105394142)
show the real command line printing `context canceled` and then the
`code-graph:` line on the crash path. Details are in the `review-code` verdict
on this PR.

[…]

## Criterion 4

**[PASS on the text]** `SPEC.md` §13.6 names exit 3, says when it happens, and
says an unwritable `--out` gets 3, not 2. […]

## Criterion 5, changeset half

**[PASS]** `.changeset/code-graph-api-crash-exit.md` is a patch for
`@demlik/code-graph` and names exit 3. The test half is graded in `review-code`.

## Hygiene

[…]
- Claims trace: **FAIL**, the one-line claim above.
- Prose craft: short, plain sentences. […] Clean.

Verdict-written: 2026-10-11T02:38:58Z
````

The [code verdict beside it](https://github.com/kamp-us/demlik/pull/628#issuecomment-6104687058)
has other headings: `## What has to change`, `## Per criterion`,
`## Standing checks`, `## Deviations`. Six of the nine PASS verdicts carry
the same clause, `merge-ready`.

**The lane ledger.** One line, with the word and the kinds of file. No
finding, no head commit, no round number:

```json
{"task":"issue","event":"ISSUE.FAIL","at":"2026-10-11T02:39:04.616Z","classes":["code","doc"],"pr":"https://github.com/kamp-us/demlik/pull/628"}
```

**What a later round is given.** The same brief as the first round. It has
three parts: which lane and task, two or three links (the ticket, the pull
request, sometimes the owner's comments), and fixed rules that say to work
from the links and never from a summary. It carries no round number, no list
of earlier findings and no earlier head commit. The builder that repairs a
failed review gets the findings another way, by reading the verdict comments
(`fabrika build verdicts --pr <pr>`).

Today's shape, as types. **This is today, as found. It is not a proposal.**

```ts
// today, as found

type Kind = "review-code" | "review-doc" | "review-skill" | "review-ui" | "governance";

/** The first line of a verdict comment. The only part code reads. */
type VerdictMarker = {
  kind: Kind;                 // fabrika's word: namespace
  polarity: "PASS" | "FAIL";
  sha: string;                // the head commit it judged
  content: string | null;     // 12 hex characters, a digest of what it looked at
  clause: string;             // free text, one line
};

/** One comment on the pull request. */
type VerdictComment = {
  marker: VerdictMarker;
  body: string;               // free markdown. Headings differ. A finding has no id and no type
  writtenAt: string;          // the last line, "Verdict-written: <time>"
};

/** How `review verdicts` reads an old comment at a later head. */
type Binding = "current" | "stale" | "unbindable";
type Standing = "standing" | "superseded";

/** How a reviewer run ends. One word per run. */
type Terminal = "PASS" | "FAIL" | "UNKNOWN" | "STALE" | "UNBINDABLE" | "ROUTED";

/** The one line the lane ledger gets. */
type LedgerLine = {
  task: string;               // "issue" in all six runs
  event: string;              // seen: "ISSUE.PASS", "ISSUE.FAIL"
  at: string;
  classes: Array<"code" | "doc" | "skill" | "ui">;
  pr: string;
};

/** What the reviewer is started with, in every round. */
type LaneBrief = {
  task: { lane: string; root: string; fabrika: string; task: string; state: string; shell: string };
  ground: { issue: string; pr: string; ownerComments?: string[] };   // links only
  rules: string;              // fixed text
};
```

There is no type for a finding, a criterion's row or a round, because today
none of them exists outside the comment's prose.

## Round 2 and later

One later round is on record: run F, the second review of lane 625.

**What the skill says.** Nothing in it makes a later round smaller. Every
round owes every kind again, governance too. A verdict is good for one head
commit. The round number is the reviewer's own count; no verb hands it over.
The budget is three repair rounds, then the lane stops for a person.

**What round 1 left.** One blocking finding: the required check was red,
because a new test saw two lines where the ticket asked for one. `review-doc`
failed beside it for the same reason. The code verdict also held two side
notes. Between the rounds four builder runs were started: one pushed the fix
and died before saying so, two more died, and the fourth wrote the
[repair note](https://github.com/kamp-us/demlik/pull/628#issuecomment-6104807390).

**What round 2 was given.** The same brief as round 1. No round number, no
findings, no old head.

**What round 2 did**, from its log:

```text
  3 s   scope                                    the same opening as round 1
 10 s   criteria, verdicts
 12 s   the whole diff at the new head           not the repair alone
 14 s   deviations
 29 s   gh pr view … comments                    where it learned what round 1 said
 30 s   gh issue view … comments
 31 s   the rubrics, again
 35 s   the CI wait: green
 37 s   eight calls reading code at the head     about 50 s; one read a dependency's source
 85 s   one of the eight: git diff --stat <old head> <new head>
                                                 its only look at the repair by itself
109 s   post review-code PASS --round 2
127 s   post review-doc PASS --round 2
138 s   lane report PASS
```

- **It read everything again.** Scope, criteria, the whole diff, the rubrics.
- **It found round 1 by reading the pull request's comments** with a plain
  `gh` call, and from step 3. Nothing handed it the earlier findings.
- **It graded everything again**: all five criteria, the standing checks and
  the deviations table, in both kinds.
- **It answered the earlier findings in prose**, under a new heading,
  `## What changed since the last round`. The blocking one: fixed, with CI
  green on 2 of 2 runs where it had been red on 2 of 2. The comment note:
  fixed. The third note: passed as disclosed.
- **It worked out `--round 2` by itself.**
- **The round 1 comments stayed as they were.** New comments went up at the
  new head
  ([code](https://github.com/kamp-us/demlik/pull/628#issuecomment-6104823433),
  [doc](https://github.com/kamp-us/demlik/pull/628#issuecomment-6104825386)).
  The old ones now read as `stale`.
- **It was not cheaper.** Round 1: $1.00 and 131 s. Round 2: $0.87 and 147 s.

## The tally

| Tag | Steps | Which | Minutes in the six runs | Share |
|---|---|---|---|---|
| `code can do this` | 12 | 1 to 7, 9, 10, 16, 20, 21 | 5.9 | 50% |
| `needs a reader` | 6 | 11 to 14, 17, 19 | 4.3 | 37% |
| `not sure` | 4 | 8, 15, 18, 22 | 1.2 | 11% |
| before the first call | none | loading the skill and the brief | 0.3 | 3% |

The shares are rounded, so they add to 101%. The whole is 11.7 minutes.

How the minutes were charged: the gap after a call goes to that call's step.
The gap before the first post goes to `needs a reader` as one block, because
the logs cannot split steps 13 to 19. That block also holds steps 15 and 18,
which are tagged `not sure`. The gap between two posts is split between
writing and posting. A chained command is split evenly between its verbs, and
the last gap of a run evenly between steps 21 and 22. Steps 10 and
16 have no minutes: one has no call and the other never ran.

What it says and does not say:

- It says more than half the steps, and half the logged minutes, are reads,
  waits and posts. It does not say they are slow: those minutes hold the
  model's turn around each call as well as the call, and the long wait was
  done by the driver.
- It does not say code can do half the judging: code alone can check about 15%
  of recorded findings again, and the rest need a reader at some point.
- It does not say the `reader` steps are done well: about 31% of later-round
  findings on phoenix were already there and missed, most of them in a file
  the earlier review says it read.
- Step 10 is the one place where code gives a verdict by itself, and it rests
  on one number: checked again a round later, a red check and the reviewer
  agree 88% of the time.

## What this page cannot tell us

- **Six runs, five tickets, one repo.** Shares of minutes taken from 11.7
  minutes of logs are rough.
- **One later round, and one failed review.** Round 2 and later rests on a
  single case. So does everything about a red check in the logs.
- **Whole kinds are missing.** No skill-file review, no rendered-visual
  review, no ticket that is one part of a larger one, no review with no
  ticket, no appended criterion, no filed report, no helper agent, no round at
  the budget's end. For those the page has only the skill's text.
- **One governance run**, and the governance skill was not read.
- **The logs are thin.** Commands are cut at 600 characters, and exit codes
  and outputs are not kept. A verb hidden in the cut tail of a command is
  missed. Why run D posted twice is unknown.
- **Thinking is invisible.** A gap between two calls mixes the call's own time
  with the model's thinking. Steps 13 to 19 are told apart by the verdict's
  text, not by the log. The sweep in step 14 cannot be seen at all.
- **The brief's text is not kept** in the run files. Its shape is read from
  the CLI's source.
- **The wait is understated.** This repo's operator waited for the checks
  before starting the reviewer. Under fabrika alone the reviewer waits, so its
  minutes are longer and step 9 is a larger share of them.
- **The driver was not fabrika's.** The closing JSON line and the missing
  working-copy call come from this repo's operator. A run under fabrika's own
  operator may differ in other small ways.
- **The phoenix numbers come from another repo** and another set of tickets:
  the 15%, the 31%, the 88% and the two in three. They are not measured on
  these six runs.
- **The tags are one reading.** "Needs a reader" means no experiment has shown
  code doing the step, not that none could.
- **The skill is one commit.** It changes often. A later version may differ.

[skill]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/SKILL.md
[contract]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/contract.md
[rubric-code]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/rubrics/code.md
[rubric-doc]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/rubrics/doc.md
[rubric-skill]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/skills/review/rubrics/skill.md
[agent]: https://github.com/kamp-us/phoenix/blob/0ac2c6bfc342b8d18918b78150a8b95c43233496/claude-plugins/fabrika/agents/reviewer.md
