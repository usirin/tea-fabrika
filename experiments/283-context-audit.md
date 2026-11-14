---
date: "2026-11-13"
summary: "Today's hand-run tooling; $0. The skill Markdown under `.agents/skills/` on `origin/main` at `f18bea901`: 2,928 lines, 186.5 KB. 578 lines (about 49 KB) can be cut with proof, 308 of them in the lead skill's 766. The biggest reason: the lead skill repeats what the headers of `drive.ts` (61 lines) and `chain.ts` (96 lines) already say, and the copy has drifted, since it never mentions the chain's host step. Next: duplicates (the adr template twice, the Mermaid rules in two skills, 13 review clauses in two files), then history, wrong homes and six stale spots. `skillscheck.sh` requires three of the duplicates, so 39 of those lines need the check changed first. About 205 lines are mechanical cuts today. Not counted, because the code still matches: signing prose owed out by 0161, landing prose owed out by 0162, and about 45 lines for a lane parked before 0066. The 11 skill descriptions are 2,932 characters in every session. The root `AGENTS.md` (722 lines) was left to 0129's own cut. No agent ran, so it cannot say whether shorter text works better."
---

# 283. How much of the text agents are made to read here can be cut, and where does each cut go?

Read on 2026-11-13, on `origin/main` at `f18bea901`. It covers today's hand-run tooling, which is
used for work in both versions. This is reading, not a measurement of agent behavior: nothing ran
but `wc`, `rg`, `git`, two read-only `gh pr view` calls and two small counting scripts. No model,
no key, **$0**. No script is kept: each count is one command, written beside its number. This page
was written on its branch from its first line
([0128](../.decisions/0128-a-write-up-is-born-in-the-repo.md)).

**The answer: 578 of the 2,928 lines of skill text can be cut with proof, which is about 49 KB of
186.5 KB. More than half of that is in one file, the lead skill.**

- **The lead skill is 766 lines and 62.2 KB, and 308 lines (about 31 KB) can go.** Most of it
  repeats what the scripts' own header comments already say.
- **The copy has already drifted from the code.** `chain.ts` runs a host step and takes a
  `## host` section in a lane brief (its header, lines 25 to 26 and 94 to 95). The lead skill never
  mentions either (`grep -n "host step\|## host" .agents/skills/lead/SKILL.md` finds nothing).
- **One check keeps three duplicates alive.** `skillscheck.sh` requires the same 13 review clauses
  in two files, the same three exam clauses in two files, and one sentence in five skills.
- **About 205 lines can be cut by hand today with no judgment.** The rest needs a person's read,
  because a fact must be checked against a script header before its prose goes.
- **The root `AGENTS.md` is not audited here.** It is 722 lines and 58.7 KB, another agent is
  cutting it under [0129](../.decisions/0129-agents-md-becomes-a-short-map.md), and this page only
  names it as the other home of a duplicate.

```text
what an agent reads today, in lines
  every agent          AGENTS.md 722 (not audited here)
  a Claude session     + 11 skill descriptions, 2,932 characters, loaded whether a skill fires or not
  a step agent         + its skill: plan 118, tests 128, build 69, review 105
                       + what drive.ts adds to the brief: about 15 lines
  the lead session     + lead 766, and pr 197, adr 243, guidelines 308 + 397 when it uses them
```

How sure: about 90% on the duplicates, which are two line ranges a reader can open side by side.
About 75% on the "repeats a script header" cuts: the header and the skill were compared by reading,
not line by line, so some skill sentences will turn out to hold a fact the header lacks.

## The yardsticks

Each finding below names the yardstick it comes from.

- **Y1.** The `claude-md-improver` skill of the public `claude-md-management` plugin: its six
  criteria, of which Conciseness (15 points) and Currency (15 points) bear on this audit, and its
  red flags "References to deleted files", "Duplicate info across multiple files" and
  "Verbose explanations".
- **Y2.** The `writing-for-agents` skill in the `kamp-us/phoenix` repo and its `SKILL-MECHANICS.md`:
  a single source of truth, a document that restates the environment is a cache, sediment, no-ops,
  one trigger per branch in a description, and steering by "never" as a failure mode. Phoenix's own
  `AGENTS.md` is 72 lines.
- **Y3.** This repo's decisions: 0129's three moves,
  [0130](../.decisions/0130-every-piece-of-knowledge-has-one-home.md) (one home per kind),
  [0115](../.decisions/0115-decided-rules-live-in-decision-files.md) (a decided rule lives in a
  decision file) and [0408](../.decisions/0408-skills-keep-only-judgment.md) (a skill keeps only
  reading, judgment and writing, and nothing leaves before its check has landed).

