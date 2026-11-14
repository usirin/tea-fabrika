---
date: "2026-11-11"
scripts: "none; reading, nothing ran"
summary: "Both versions' notes under `docs/direction/`, at `259704b1f`. Of 148 notes, 135 are decided or decided in part; 76 are linked by no decision and 9 only in passing, so 85 notes and 798 rules are in scope (1 already a decision, about 29 partly covered, about 11 repeated). 28 batches, everyday `next/` design rules first and today's UI rules last, in seven groups of decision files (group 3, 0320 to 0339, merged; the rest being written). 140 drift flags (104 stale, 29 contradictions, 7 status mismatches); most are settled by a later decision such as 0081, 0066, 0099 or 0080, and about 20 items need the owner's read. The ticket's count of 133 and 73 was wrong. Agent time only, $0; tokens not recorded."
---

# 271. Which decided rules in the direction notes have no decision file, and in what order should they move?

Read on 2026-11-11. **This is reading, not a measurement.** Seven agents read every note under
`docs/direction/` at commit `259704b1f` and listed each decided rule with its date, its version and
any clash; nothing ran and nothing in the repo changed. It is the inventory behind
[0115](../.decisions/0115-decided-rules-live-in-decision-files.md) and the first half of tracker
ticket 767. It is about the notes, which speak for both versions: each rule below says whether it is
about `next/` or today's version, where the note says so.

**The answer: 85 notes hold 798 decided rules that no decision file states, and they move in 28
batches, everyday `next/` design rules first and today's UI rules last.** Of 148 notes, 135 are
decided or decided in part. 76 of those are linked by no decision file, and 9 more are linked only in
passing, so 85 are in scope. Of the 798 rules, 1 is already a decision (0081's `to`), about 29 are
partly covered, and about 11 repeat across two notes, so the move makes about 760 to 770 rules, which
merge into far fewer files. The read also found 140 drift flags inside the notes (104 stale, 29
contradictions, 7 status mismatches) and about 23 clashes. Most are settled by a later decision.
About 20 items need the owner's read; they are listed in full below.

```text
148 notes                 (no README, no follows/)
 ├─ 13 not decided        → no file
 └─ 135 decided or partly (99 decided, 36 in part)
     ├─ 59 linked by a decision      → a second pass, not done here
     ├─  9 linked only in passing    → in scope
     └─ 76 linked by no decision     → in scope
                                       = 85 notes, 798 rules, 28 batches, 7 groups of decision files
```

## How it was read

- **The class of each note** comes from its own status paragraph, read against its row in
  `docs/direction/README.md`. Where the two disagree, it is a MISMATCH flag (below).
- **Linked** means some `.decisions/` file contains `direction/<note>`. A link that sits outside the
  decision's Context and states none of the note's rules was checked by hand and counted as "in
  passing".
- **The rules** were read by seven agents, one per subject: data shape, names, storage and Effect
  basics; security, sync, the cloud ledger and hot reload; programs, inputs, the desktop and modes;
  the tracker, the plan and agent hours; pipeline steps, review, agents and boxes; the design system;
  window and tile UI. Each read the notes at `259704b1f`, checked each rule against the decision
  titles and an `rg` of `.decisions/` for its key words, and wrote one line per rule:
  `"<proposed title>", <date decided>, #<anchor>, <new | existing NNNN | partly NNNN>`.
- **A lean** counts as a rule only where the note's status says the owner approved its leans, and
  then with its confidence in brackets. "Skipped" lines name what was left out: proposed text, an
  unapproved lean, or an open item.
- **Flags** come from the readers and from spot checks, each with a line number. Nothing was fixed.
  Where a later decision exists, it wins. Where two notes clash, the later dated, still-decided text
  wins unless an amend or supersede line says otherwise.
- Anchors were worked out from heading text by hand.

Line numbers below are the notes' lines at `259704b1f`. On main at `a0a94519e` five notes have
changed since: `recovery-key.md` (14 lines added), `agents-behind-one-service.md` (4),
`secrets-are-redacted.md` and `a-key-per-client-and-no-github-trust.md` (3 each),
`north-star-first-harden-later.md` (2), each a link line or block under its status, and the
README gained 2 rows. Lines after those points sit a few lower now. The other notes in scope have not
changed. Two new notes landed after the read (`lane-queue-or-scheduled-job.md` and
`effect-code-guidelines.md`), so main now has 150 notes; neither is counted here.

## The counts

| Count | Value |
|---|---|
| Notes (no README, no `follows/`) | 148 |
| Decided in full / in part / either | 99 / 36 / 135 |
| Not decided, so no file | 13 |
| Decided or in part, linked by no decision | 76 (57 decided, 19 in part) |
| Linked only in passing, so in scope too | 9 |
| In scope | 85 notes, 798 rules |
| Already a decision / partly covered / repeated across two notes | 1 / about 29 / about 11 |
| New rules to write | about 760 to 770 |
| Decided notes linked by a decision, not checked rule by rule | 59 |

**Wrong:** the ticket's own counts. It said 133 decided or partly decided notes and 73 of them
unlinked; the read found 135 and 76.

The 13 not decided: `a-canvas-per-work`, `a-review-list-can-only-shrink`, `agents-are-programs`,
`an-agent-run-keeps-its-content`, `an-input-can-take-anything`, `code-commits-and-signs-each-step`,
`errors-are-diagnostics`, `every-wait-is-a-queue`, `experiments-behind-a-service`,
`fabsh-grows-into-a-language`, `pipeline-strategies`, `the-checker-is-a-tea-package`,
`windows-in-next`.

The 9 linked only in passing, with the decision that links each: `a-job-record-holds-its-trace`
(0038), `a-yes-binds-to-the-diff` (0071), `agents-behind-one-service` (0026),
`design-for-bounded-objects` (0020, 0038), `hot-reload` (0080), `react-compiler` (0080),
`recovery-key` (0080), `secrets-are-redacted` (0024, 0069), `the-ledger-goes-to-cloudflare` (0051).

The 36 decided in part: `a-job-record-holds-its-trace`, `a-local-first-sync-engine`,
`a-ticket-runs-from-the-app`, `a-ticket-says-where-it-came-from`, `a-yes-binds-to-the-diff`,
`agents-commit-as-a-bot`, `autonomy-is-measured-trust`, `codex-box-home-listing`, `customization`,
`data-first-markdown-is-a-view`, `design-language`, `every-finding-is-rated`,
`helpers-and-the-supervisor`, `inputs-carry-their-sender`, `ledger-behind-a-service`,
`nobody-writes-their-own-exam`, `one-ask-and-one-meter`, `one-parent-stages-as-slots`,
`packs-are-programs`, `principles`, `recovery-key`, `scheduled-jobs-on-the-host`,
`services-and-our-own-ci`, `shared-tiles`, `summon-guidelines`, `talk-where-you-work`,
`tea-program`, `the-cloud-is-one-more-host`, `the-frame`, `the-host-keeps-terminals-and-jobs`,
`the-ledger-goes-to-cloudflare`, `the-ticket-is-the-lane-view`, `the-tracker-is-like-linear`,
`tracker-views-are-programs`, `ui-on-manti`, `use-the-industrys-names`.

## The order of the batches, and why

The batches go by how often an agent trips on a rule in everyday design calls in `next/`: data shape
and bounded objects, then ids and names, the plan and tiers, storage, code rules, programs and their
inputs, the desk's layers, sync, and the security walls. Batches 1 to 11 are what a plan or a builder
in `next/` meets every day. The tracker comes next (12 to 14), because Tier 2 is the tracker and its
notes are the next to be built. Then the pipeline steps (15 to 18), which today's hand-run steps
already read through skills. Today's-version-only runtime (19 and 20) comes after that. Last are the
UI notes (21 to 28), most of them today's version, read by UI work only. Each batch is 21 to 34
rules: one agent's writing and one docs pull request, split at a note boundary if it runs long.

0115 then grouped the batches into seven docs pull requests, one per subject, with the numbers 0200
to 0539 reserved for them. **Every group is merged or being written into decision files, so this
write-up gives each batch's rules as counts; the decision files are their record.** The per-rule
lists stay out of this file for that reason.

| Batch | Notes | Rules | Group, and its state on 2026-11-11 |
|---|---|---|---|
| 1. Bounded objects, job records, data first | `design-for-bounded-objects`, `a-job-record-holds-its-trace`, `data-first-markdown-is-a-view` | 29 (1 repeated) | Group 1, 0200 to 0234: written, not on main yet |
| 2. Ids, names and data classes | `one-id-per-thing`, `one-meaning-one-way`, `schema-classes-not-of-helpers`, `smallest-ledger-proof-to-grow` | 24 (1 partly) | Group 1 |
| 3. The plan, the tiers and the clean slate | `clean-slate`, `a-project-is-a-parent-plan`, `free-form-plan-to-planner`, `built-for-projects`, `demlik-is-the-first-real-repo` | 31 (3 partly) | Group 1 |
| 4. Saved state and the ledger service | `saved-state`, `ledger-behind-a-service`, `make-the-mistake-impossible` | 24 | Group 1 |
| 5. Effect and tea basics | `build-on-effect`, `effect-fn-for-traced-functions`, `init-runs-once-per-process`, `tea-is-the-engine`, `pin-exact-versions` | 26 (1 partly, 1 repeated) | Group 2, 0250 to 0295: being written |
| 6. Programs and their inputs | `program-make`, `program-shape`, `inputs-carry-their-sender` | 32 | Group 2 |
| 7. Layers and modes: who owns a key | `layers`, `modes` | 33 | Group 2 |
| 8. The desktop layer | `the-desktop-layer`, `an-old-host-is-named-then-restarted` | 28 | Group 2 |
| 9. The cloud ledger and hot reload | `the-ledger-goes-to-cloudflare`, `hot-reload` | 30 (1 partly, 10 marked "both?") | Group 2 |
| 10. Security walls: secrets, keys, logins | `secrets-are-redacted`, `a-key-per-client-and-no-github-trust`, `north-star-first-harden-later`, `agents-behind-one-service` | 30 (6 partly) | Group 3, 0320 to 0339: **merged**, [PR 960](https://github.com/usirin/tea-fabrika/pull/960) |
| 11. The recovery key | `recovery-key` | 24 | Group 3, merged |
| 12. The tracker and the ticket | `tickets-start-in-our-tracker`, `the-tracker-is-like-linear`, `the-ticket-is-the-lane-view`, `a-ticket-says-where-it-came-from`, `we-use-the-tools-we-build` | 30 (1 partly, 5 repeated) | Group 4, from 0340: being written |
| 13. Tracker views and areas | `tracker-views-are-programs`, `areas` | 32 (1 partly) | Group 4 |
| 14. Labels and triage | `label-guidelines`, `sort-answers-yes-or-no`, `triage-asks-when-worth-is-unclear` | 31 (1 partly, 1 repeated) | Group 4 |
| 15. The plan and test steps, and agent hours | `the-plan-stage`, `the-test-writer`, `agent-hours` | 33 (2 partly) | Groups 5 to 7: being written |
| 16. Review, push and approval | `push-after-review`, `nobody-grades-their-own-work`, `a-yes-binds-to-the-diff`, `outcome-names`, `read-fresh-run-alone` | 30 (4 partly) | Groups 5 to 7 |
| 17. Agents, boxes and skills | `agents-read-rules-the-normal-way`, `agents-commit-as-a-bot`, `codex-box-home-listing`, `skills-hold-only-judgment`, `jev-same-answer-cheaper` | 34 (3 partly) | Groups 5 to 7 |
| 18. Step structure and scheduled jobs | `ask-for-decisions-not-facts`, `one-parent-stages-as-slots`, `helpers-and-the-supervisor`, `reuse-before-special-rules`, `scheduled-jobs-on-the-host` | 25 (4 partly) | Groups 5 to 7 |
| 19. tsh and tea-program (today's version) | `tsh-a-shell-for-tea-programs`, `tea-program` | 22 | Groups 5 to 7 |
| 20. The Electron app and the host (today's version) | `the-gui-is-electron-first`, `the-host-keeps-terminals-and-jobs` | 25 | Groups 5 to 7 |
| 21. Design language, design package, typography | `design-language`, `fabrika-design-package`, `typography` | 31 | Group 7, from 0450: being written |
| 22. Manti, the React compiler, Claude Design | `ui-on-manti`, `react-compiler`, `design-on-claude-design` | 28 | Groups 5 to 7 |
| 23. UI verification and pipe colors | `ui-verification`, `pipe-colors` | 21 (1 partly) | Groups 5 to 7 |
| 24. The ask desk and the inbox glance | `ask-desk`, `customization` | 26 | Groups 5 to 7 |
| 25. The frame, the icon and the top bar | `the-frame`, `app-icon`, `top-bar-name` | 31 | Groups 5 to 7 |
| 26. Tiles and the keys editor | `tile-guidelines`, `keys-editor` | 30 | Groups 5 to 7 |
| 27. Fold and popovers | `fold-not-tabs`, `popovers` | 26 | Groups 5 to 7 |
| 28. Picker and shared tiles | `picker-guidelines`, `shared-tiles` | 32 | Groups 5 to 7 |
| Total | 85 | 798 | |

Groups 5 and 6 started on the same day and group 7 holds batch 21's notes; which of batches 15 to 28
each of the three takes was not checked. The one rule that is already a decision is in batch 16
(`outcome-names`): in `next/` and `.agents/` the ask's `who` key is `to`, held by
[0081](../.decisions/0081-no-question-word-names.md).

## Needs the owner's read

These are every item the read marked as open, owner read, a lean to confirm, or unsure whether it was
decided. None should become a decision file until it is answered. An item settled by a later
decision is in the next section instead.

1. **`smallest-ledger-proof-to-grow`'s "nothing is added without proof" against record wide.** Its
   line 18, and lines 23-24 ("the proof rule is for fields, which are cheap to add"), against
   AGENTS.md's record wide (owner, 2026-11-01: a field added later never reaches the entries written
   before it). Record wide wins for facts lost at write time; the proof rule may still hold for
   board-style fields (priority, labels). One line on the scope is needed.
2. **`north-star-first-harden-later`'s order of work** (lines 14-18: experiments, then fabrika, then
   Tuval, then a hardening pass) against [0068](../.decisions/0068-tiers-carry-every-part.md) (each
   tier carries a working slice of every core idea, later tiers harden it). 0068 is later, but the
   read was under 80% sure the owner sees a clash: tiers could be the "finish fabrika" step. The
   order was not recorded as a rule.
3. **`the-gui-is-electron-first` against `the-host-keeps-terminals-and-jobs`, both today's version.**
   The GUI note says "the desk is a program on the host ... the page holds none of it" (lines
   509-510); host-keeps says "the layout is the app's ... the host knows no layout" (lines 64-66).
   host-keeps is later (2026-10-28), but the GUI note's build says "the desk runs in the host" (line
   600), and the desktop layer (2026-10-31, `next/`) moves the layout into the brain.
4. **`read-fresh-run-alone`'s `behind` rule for a repo with no merge queue.** Lines 54-57 end a head
   `behind` when main moved; `ship-stage-rules` lines 19-21 and 27-28 say a branch behind main ships
   as it is, and [0097](../.decisions/0097-a-green-pull-request-lands-without-catching-up.md) settles
   it for this repo's own merges. For the product on a repo with no merge queue, it is open.
5. **`areas` against `label-guidelines` for `next/`.** Areas line 382 says "an area is not a label in
   a group"; label-guidelines call 1 (2026-11-06, line 256) makes Area the first label group, and
   label-guidelines wins for `next/`. Still open: labels archive (label-guidelines line 100) while
   areas delete (areas call 2, 2026-11-07, applied to today's areas only by label-guidelines lines
   102-104), so nothing says which the `next/` Area group takes.
6. **The ask desk's way back against the tile focus heir.** ask-desk's `Esc` returns focus to the
   tile it was opened from (line 192); tile-guidelines sends it to the next open tile in reading order
   (lines 656-658). The note says "one of the two must give" and picks neither; both are decided
   (2026-11-02 at 60%, and 2026-11-01).
7. **Triage's two word sets.** `triage-asks-when-worth-is-unclear` uses close, keep and ask (lines
   8-11); `sort-answers-yes-or-no` uses duplicate, decline, accept and escalate, the owner's picks of
   2026-10-24 (lines 50-55). Same step; sort-answers' words should win, but one set must be picked
   when the file is written.