## The files

`wc -lc` on every `.md` under `.agents/skills/`. Each `.claude/skills/<name>` is a link to the same
folder, so there is one copy. "Provable cut" counts only lines with a second place or a check named
in the sections below.

| File under `.agents/skills/` | Lines | Bytes | Provable cut | Left | Biggest reason |
|---|---|---|---|---|---|
| `lead/SKILL.md` | 766 | 62,212 | 308 | 458 | repeats script headers |
| `guidelines/SKILL.md` | 308 | 21,069 | 72 | 236 | step 9 repeats its own reference file |
| `guidelines/references/deck-structure.md` | 300 | 17,203 | 26 | 274 | a dated measurement |
| `write-pattern/SKILL.md` | 256 | 12,065 | 0 | 256 | only its description is long |
| `adr/SKILL.md` | 243 | 9,018 | 57 | 186 | its template is printed twice |
| `mutation/SKILL.md` | 206 | 13,191 | 19 | 187 | history and code facts |
| `pr/SKILL.md` | 197 | 11,173 | 30 | 167 | a backlog and a reading kept in the skill |
| `tests/SKILL.md` | 128 | 8,991 | 7 | 121 | one pinned duplicate |
| `plan/SKILL.md` | 118 | 7,558 | 32 | 86 | describes `plancheck.sh`'s insides |
| `review/SKILL.md` | 105 | 6,986 | 0 | 105 | it is the home the duplicates point back to |
| `guidelines/references/guideline-page.md` | 97 | 4,206 | 0 | 97 | none |
| `README.md` | 70 | 4,475 | 17 | 53 | repeats four skills |
| `build/SKILL.md` | 69 | 3,993 | 6 | 63 | one pinned duplicate |
| `step-commit/SKILL.md` | 65 | 4,387 | 4 | 61 | history |
| Total | 2,928 | 186,527 | 578 | 2,350 | |

There is no `.mcp.json`, no `.claude/settings.json`, no `.claude/agents/` and no nested `AGENTS.md`
or `CLAUDE.md` on main. The root `CLAUDE.md` is one line that points at `AGENTS.md`.

## Held by code: the lead skill repeats the scripts

Y2 calls this a cache: a copy of a lookup that earns its place only when the lookup is expensive.
Here the lookup is the first lines of the script the lead is about to run. Y3 (0408, and 0129's
first move) says the prose goes once code holds it.

Header comment lines were counted with one `awk` pass over the top of each script.

| Lead skill lines | Bytes | What it holds | Where the same facts are | Cut |
|---|---|---|---|---|
| 235 to 258, the Scripts table | 9,032 | what each of 24 scripts does, in rows up to 1,700 characters | each script's header: `drive.ts` 61 lines, `chain.ts` 96, `sizecap.ts` 73, `mutbox.ts` 61, `lanes.ts` 48, `clauderow.ts` 45, `catchup.sh` 39, `gcloop.ts` 37, `land.ts` 37 | 0 lines, about 6,000 bytes: one short line a script |
| 265 to 359, "Use drive.ts for any step" | 8,258 | flags, start rules, checks, exit codes, refusals | `drive.ts` lines 1 to 61; its exit codes and refusals are at lines 47 to 61, nearly word for word the skill's lines 342 to 359 | 70 of 95 |
| 361 to 487, "Run a whole lane with chain.ts" | 10,892 | the moves, retries, limits, the budget, the record, the pin | `chain.ts` lines 1 to 96 | 82 of 127 |
| 613 to 621, in step 9 | about 800 | which diffs `loosening.sh` counts as a hit | `loosening.sh` and `loosening.test.ts` | 9 |
| 644 to 659, in step 9 | about 1,500 | what is removed and kept after a merge | `catchup.sh` does it itself (`refs/keep/pr` in the script, `catchup.cleanup.test.ts`, `box/Remove.ts` lines 262 to 340) | 16 |
| 741 to 749, the leak check | about 700 | fail closed, respaced lines, each commit read alone | `leakgrep.sh`, `leakgrep.respaced.test.ts`, `leakgrep.commits.test.ts`, and `--commits` in `botpush.mjs` | 9 |

What stays in those sections is what the lead does and decides: the two commands, how a lane brief
is laid out, the lockfile ask (lines 326 to 333), what to answer at a budget stop, and how to watch
a lane.