8. **`hot-reload`'s H4 rollback against P34's crash and restart.** H4 says a step that throws sends
   the process back to the code before (line 124); lines 133-137 call the order open, and 0016's
   amendment (line 138) makes the restart immediate and leaves H4 open. The rollback was left out of
   the rules.
9. **`the-test-writer`'s mutant answers.** Lines 48-75 and 100 have the test writer answer each
   surviving mutant (`send:test_writer:mutant_survived`). Under
   [0066](../.decisions/0066-mutation-runs-on-a-schedule.md) no pull request has a mutation step, and
   0077 sends a repeated gap to the tests step as a ticket. 0066 leaves the `next/` mutation queue
   program (Tier 6) undecided. Should the rule stand for the product, or go?
10. **`codex-box-home-listing`'s status.** Lines 3-7 call the same built code both "decided, in
    pieces" and "proposed", with no owner mark. Does the note settle anything, or is it a proposed
    record of built code?
11. **Typography's T6 against the top bar's mono.** top-bar-name lines 34-35 keep the bar's other
    words mono; typography T6 (2026-11-02, line 227, later) says mono marks what a person types, and
    the top bar's words are not typed. The read was unsure; it needs a person's read.
12. **Whether `ui-on-manti` governs `next/`.** Its status says today's version (line 8), but
    design-on-claude-design lines 47-48 say both versions draw on one design system, and
    typography's text styles go on Manti's `Text` in `next/` too (lines 97-98).