The same kind of copy sits in two smaller skills:

- **`plan/SKILL.md` lines 90 to 111** (1,869 bytes) describe how `plancheck.sh` splits words, reads
  possessives and treats version markers. The plan writer is read-only and never runs that check;
  line 111 says the lead does. Cut 20 lines; `plancheck.sh` has a 17-line header.
- **`mutation/SKILL.md` lines 157 to 163** give the numbers in `heartbeat.ts` and `limit.ts`. Cut 7.
- **The three "in a box, commit nothing" sentences** (`build/SKILL.md` 32 to 33, `tests/SKILL.md`
  88 to 89, `mutation/SKILL.md` 47 to 48) repeat what `drive.ts` adds to every boxed step's prompt
  (`agentTail`, `drive.ts` line 1516). They are not counted in the cut: an agent outside a box
  still needs the first half of each sentence.

## Duplicates

Y1's red flag "Duplicate info across multiple files", and Y2's single source of truth.

| What is said | Where, every place | Cut |
|---|---|---|
| The decision file template and its three notes | `adr/SKILL.md` 39 to 68, and again at 72 to 102 | 30 lines; keep the second |
| The Mermaid rules, the diagram-type table, what breaks on GitHub | `adr/SKILL.md` 178 to 204 and `write-pattern/SKILL.md` 203 to 233, near word for word; rule one is also in decision 0005, lines 62 to 63 | 27 lines; one shared reference file both skills point at |
| The 13 review clauses ("Sweep, do not sample" to "End with exactly one answer: line") | `review/SKILL.md` 25 to 34 and 66 to 78, and `lead/SKILL.md` 76 to 98 | 23 lines in the lead skill; the brief's first line already says "Use the review skill" |
| What a recheck is | `review/SKILL.md` 93 to 100 and the recheck message in `lead/SKILL.md` 167 to 173 | 7 lines |
| "Something wrong that your task does not cover is one finding row" with its three-line pointer | `lead` 684 to 688, `build` 42 to 45, `tests` 97 to 100, `plan` 69 to 72, `mutation` 189 to 192, `README.md` 36 to 41, and the root `AGENTS.md` table, which every step reads first | 4 lines in each of four step skills |
| The prototype and walk-page rules | `guidelines/SKILL.md` 207 to 253 and `references/deck-structure.md` 82 to 101 and 150 to 242; line 205 of the skill already says to follow that file | 46 lines |
| The six fields of a principle | `guidelines/SKILL.md` 168 to 175 and `references/guideline-page.md` 26 to 35 and 89 to 97 | 8 lines |
| Who runs which step, one fresh agent a step, containers for ports | `lead/SKILL.md` 196 to 229 and the root `AGENTS.md` bullets "One fresh agent per step" and "A step that needs ports", with decisions 0045, 0064 and 0177 | 22 of 34 lines: one line and a link each (0129's second move) |
| Lead tooling is fast-tracked | `lead/SKILL.md` 703 to 708 and the root `AGENTS.md`, word for word | 5 lines |
| Decisions land at once | `lead/SKILL.md` 712 to 727, the root `AGENTS.md` rule of thumb, and `adr/SKILL.md` 8 to 10 and 173 to 175 | 14 lines |
| Where code goes in `next/` | `plan/SKILL.md` 113 to 118 and the root `AGENTS.md`, word for word | 6 lines |
| A plan comes back unsigned and only the lead session approves | `plan/SKILL.md` 8 to 10, 87 and 111, `lead/SKILL.md` 54 and 550 to 556, `README.md` 43 to 46 | 5 lines |
| The host-only law rule | `lead/SKILL.md` 569 to 572 and again at 587 to 593, `build/SKILL.md` 57 to 63, `plan/SKILL.md` 43 to 46, the root `AGENTS.md` and decision 0178 | 4 lines in the lead skill |
| Linear as the builder, fewer boxes, the five layouts | `guidelines/SKILL.md` 74 to 80, 105 to 106 and 107 to 110, and the root `AGENTS.md`, "Changing the product" | 11 lines |
| The `gh stack` commands | `lead/SKILL.md` 53, 561 to 565 and 633 to 643, and `README.md` 56 to 59 | 2 lines, with the README lines below |
| The step skills, summed up again | `README.md` 43 to 59 restates the plan, step-commit, review and lead skills | 17 lines |

Smaller ones, counted in the lead skill's 308: lines 8 to 13 (4), 35 to 37 with 262 (2, the
"never print settings" rule is in four places), 43 to 44 (2, `scripts/typecheck.sh` lines 4 to 8
hold it), 57 to 58 (2, also `plan/SKILL.md` 92 to 93), 671 to 673 (3) and 751 to 753 (2).

**The check that keeps three of these alive.** `skillscheck.sh` runs in `pnpm lint`. Its `rules`
table requires the `review` and `answer` clauses under `review/SKILL.md`'s steps and again under
the lead skill's "Review brief template" heading. It requires the `exam` clauses in the lead skill's
"Land it" step and in the root `AGENTS.md`. Its clause `K21` requires the finding-row sentence in
plan, tests, build, mutation and lead. So 23 + 16 lines of the cuts above fail lint until that
table names one home a clause. The check is an exam path, so that change is not mechanical.

## History and narration

0129 and 0130 say a rule keeps its one line and the story goes to its decision or field note. Y2
calls it sediment.

- **`lead/SKILL.md`:** 221 to 222 (what the rule said before, and an 11-hour driver), 363 to 364
  (how lanes used to be driven), 379 to 391 (two "Measured on" paragraphs, 13 lines), 450 to 452
  (a proof run), 535 to 540 (one rule suite's story, 6 lines). 26 lines, of which 20 sit inside
  sections already cut above.
- **`mutation/SKILL.md` 74 to 81:** ticket 520's proof and ticket 457's story. 8 lines.
- **`step-commit/SKILL.md` 18 to 22:** why one command, with a count from 2026-11-08. It already
  links the note and the field row that keep it. 4 lines.
- **`tests/SKILL.md` 80 to 82:** where four rules came from. 3 lines.
- **`build/SKILL.md` 59 to 60:** what one run did on 2026-11-13. 2 lines; 0178 keeps it.
- **`guidelines/SKILL.md` 17 to 22:** which past pull requests are the models, and which one
  drifted. 5 of 6 lines.
- **`references/deck-structure.md` 42 to 67:** "Why it looks like this", a measurement from
  2026-11-02 with a six-row table. By 0130 a measurement is an experiment write-up. 26 lines.
- **Tags.** The lead skill carries 12 "(owner, date)" tags, 13 ticket numbers and 20 dates
  (`grep -o` on each pattern). No other skill has more than two owner tags.

## Wrong home

- **`lead/SKILL.md` 489 to 512, "Box cleanup on a timer":** installing and removing a launchd unit
  is done once per laptop. By 0130 it is a how-to under `docs/how-to/`. The lead keeps three lines:
  read `gcloop.ts status`, and what `LATE` means. Cut 21.
- **`pr/SKILL.md` 182 to 197, "Could become a check":** seven tooling tasks. Each restates a rule
  from higher in the same file (line 187 and lines 93 to 95, 190 and 87, 191 and 148 to 152). A
  task list's home is the tracker. Cut 16.
- **`pr/SKILL.md` 167 to 180, "The known way":** how two other projects write descriptions, and
  how this skill maps to them. It is a reading, so by 0130 it is an experiment or the Context of a
  decision. An agent writing a description does nothing with it. Cut 14.
- **`mutation/SKILL.md`** holds two jobs with two readers: the hourly run in CI (lines 124 to 185)
  and a lane's own mutation step (lines 30 to 122). No lines are counted for this.
- **`references/deck-structure.md` 253 to 295** is a 43-line script inside prose. Not counted: it
  needs a person's read.

## Stale

Y1's Currency criterion. Each was checked by looking.

- **`README.md` line 13** says the mutation skill is "a fixed StrykerJS sample on the build's
  files, then laws for real survivors". The mutation skill's own line 8 says mutation is no step
  of a pull request (0066).
- **`lead/SKILL.md` lines 314 to 315 and 632** say a commits check is left to CI and that catch-up
  waits for it. `.github/workflows/` holds only `check.yaml` and `mutation.yaml`, and 0161 records
  that the `commits` workflow came out in pull request 1134.
- **`lead/SKILL.md` line 537** links a rule suite at the repo's old address.
- **`guidelines/SKILL.md` line 103** calls program guidelines "PR 332, proposed". Pull request 332
  is merged.
- **`guidelines/SKILL.md` lines 183 to 184** say to add a `docs/guidelines/` row to the root
  `AGENTS.md` table if it is missing. The row is there.
- **The lead skill misses the host step,** as the answer says.

Three bigger blocks are stale by decision but still match the code, so they are **not** in the
578:

- **Signing.** [0161](../.decisions/0161-no-step-signing-by-hand.md) and
  [0164](../.decisions/0164-the-bot-stays-without-signing.md) say no step signs a commit, and that
  the lead, step-commit, tests and build skills lose that prose in the pull requests that make the
  scripts plain. Until then the tooling still signs. `grep -ci sign` finds 42 lines in the lead
  skill and 18 in step-commit, whose 65 lines are mostly about signing.
- **Landing.** [0162](../.decisions/0162-no-friction-before-a-merge.md) retires `catchup.sh` as the
  way to merge. Pull request 1136 does it and is an open draft. It changes the lead skill by 53
  lines added and 38 removed, so the skill grows by 15.
- **A lane parked inside a mutation step from before 0066.** About 45 lines serve it:
  `lead/SKILL.md` 209 to 211, 285 to 300, 393 to 395, 422 to 423, 442 to 443 and 467 to 469,
  `mutation/SKILL.md` 18 to 19, and `review/SKILL.md` 63 to 65. Whether such a lane still exists
  is a question for the owner.

## Too long for its job

Y2: a description is loaded in every session, so it gets one trigger per branch and no identity
the body already carries.

| Skill | Description, characters | What makes it long |
|---|---|---|
| `write-pattern` | 423 | four trigger phrases for two branches, then two "not for" clauses |
| `pr` | 376 | three places a description is written, then three quoted asks |
| `mutation` | 322 | the decision number and the parked-lane case |
| `lead` | 286 | the steps listed twice |
| the other seven | 192 to 250 each | six of them name the repo, which the body already says |

- **All eleven come to 2,932 characters.** Cutting each to about 150 saves about 1,300.
- **Six step skills fire only when a brief names them:** plan, tests, build, review, mutation and
  step-commit each say "Use when a brief says". `SKILL-MECHANICS.md` (Y2) says a skill that never
  fires by itself can drop its description from every session with `disable-model-invocation`.
  That is about 1,400 characters. It needs a person's read, since a brief would then have to name
  the file, as `drive.ts` already does.
- **In the session that did this audit,** the tool listed three of the eleven (plan, pr and
  write-pattern) by name only, with no description. The cause was not proven. It is what a listing
  past its size limit would look like, and a skill with no description cannot be picked by itself.
- **"Never."** `grep -oi '\bnever\b'` finds 55 in the lead skill, 14 each in guidelines and
  mutation, and 10 each in pr and tests. Y2 names steering by "never" as a failure mode. No lines
  are counted for this.

## Scores

Y1's two criteria that this audit can judge, each out of 15. The other four (commands,
architecture, patterns, actionability) were not scored. These are one reader's scores.