13. **Customization's slot count.** Its status decides the glance in "the top bar's one slot" (line
    4), but C1 says the slot count was not walked (line 52). The rule was worded "the top bar's slot"
    with no count.
14. **`agents-commit-as-a-bot`'s "step proofs go in git notes"** (line 46) sits in the decided list
    with no mark or date, so it was left out.
15. **`tsh-a-shell-for-tea-programs`, today's version: "agents get tsh instead of bash"** (line 23)
    against 0026 (a step runs the unmodified harness, with its own shell, files and tests). Swapping
    the shell is not patching the harness, so this is a question, not a proven clash.
16. **`modes`' M2 `send`.** M2's `send` is "a Msg for the tile's machine" (line 129). Under
    program-shape a program's Msg is built from its inputs, so `send` should be one of the program's
    inputs. Probably fine; worth a line when the file is written.
17. **`one-parent-stages-as-slots`:** whether "the idea is decided" covers the slot and swap
    bullets, or only "one parent, with the steps as its children".
18. **Skipped leans and sections that may have been decided:**
    `design-for-bounded-objects`' "one R2 bucket per kind of data" (lines 48-49, a lean under 80% for
    the owner to confirm, not one of the four approved leans); `a-job-record-holds-its-trace`'s
    2026-11-02 "ticket's view" section (tokens never dollars per step, "no list price" never $0.00,
    color by state), not in the status line's decided pieces; `effect-fn-for-traced-functions`'
    `ledger.call` lean ("a lean, owner to check", line 94, 50%).