| Skill | Conciseness | Currency | Why |
|---|---|---|---|
| lead | 5 | 5 | 40% provably cuttable; four stale spots and a missing step |
| guidelines | 10 | 10 | step 9 twice; two stale lines |
| mutation | 10 | 10 | code facts and history; README row behind it |
| adr | 10 | 15 | the template twice |
| pr | 10 | 15 | 30 lines that are not for the writer |
| plan | 10 | 15 | 22 lines on a check it never runs |
| step-commit | 15 | 10 | short; signing is owed out by 0161 |
| write-pattern, tests, build, review | 15 | 15 | dense; the duplicates in them are pinned by lint |

## What a script adds to a brief

`drive.ts` and `chain.ts` build these, and they are small: the skill line and the commit rule
(`agentTail`, `drive.ts` line 1516), the owned-paths head (`ownedHead`, line 1573, about 5 lines),
the answer format (`tailFor`, line 1790, 9 lines), and the judgment prompt (`JUDGE_TAIL` in `chain.ts`, about 22 lines).
No cut is proposed. One line is worth a look: every review brief ends with "This lane has no
mutation report drive can read" (`mutationTail`, line 1605), a sentence about a step no lane runs since 0066.

`programs/pipeline/briefs/` holds seven briefs for today's paused pipeline programs, 539 lines and
22,901 bytes. No agent reads them while the programs are paused, so they are not in any total.

## The ranked cut list

Lines saved, the move, and the risk in one line. "Mechanical" means a person or a small agent can
do it from the line numbers alone.

1. **`lead/SKILL.md`, 82 lines, the chain section becomes a pointer to `chain.ts`'s header.** Code
   holds it. Needs a read: check each sentence against the header first, and add the host step.