19. **Leans counted or not.** In guideline notes whose status says the owner approved the leans, those
    leans were counted as rules. keys-editor's E3, E6 and E7 and ui-verification's C1 to C6 were left
    out, because the approval does not name them. The owner may disagree.
20. **`the-ledger-goes-to-cloudflare`'s scope.** The note never says which pieces hold for `next/`;
    10 of its rules are marked "both?" (the inventory's own summary said 8): two people sharing one
    fabrika as a core goal, no central users database, access from an invitation, many Durable
    Objects from the start, one Worker per project, one server read by every client, riding out a
    wifi blip, Kafka's fenced write with the 30 s lease, talking to another person's agent without
    starting it, and agent talk on the ledger. Also **the Codex effort** (`agents-run-on-codex.md`
    lines 7-20 say effort high; 0022 says the lead's Codex steps run at medium): maybe two scopes,
    70% sure it is stale.

The group writers, working from this list, raised these further open questions in their own pull
request bodies: whether a tier's breakdown is the owner's to approve or the lead's; whether time
comes only from Effect's Clock in `next/`; which of the cloud ledger note's 2026-10-25 rules carry to
`next/` (one Worker per project clashes with Tier 1's single Worker); how a `Redacted.value` edge is
marked (the code uses `oxlint-disable-next-line fabrika/no-redacted-value` six times against the
note's "never under a disable"); where a person's own secret lives in `next/`; and whether the
Worker never sees a real model token (0028 leaves it to a test).

## Clashes a later text settles

Each was found by the read; the winner is named. A decision file writes the winner's form.

- `smallest-ledger-proof-to-grow` ("priority, types, labels and links wait for a run that needed
  them"; "an id is a counter or a name", line 33) against `the-tracker-is-like-linear` (2026-10-27),
  label-guidelines (2026-11-06), tracker-views' `linked`, `nested` and `moved` facts (2026-11-06) and
  one-id-per-thing's TypeID (2026-11-07). The later notes win; smallest-ledger is never marked
  replaced.
- `a-job-record-holds-its-trace`'s "size is not a worry" (lines 289-291) and its trace-id key (line
  143) against `design-for-bounded-objects`' parts and `job/<pid>/<part>` (2026-11-07, later).
  Bounded objects wins for `next/`; the trace-id key holds for today's version only.
- `build-on-effect`'s "types are inferred" (line 27) against
  [0095](../.decisions/0095-a-service-file-holds-only-its-contract.md) (a service's type is written
  out). 0095 wins for `next/` service files; inference holds elsewhere.
- `design-for-bounded-objects`: the sealing lean is decided at 70% in its table (line 67) and "still
  proposed" in its differs section (lines 156-157). The status line wins: decided at 70%.
- `recovery-key`: "a browser tab cannot approve others" (lines 374 and 761, and the README row, a 70%
  lean) against its own 2026-11-07 change (lines 55-56, 376-378): a tab with a user-verified passkey
  may approve. The change wins.
- `the-ledger-goes-to-cloudflare`: GitHub-keys sign-in (lines 23-24, 321) is replaced for `next/` by
  `a-key-per-client` (2026-11-05, "no automatic GitHub trust, ever"); "sharing a project copies its
  whole ledger" (line 664) is marked wrong by the note's own "move as built" section (lines 721-726):
  only `tracker/ticket` streams move.
- `program-shape` (2026-11-08) walks back older notes by name (lines 155-170): tea-program's "outputs
  are events", elm-first's required `refuse`, P11's required inputs, outputs and writes, and the word
  fact. program-shape wins for `next/`; tea-program keeps its rule for today's version.
- `agents-commit-as-a-bot` makes the commit inside the box (lines 15-18, 119-121);
  [0028](../.decisions/0028-the-parent-holds-every-right.md) makes it a call to the parent. 0028
  wins.
- `the-test-writer`'s "no login" in its box (line 78) against 0026 and 0028 (the box holds the
  model login). The decisions win.
- `sort-answers-yes-or-no`'s "the owner does not approve the PR" (lines 159-162) against 0082's
  `review.human-approvals` floor (default 1), and 0079 and 0099. The decisions win for `next/`; for
  today's version 0014 is the closer rule.
- `sort-answers-yes-or-no`'s "no ticket-kind label enters the ledger" (line 96) against
  label-guidelines call 3 (a person may make a Kind group). The later note wins.
- An agent's color as "a fourth kind" (shared-tiles, 2026-11-07, lines 137 and 174-176) against
  color-principles' three kinds (line 11); the avatar by the id (shared-tiles lines 116, 304) against
  tile-guidelines' title bar parts (lines 362-363); Enter in customization's glance (lines 117-118,
  2026-11-08) against popovers' Enter on an ask (lines 15-18). The later text wins each time.
- design-language's "no CSS linter" (line 206) against stylelint, which landed 2026-11-07. The later
  wins. Also its call 4, "focus is one gray token everywhere" (line 285), against its own 2026-11-08
  change, "pipes keep their own focus steps" (line 12). The later wins.
- tile-guidelines' "no focusable separators" (line 469) against the-frame's resize mode (clash 10,
  2026-11-03). the-frame wins.
- Several notes still put the keys panel in the palette (picker-guidelines lines 6-7 and 419-420,
  popovers lines 371-372). keys-editor E1 (2026-11-08) moved `C-b ?` to the `keys` program in a tile.
- `push-after-review`'s "only a commit with a passing `reviewed` fact can be pushed" (lines 31-32)
  against `a-yes-binds-to-the-diff` (2026-11-02, lines 82-84: a `reviewed` fact that carries to it as
  `kept`, or a glance that said yes). The later note wins.
- `program-make`'s inputs as keys matched to Msgs (line 40) against program-shape (2026-11-08):
  inputs are values. program-shape wins.
- `one-id-per-thing`'s sketch `Schema.Class` (line 10) against schema-classes-not-of-helpers (data
  with behavior is a `Schema.Opaque`). The decided rule wins over the sketch.

## Drift flags, by kind

Drift is a stale word, an old shape or a line that no longer matches what was later decided. The
104 stale flags fall mostly into these kinds, each settled by the named decision:

| Kind | Settled by | Notes it was found in |
|---|---|---|
| Question-word keys (`why`, `what`, `where`, `who`, `how`) in decided sketches | [0081](../.decisions/0081-no-question-word-names.md): `reason`, `to` and other nouns | ask-desk, react-compiler, ui-verification, the-plan-stage, the-test-writer, outcome-names, a-yes-binds-to-the-diff, agents-behind-one-service, label-guidelines, sort-answers-yes-or-no, tracker-views-are-programs, recovery-key, the-ledger-goes-to-cloudflare, saved-state, ledger-behind-a-service, the-desktop-layer, hot-reload, a-key-per-client, triage-asks, layers (proposed text) |
| Mutation as a pull request step | 0066: mutation runs hourly on main | the-plan-stage, the-test-writer, ui-verification (and the proposed a-ticket-runs-from-the-app) |
| One ticket, one PR; a plan ends in one PR | 0099: big work lands as slices; 0087's stacks; 0015: a merge closes only the tickets its PR names | done-is-per-criterion (lines 17, 82), a-project-is-a-parent-plan, agent-hours, outcome-names, smallest-ledger-proof-to-grow |
| Old names | 0080 (instance, not stage or host), 0051 (gateway, not door), 0091 (module and layer, not room and floor), 0038 (measurement, not health row), 0029 (plural services: `Leases`, `Sessions`, not `LeaseManager`, `SessionManager`, `LimitManager`), program-shape (Event, not Fact), `sentAt` not `said`, status bar not bottom line, `fabrika/tezgah` not `fabrika/desk`, `fabsh` not `tsh` in `next/`, step not stage | many; the-cloud-is-one-more-host lines 384, 442; tea-is-the-engine line 54; inputs-carry-their-sender lines 30, 89-90, 110-111; the-desktop-layer lines 12-13, 173; modes lines 42, 167, 315; tile-guidelines, popovers, fold-not-tabs |
| Miniflare named as used directly | 0042: through Alchemy | the-desktop-layer lines 62-63, scheduled-jobs-on-the-host lines 32-33 |
| `useSyncExternalStore` or the `useModel` stand-in | AGENTS.md: tea 0.23.0's `useRuntime` | the elm-first README row; react-compiler C4 and C6 |
| `~/.fabrika/packs/` as the cache | 0085: `~/.fabrika/cache/packs/` | one-fabrika-toml-per-repo line 167 and its README row |
| A README row that lags its note | the note | fast-and-daily-mutation ("5 minutes per pull request"; its status says 0066 changed it) |

The 7 status mismatches: `the-ticket-is-the-lane-view` (a heading at line 74 still says "Proposed
2026-10-25"; the README and what-a-ticket-shows say decided); `shared-tiles` (the README names a
2026-11-06 decision and an "alias with a session" the note does not hold, probably summon-guidelines';
the status line also omits its 2026-11-04, -05 and -08 decisions); `the-ledger-goes-to-cloudflare`
(the README lists five decided pieces, the note about 14 more, and line 150's "everything else below
is proposed" is false inside the note); `codex-box-home-listing` (item 10 above); `design-language`
("most calls decided 2026-11-07", call 3 open, while the README says decided); `app-icon` and
`top-bar-name` (the README state cell holds a description, not a state); `tracker-views-are-programs`
(two README rows, one for its section 7). Also `fold-not-tabs`' README summary (line 95) says a click
on the title bar folds; the note says a double-click (lines 58-59). The note wins.

Notes stale as a whole: `the-checker-is-a-tea-package` (dropped 2026-10-23, no file);
`sweep-the-core-rebuild-the-pipeline` (its sweep plan replaced by `next/` on 2026-11-01; only its
checks stand); `helpers-and-the-supervisor` (its supervisor part replaced 2026-10-20 by tea-host,
itself an old name now); `a-ticket-runs-from-the-app` (proposed; no file anyway). Four notes are
today's version only and should be written as today's rules, so a `next/` agent does not take them as
its own: `tsh-a-shell-for-tea-programs`, `tea-program`, `the-gui-is-electron-first`,
`the-host-keeps-terminals-and-jobs`.

The other stale flags, one line each, as the readers found them (line numbers at `259704b1f`):

- `design-for-bounded-objects`: "raw health rows are kept forever" (lines 38, 161); 0038 renames them
  measurements.
- `a-job-record-holds-its-trace`: "host job", "the cloud host", "run: one start of a program" (lines
  1, 53-58, 145); 0080's instance and `next/`'s process.
- `data-first-markdown-is-a-view`: the open "where the data lives on GitHub" (lines 77-79) is mostly
  answered by ledger-behind-a-service (lines 8-13); the `Cmd.define` paragraph is marked replaced
  (line 120).
- `smallest-ledger-proof-to-grow`: "lanes (one ticket's trip to its one PR)" (line 15); 0099.
- `a-project-is-a-parent-plan`: "one plan, its tasks, one PR, and that PR closes every ticket"
  (lines 21-22); 0099 and 0015. "Open questions block until the owner answers" (lines 44-46) is
  narrowed by AGENTS.md (2026-11-08) and 0096, not reversed.
- `saved-state`: `{_tag: "refused", why: "seen_ahead"}` (line 70); "run" for a lane step (lines 36,
  102).
- `ledger-behind-a-service`: `why` in a sketch (line 17); "`Ledger` belongs to tea-host" (line 5) is
  today's version; in `next/` the ledger is libfabrika's `ledger/` module.
- `program-make`: "until the pick, the sketch below is what main builds" (lines 9-10); the pick
  happened on 2026-11-08.
- `inputs-carry-their-sender`: "not walked yet: the test-kit law" (line 27), approved 2026-11-08;
  `signer(parent, process, kind)` (line 31), where `kind` becomes `_tag`.
- `modes`: the `Program` type and `defineProgram` (lines 72, 86-87), replaced by `Program.make` and
  program-shape.
- `an-old-host-is-named-then-restarted`: "no version number on each machine" (line 44) is walked back
  by its own lines 47-50 (saved-state S3); the note is today's version and does not warn a `next/`
  reader.
- `the-ledger-goes-to-cloudflare`: "the door" throughout (0051); "one host per project" (line 86);
  "GitHub OAuth as a second `Proof` layer" (line 1235).
- `hot-reload`: H3's upcast sketch and `schemaMigrate` (lines 96-100, 109-110), marked replaced by
  saved-state S3 but still reading as the way; "stage programs" (line 209).
- `north-star-first-harden-later`: "before the build stage leaves experiment status" (line 21).
- `the-tracker-is-like-linear`: a sketch with `type` and string labels (lines 10-14), against
  label-guidelines' numbered labels; "the assignee's host runs its lane" (line 35), low confidence.
- `the-ticket-is-the-lane-view`: "Claude Code hooks write each run's start and end" (lines 86-88), the
  bridge was dropped; "a fold with seven branches" (lines 79-81), replaced by tracker-views 5.1.
- `a-ticket-says-where-it-came-from`: "area and project wait for experiment 205's walk" (line 29);
  areas were decided 2026-11-03 to 11-07.
- `tracker-views-are-programs`: `stuck` with `why` (line 308), `kind` and `who` in section 6 (line
  423), string labels (line 626), `tsh>` in every trace.
- `label-guidelines`: `why` in `next/` sketches (lines 35, 87, 284); D4 "a tsh line" (line 297).
- `sort-answers-yes-or-no`: dropping fold justified by "links wait for a run" (lines 40-41), a
  principle replaced on 2026-10-27, though the drop stands on its own data (2 of 26 right);
  `TriageAnswer` with `why` on every case (lines 58-61).
- `the-plan-stage`: `why` and `who` keys (lines 17, 60, 84); "the mutation step" (lines 121, 279);
  "stage" throughout.
- `the-test-writer`: `{mutant, answer: "cannot", why}` (lines 53-54).
- `agent-hours`: `said` for the writer's clock (line 283); "Tier 1 already says one ticket per PR"
  (line 195); `field/runs.jsonl`, now one file per row (0090).
- `a-yes-binds-to-the-diff`: `why` in its shape (lines 17, 37-39, 76, 126); today's built `carry.ts`
  may keep it until it goes.
- `outcome-names`: the body teaches "verb : who : why" (lines 17, 40-41, 82, 84), while its 2026-11-09
  header says `reason`; "one ticket, one PR" (line 102), in its Open section.
- `helpers-and-the-supervisor`: `tea-host`'s `DynamicSupervisor` and tsh (lines 22, 63).
- `scheduled-jobs-on-the-host`: "a program on the host" and "the host's alarms" (title, line 27); in
  `next/` it is a Durable Object alarm.
- `the-gui-is-electron-first`: "its main process runs the host and every program" (lines 52-54),
  replaced the same day (line 504) but not marked; "each tile has its own tsh, with its own jobs"
  (lines 313-314), changed by host-keeps (one list per host process).
- `design-language`: `--focus-ring` and `--surface-base` (lines 201-202), replaced by call 3's
  grammar; reading tokens from `tokens.ts` and a `CODEOWNERS` line for it (lines 238, 246-247), where
  call 5 chose TOML.
- `fabrika-design-package`: "names and paths are guesses until the move" (lines 14, 90-94); the move
  landed in P31, PR 431.
- `typography`: the ask desk "proposed" (line 333), decided 2026-11-02; text roles as `roles.ts`
  (lines 336-337), text styles since 2026-11-07.
- `ui-on-manti`: `tokens.css` setting Manti's tokens (lines 73-75), now `tokens/manti.toml`; `--fs-*`,
  `--s-1`, `--r-lg`, `--stuck` (lines 85-100), pending a rename pull request not checked.
- `react-compiler`: `useRuntime(props.own)` returning `[data, send]` (line 261), not AGENTS.md's
  selector shape; `why` in a ledger row (line 203).
- `design-on-claude-design`: "stays a plain page" (line 75) and its cost (lines 122-123), undone by
  "changed 2026-11-06" (line 78).
- `ui-verification`: U3 says eight layouts (lines 187-196), but its "what it means" (lines 198-200)
  and `Layout` (line 60) still have four; its doubt cites the per-PR mutation budget (lines 215-216),
  now 0066 and 0106.
- `pipe-colors`: "not built yet" (line 3, and its README row), against "added by tile guidelines PR 1"
  (line 62).
- `ask-desk`: `took.said` (line 95); popovers' "never opens a new tile" (lines 654-655), not checked
  for an update.
- `the-frame`: clash 14 says `C-b ?` is the shortcuts list today (lines 357-359, 380), against its own
  2026-11-08 row (line 131).
- `top-bar-name`: `--text-faint` and `--wire` (line 32), renamed by call 3.
- `tile-guidelines`: "asking marker", "bottom status line", "resize gap", "the region's name" (lines
  378-477), renamed on 2026-11-03 to question marker, status bar, divider and accessible name.
- `fold-not-tabs`: "window" as its rule word (lines 134, 167, 190), tiles since the-frame's clash 6;
  six line tints (lines 164-166), self-marked as what runs today.
- `popovers`: "bottom line" (lines 10, 17, 31) and "program windows" (lines 7, 34).
- `picker-guidelines`: rooms "belong to the summon note, proposed" (lines 16-17), decided since
  2026-11-06; its "prefix" against the frame's `C-b` prefix (lines 206-208, 423-424), an open clash
  the note itself names.

Notes with no flags: `one-meaning-one-way`, `schema-classes-not-of-helpers` (only older code style in
sketches), `clean-slate`, `free-form-plan-to-planner`, `built-for-projects`,
`demlik-is-the-first-real-repo`, `make-the-mistake-impossible`, `effect-fn-for-traced-functions` (its
sink exception was the lead's change of 2026-11-07, and a file should say whose call it was),
`init-runs-once-per-process`, `secrets-are-redacted`, `tickets-start-in-our-tracker`,
`we-use-the-tools-we-build`, `app-icon`.

## What it cost

Agent time only: seven reading agents and one that merged their parts. No model was called beyond
them, no paid run, $0. Their tokens were not recorded.

## What it cannot tell us

- Whether the 59 notes a decision already links hold rules no decision states. Their links were not
  read rule by rule. Several are linked for one point only (`themes` and `color-principles` by 0009,
  about gray tokens).
- The rules were compared with decision files and other notes, not with the code. A rule the code
  has left behind is caught only by each group writer's own read (0115 says so too).
- Whether each anchor resolves on GitHub. They were worked out by hand.
- How many of the about 29 "partly" rules need a new file and how many only an amendment to the
  existing one. Each writer decides.
- The drift flags were counted on this read's own labels: 104 stale, 29 contradictions and 7
  mismatches. An earlier audit of the same file counted 155 stale and contradiction flags; the
  difference was not traced.
- Which of batches 15 to 28 each of groups 5, 6 and 7 takes.
- Line numbers are as of `259704b1f`, not rechecked on today's main except for the five notes named
  above.