2. **`lead/SKILL.md`, 70 lines, the drive section becomes a pointer to `drive.ts`'s header.** Code
   holds it. Needs a read, same reason; keep the lockfile ask.
3. **`guidelines/SKILL.md`, 46 lines, step 9 keeps its pointer to `deck-structure.md`.**
   Duplicate. Needs a light read: three sentences in the skill are not in the reference.
4. **`lead/SKILL.md`, 0 lines but about 6,000 bytes, the Scripts table gets one short line a
   script.** Code holds it. Needs a read.
5. **`adr/SKILL.md`, 30 lines, delete the first copy of the template (39 to 68).** Duplicate.
   Mechanical, no risk: the second copy is whole.
6. **`pr/SKILL.md`, 30 lines, "Could become a check" becomes a tracker ticket and "The known way"
   moves to the decision or an experiment.** Wrong home. Mechanical once the ticket is filed.
7. **`adr/SKILL.md` and `write-pattern/SKILL.md`, 27 lines, one shared diagram reference.**
   Duplicate. Mechanical; the two copies differ in four small phrases, so keep the longer.
8. **`deck-structure.md`, 26 lines, "Why it looks like this" becomes an experiment write-up.**
   History. Mechanical.
9. **`lead/SKILL.md`, 25 lines, step 9 loses what `loosening.sh` and `catchup.sh` do
   themselves.** Code holds it. Not mechanical: five clauses are pinned by `skillscheck.sh`, and
   pull request 1136 rewrites the same lines.
10. **`lead/SKILL.md`, 23 lines, the review brief template stops repeating the review skill.**
    Duplicate. Not mechanical: `skillscheck.sh` must change first, and that is an exam path.
11. **`lead/SKILL.md`, 22 lines, "Who runs which step" becomes one line and a link each.**
    0129's second move. Needs a read.
12. **`lead/SKILL.md`, 21 lines, the launchd install moves to `docs/how-to/`.** Wrong home.
    Mechanical.
13. **`plan/SKILL.md`, 20 lines, the Scripts section keeps its two pinned sentences.** Code holds
    it. Mechanical: lines 87 and 88 are the pinned ones and stay.
14. **History, 28 lines: 6 in `lead/SKILL.md` (535 to 540) and 22 across five other files.**
    Mechanical: each has a decision, note or field row that keeps it. The lead skill's other 20
    history lines go with items 1 and 11.
15. **`README.md`, 17 lines, and the stale mutation row.** Duplicate and stale. Mechanical.
16. **The finding-row pointer, 16 lines in four step skills.** Duplicate. Not mechanical: `K21`.
17. **The six stale spots.** Mechanical, about 8 lines changed.
18. **The descriptions, about 1,300 characters.** Too long. Needs a read: a description decides
    when a skill fires.

Mechanical today, with no check to change: items 5, 6, 7, 8, 12, 13, 14, 15 and 17, about 205
lines. Everything else needs a person's read, and items 9, 10 and
16 need the owner, since they change an exam path.

## What a reader should ask

Rules that look wrong, not judged here:

- `lead/SKILL.md` lines 27 to 29 say a brief does not repeat "Finish your task". The fix-round
  brief in the same file, lines 147 to 154, repeats it and the laptop caps.
- `tests/SKILL.md` line 120 and `mutation/SKILL.md` line 205 sit under a "Never" heading but are
  written as things to do, so each reads as its opposite.
- `lead/SKILL.md` lines 622 to 623 ask for a false-alarm count "before this new check blocks
  anything". Nothing in the skill says whether that count was taken.

## What this cannot tell us

- **Whether shorter text makes agents work better.** Nothing here ran an agent. 0129 asks for one
  test of long against short before the root file is cut, and the same test would settle this.
- **Which skill sentences hold a fact no script header has.** The header cuts were compared by
  reading. The host step shows the copy drifts; it does not show the header is complete.
- **Tokens.** Every size is lines, bytes or characters. No tokenizer ran.
- **The tracker.** Its tool did not connect in this session, so no ticket number in a skill was
  checked, and nobody looked for a lane still parked in a mutation step.
- **The root `AGENTS.md`.** Each "also in `AGENTS.md`" above is true of main at `f18bea901`. The
  cut under 0129 may move those lines, and then the skill copy may be the one to keep.
- **Why three descriptions were missing from the listing.** It was seen once, in one session.
- **Whether a duplicate was put there on purpose.** A brief that repeats a rule may be doing a job
  for an agent that reads no skill. The lead skill's line 690 says so for one sentence.
