---
date: "2026-11-11"
scripts: "none; reading, nothing ran"
summary: "Both versions' notes under `docs/direction/`, at `67864f7bf`, after 0115's move; step 2 of 0130. Of 151 notes, 114 can go with no owner call: 21 delete now, 34 fold into an existing decision, 44 need their missed rules written first, 6 become experiments, 3 patterns, 6 go to the private archive. 37 need the owner, as 18 yes/no questions, among them 5 long notes whose reasoning fits no short decision file. The 0115 move missed 258 rule flags in 62 notes. `follows/`'s four files stay apart under 0017; the lean is `.patterns/follows/`. Agent time only, $0; tokens not recorded."
---

# 280. Sorting the direction notes: what kind each one is, and where it goes

Read on 2026-11-11. **This is reading, not a measurement.** Seven agents read every note under
`docs/direction/` at commit `67864f7bf`, once 0115's seven pull requests had merged (decisions 0200
to 0521). Each note was checked against the decision files it links and that link it. Nothing ran,
and no note was moved or deleted. It is step 2 of
[0130](../.decisions/0130-every-piece-of-knowledge-has-one-home.md): the count by kind, and the list
of notes that need the owner. It covers both versions' notes; each row says which version where the
note does.

**The answer: of 151 notes, 114 can go with no owner call, and 37 need one. Those 37 come down to 18
yes/no questions.** But the 0115 move missed decided rules in 62 notes: 258 flags, some of them a
group such as G1 to G8. 46 of the 114 hold 159 of those flags, and each of them goes only after
its rules are written as decision files. The owner's 37 hold the other 99.

| Proposed move | Notes |
|---|---|
| Delete now: everything in it is held elsewhere | 21 |
| Fold a short leftover into an existing decision's Context, then delete | 34 |
| Write its missed rules as decisions first, then fold and delete | 44 |
| Becomes an experiment write-up | 6 |
| Becomes a pattern doc | 3 |
| Goes to the owner's private archive | 6 |
| Needs the owner | 37 |
| **All notes** (not counting `follows/` and the README) | **151** |

`docs/direction/follows/` holds four more files: the README and the Elm, Kubernetes and OTP tables.
[0017](../.decisions/0017-each-model-we-follow-has-one-table.md) keeps them, and 0130 does not
name them. They are listed apart below and asked about in question 18.

```text
151 notes, 36,703 lines
 ├─ 114 go with no owner call
 │   ├─  21 delete now
 │   ├─  34 fold into an existing decision, then delete
 │   ├─  44 write their missed rules first (154 flags), then fold and delete
 │   └─  15 become 6 experiments, 3 patterns, 6 archived (2 of them: 5 flags first)
 └─  37 need the owner: 18 questions
     ├─  5 long reasoning that fits no short decision file   (question 1)
     ├─ 12 proposals waiting on a tier walk                  (question 2)
     ├─  6 proposals nobody took up                          (question 3)
     └─ 14 one real call each                                (questions 4 to 17)
 + follows/: 4 files                                         (question 18)
```

## The questions for the owner

Each is one yes/no. The lean, why, cost and confidence follow.

1. **Long reasoning: write the decided rules of these five as decision files, and move each one's
   long reasoning into one experiment write-up as a reading?** The five: `a-local-first-sync-engine`
   (660 lines), `the-cloud-is-one-more-host` (613), `themes` (723), `summon-guidelines` (936) and
   `talk-where-you-work` (427). Lean: yes. Why: they hold 72 flagged decided rules no decision
   file has, and their reasoning (the five layers, the brain and hands walks, the theme contrast math,
   rooms and the `@` line) is too long for any Context. An experiment is 0130's home for long
   reasoning. Cost: about 50 new decision files and 5 write-ups; the cloud host's rules need a check
   against 0029 (`Limits`, not `LimitManager`), 0102 and 0418. Confidence: 80%.
2. **Proposals waiting on a walk: move each proposal's undecided part into an experiment write-up,
   marked "design input, nothing run", and delete the note?** The twelve: `a-review-list-can-only-shrink`
   (into experiment 58), `agents-are-programs` (into 169), `customization`, `errors-are-diagnostics`,
   `every-finding-is-rated`, `packs-are-programs`, `pipeline-strategies`, `shared-tiles`,
   `tracker-views-are-programs`, `windows-in-next`, `services-and-our-own-ci` and the monorepo part
   of `one-fabrika-toml-per-repo`. Lean: yes. Why: 0130 allows no note to stay, a plan row is too
   short for the reasoning, and the tier walk then reads one write-up. Each one's decided bits are
   written as decisions first (see the missed rules). Cost: about 12 write-ups, some in existing
   experiments. Confidence: 75%.
3. **Proposals nobody took up: send these six to the private archive?** `every-wait-is-a-queue`,
   `experiments-behind-a-service`, `fabsh-grows-into-a-language` (plus a Tier 5 ticket),
   `tea-program` (today's version, replaced in `next/` by `Program.make`, 0256),
   `the-ledger-goes-to-cloudflare` (its built but undecided leans), and `ship-stage-rules` (today's
   paused ship, which the merge queue replaces, 0107 and 0110). Lean: yes. Why: nothing builds from
   them, and their decided parts are in 0433 to 0441 and 0283 to 0290. Cost: if today's ship step
   restarts, its rules need a decision then. Confidence: 65%.
4. **`agent-hours`: does a ticket estimated over 8 agent hours still split before the build?** Lean:
   no. Why: 0099 cuts work by what works alone, never to fit a count. Cost: none if no; a bullet that
   clashes with 0099 if yes. Confidence: 70%.
5. **`an-agent-run-keeps-its-content`: decide now that agent content lives in a deletable `content`
   table beside the spans?** Lean: yes. Why: AGENTS.md already says content stays deletable and
   cites this note. Cost: the Tier 5 walk shrinks to masking and the 64 KB cap. Confidence: 65%.
6. **`autonomy-is-measured-trust`: write a merge row and a break row from now on, and leave the rate
   and budget until 30 merges?** Lean: yes. Why: what a merge checked exists only at merge time;
   later loses it. Cost: one field row shape and a write in `catchup.sh`. Confidence: 75%.
7. **`code-commits-and-signs-each-step`: in `next/`, does the step program commit and sign, so a
   step's agent never runs git or holds a key?** Lean: yes. Why: all 21 signing problems on record
   came from how signing was driven, not from the keys. Cost: it walks back "each agent signs with
   its own key" in `a-unit-of-work-is-a-commit`, whose signing rules wait on this answer; about 150
   to 250 lines in Tier 6. Confidence: 80%.
8. **`fast-and-daily-mutation`: does `next/`'s mutation queue file one ticket per symbol, amending
   0066's one per file?** Lean: yes. Why: a gap keyed by file, symbol and text survives moved lines.
   Cost: one new decision and a 0066 amendment. Confidence: 60%.
9. **`inputs-carry-their-sender`: does the gateway refuse and record a client-sent `id` or `by`, and
   sign a write with no cause as the owner's `own`?** Lean: yes. Why: this is the mass-assignment
   case (OWASP API3), and today's code already falls back to the owner. Cost: one refusal path and
   one `own` case. Confidence: 85%.
10. **`keys-editor`: are E3, E7's edge law (3px, 6 per channel) and smaller calls 1 to 3 decided as
    their leans?** Lean: yes. Why: the list shipped on them. Cost: the edge numbers may need
    retuning on light or 1x screens. Confidence: 75%.
11. **`layers`: does the ledger record each layer's open and close with `via` and its reason, and is
    a side panel about another thing its own tile?** Lean: yes. Why: why a sheet closed is lost if
    not written. Cost: two event kinds. Confidence: 70%.
12. **`one-ask-and-one-meter`: can an agent run on a flat subscription start with no person's yes to
    a spend estimate?** Lean: yes. Why: its dollars are list price for comparison, not money spent.
    Cost: no money gate on those runs until the quota hold lands. Confidence: 65%.
13. **`principles`: drop the five "other candidates" lines instead of deciding them?** Lean: yes. Why:
    never picked, and 0212, 0451 and 0460 cover most of them. Cost: "keys first" and "named parts"
    lose a home until a walk. Confidence: 60%.
14. **`smallest-ledger-proof-to-grow`: is "nothing joins the ledger without a run that needed it"
    withdrawn, for record wide?** Lean: yes. Why: 0346 dropped it for the tracker, and record wide
    says the opposite. Cost: one line in 0216. Confidence: 75%.
15. **`the-host-keeps-terminals-and-jobs`: drop "the layout is the app's", since 0444 and the code
    keep the layout on the host?** Lean: yes. Why: 0448 already declined to decide it. Cost: one rule
    from a later walk is set aside. Confidence: 60%.
16. **`ui-verification`: add one open weekly look at one program's full shot grid (call C6)?** Lean:
    no. Why: aimed looks cover new screens, and a weekly chore goes against "protection in code, not
    a chore". Cost: some drawn bugs wait longer. Confidence: 55%.
17. **`one-parent-stages-as-slots`: is only "the pipeline is one parent, with the steps as its
    children" decided, and the slot bullets history?** Lean: yes. Why: the 2026-10-22 line names
    only the idea. Cost: one short decision file; the rest is archived. Confidence: 70%.
18. **`follows/`: move the four files to `.patterns/follows/` and amend 0017's path, keeping its
    one-row-per-behavior rule?** Lean: yes. Why: 0130 removes `docs/direction/` but names no new
    home, a table of our code against a model is "how the code is shaped now", and 0130 says the
    move changes no rule, so the path change needs the amendment. Cost: 0017's amendment, about 10
    links, the AGENTS.md row and the lead skill. Confidence: 75%.

## How it was read

- Seven agents, about 21 notes each, split by line count. Each read its notes in full, opened the
  decisions they link and that link them, and wrote one row per note.
- **Kind** is 0130's: `reasoning` (decided rules moved, reasoning left), `study` (an experiment),
  `shape` (a pattern), `guide` (a how-to or guideline), `history` (the archive), `proposed`.
- **Links in** counts files that link the note, from a `rg` of its file name: AG for AGENTS.md, DEC
  `.decisions/`, PAT `.patterns/`, AGT the skills, PLAN `docs/plan/`, CODE code files, DIR other
  notes, OTH experiments, `field/`, the glossary and other docs. A zero is left out.
- **Missed** means a decided rule in the note that no decision file holds. A reader flagged it
  with its line number. The list is at the end.
- The sorting into the seven moves is the lead's, from the readers' rows. Every note a reader
  marked "owner" stays there. `principles` was marked fold, but its one undecided part needs a
  call, so it counts as owner. A reader's "fold" with missed rules counts as "missed rules first".

## The notes, by move

Each section holds one table. The cells are the readers' words, cut short.

### Delete now (21)

Everything in these is held by a decision, an experiment, a pattern or the code. What is left is history that the record already keeps.

| Note | Kind | Rules held in | Left that nothing holds | Links in | Move |
|---|---|---|---|---|---|
| `ask-for-decisions-not-facts` | reasoning | 0415 | "Why" bullets, 3 lines; 0415's Context already has the backlog line | DEC 1, DIR 3, OTH 4 | delete: rule and code block in 0415 |
| `build-on-effect` | reasoning | 0250, 0251, 0254; pattern `effect-state-and-time` (Clock) | "Where the code still breaks it": today's host `Date.now()` history | DEC 3, PAT 5, CODE 2, DIR 5, OTH 1 | delete: rules in 0250, 0251, 0254, clock in the pattern |
| `built-for-projects` | reasoning | 0223, 0231 | nothing | DEC 1, DIR 1, OTH 1 | delete: rules in 0223 and 0231 |
| `demlik-is-the-first-real-repo` | reasoning | 0224 | nothing | DEC 1, DIR 1, OTH 1 | delete: rules and "still to do" in 0224 |
| `fabrika-design-package` | reasoning | 0456, 0453, 0451 | "What goes in" list; the package README holds its shape now | AG 1, DEC 2, PLAN 3, CODE 6, DIR 4 | delete: rules in 0456, 0453, 0451; shape in `packages/fabrika-design/README.md` |
| `hand-run-review-and-cleanup` | guide | review and lead skills, `catchup.sh`, 0035, 0014 | nothing; each section is in the review or lead skill | DEC 1, PLAN 1, DIR 1 | delete: rules in the review skill, lead skill, 0035 and 0014 |
| `helpers-and-the-supervisor` | reasoning | 0416, 0417, 0418, 0419, 0420 | "Still open" list (harness names in steps, an ask that does not stop the asker) | DEC 5, DIR 4, OTH 4 | delete: rules in 0416 to 0420 |
| `north-star-first-harden-later` | reasoning | 0324 | The 2026-10-18 order of work (experiments, fabrika, Tuval, hardening): history, replaced by tiers.md | DEC 1, DIR 2, OTH 1 | delete: rules in 0324; the order of work is history |
| `one-id-per-thing` | reasoning | 0211 | "Where main stands" (a dated status of `Id.ts`, stale); "What it cannot tell us", 3 lines, mostly 0211's Consequences | DEC 1, PLAN 1, DIR 1, OTH 3 | delete: rules in 0211; the code holds `Id.ts` |
| `one-meaning-one-way` | reasoning | 0212 | nothing | DEC 1, DIR 1 | delete: rules and the "helper on top" doubt in 0212 |
| `pin-exact-versions` | reasoning | 0255 | "The check is `exact-versions.ts`" (code holds it); "What it cannot tell us", 4 bullets, mostly 0255's Consequences | AG 1, DEC 1, CODE 1, OTH 1 | delete: rules in 0255. The CODE link is the lint's error text, which must point at 0255 |
| `program-make` | reasoning | 0256 | nothing; the "shape gets rethought" line is done by 0257 to 0260 | DEC 1, PLAN 3, DIR 3, OTH 3 | delete: rules in 0256, the rethink in 0257 to 0260 |
| `push-after-review` | reasoning | 0391, 0392, 0409 (leak check before push) | Why and Cost, 15 lines; "Still open": where the local repo lives, what the leak check looks for | DEC 2, DIR 5, OTH 4 | delete: rules in 0391, 0392, 0409; the why fits 0392's Context |
| `react-compiler` | reasoning | 0463, 0464, 0465, 0466; experiments 194 and 195 | "Today's app" ticket sizes (history); "What changes in Tier 1" (the plan files hold it); "Where this differs" (history); Rolldown, a lean now built | DEC 5, PLAN 2, CODE 3, DIR 2, OTH 3 | delete: rules in 0463 to 0466, the reading in experiments 194 and 195 |
| `read-fresh-run-alone` | reasoning | 0397, 0398 | "Built in ship": merge pinned to main (exp 107) and "build takes main in" are replaced by 0097 and 0107; "Still open", 2 bullets, moot under the merge queue | DEC 2, PLAN 2, CODE 4, DIR 6, OTH 3 | delete: rules in 0397 and 0398; the merge-pin part is replaced by 0097 and 0107, merge-not-rebase partly in 0072 |
| `reuse-before-special-rules` | reasoning | 0421 | "What would change it", 2 lines | DEC 1, DIR 2, OTH 2 | delete: every rule is in 0421; its Why is 0421's Context |
| `the-ticket-is-the-lane-view` | reasoning | 0347, 0208 (machine state is data, not markdown) | Proposed view summary, which is `what-a-ticket-shows`'s; experiment 138's numbers; open "where the app keeps a user's key", since answered by the key-per-client decisions. | DEC 1, CODE 1, DIR 7, OTH 3 | delete: rules in 0347 and 0208, evidence in experiment 138, view study in what-a-ticket-shows. |
| `the-tracker-is-like-linear` | reasoning | 0346, 0349, 0376 | nothing; the study is tracker-views-are-programs. | DEC 3, DIR 3, OTH 3 | delete: rules in 0346, 0349 and 0376; links point to tracker-views-are-programs. |
| `triage-asks-when-worth-is-unclear` | reasoning | 0377 | Part 6's precedent hint (7 of 20 at 0.9), one line; "cannot tell us", 2 lines. The numbers are experiment 163's | DEC 1, DIR 1, OTH 5 | delete: rules and "asks pile up" in 0377, numbers in experiment 163 |
| `tsh-a-shell-for-tea-programs` | reasoning | 0430, 0431, 0432 | nothing (the write-asks-first question is 0431's Consequences; "what would change it" is one line) | DEC 3, DIR 3, OTH 1 | delete: rules in 0430, 0431, 0432 |
| `we-use-the-tools-we-build` | reasoning | 0349 | The 75% doubts (upkeep, 5 GB trace), 2 bullets; the cost sketch block. Pricing is in 0349 | DEC 2, OTH 2 | delete: rules and cost in 0349 |

### Fold into an existing decision, then delete (34)

Each keeps a short leftover, such as a code block, a table or a few lines of why, that fits the named decision's Context.

| Note | Kind | Rules held in | Left that nothing holds | Links in | Move |
|---|---|---|---|---|---|
| `a-key-per-client-and-no-github-trust` | reasoning | 0322, 0323 | "Why" (one door check; Signal, Tailscale, SSH `authorized_keys`), 9 lines; "What it costs", 2 lines | DEC 4, PLAN 3, DIR 3, OTH 4 | fold 0322: the Why and cost go in its Context, which has none now; then delete |
| `a-project-is-a-parent-plan` | reasoning | 0220, 0221 | "Why" (demlik board study, 92% p1 campaigns, one clock for work), 12 lines; the on-hold "new report joins an approved plan" rule | DEC 2, CODE 3, DIR 5, OTH 4 | fold 0220: the Why goes in its Context; the on-hold rule is on hold with fold, so it stays out; then delete |
| `a-ticket-says-where-it-came-from` | reasoning | 0348, 0369 | The `from` union sketch (proposed, its plan settles it); "Why `from`", 7 lines | DEC 2, PLAN 1, CODE 3, DIR 2, OTH 1 | fold 0348: the sketch, marked proposed, and the Why go in its Context; then delete |
| `a-yes-binds-to-the-diff` | reasoning | 0394, 0395 | The `carry` code block and ticket 117 trace; "The known way" (Gerrit, GitLab, GitHub); glance leans (65%, 80%); "Where it applies", a 13-row build map of today's code | DEC 3, PLAN 2, CODE 12, DIR 1, OTH 2 | fold 0394: the code block and known way go in its Context; the build map is history; then delete |
| `agents-commit-as-a-bot` | reasoning | 0401 to 0407 | The commit-trailer sketch (`Fabrika-Agent`, `Fabrika-Input`, still a sketch); "Open" 1 to 4, walked at Tier 5; "Why", 7 lines | DEC 7, PLAN 1, DIR 2, OTH 2 | fold 0401: trailer sketch and open items as "Not decided here"; then delete |
| `agents-read-rules-the-normal-way` | reasoning | 0399, 0400 | The `ownRules` code block; experiment 155's wrong guess; untested skills-copy option | DEC 2, CODE 3, DIR 1, OTH 1 | fold 0400: the `ownRules` block goes in its Context; evidence is experiment 155; then delete |
| `an-old-host-is-named-then-restarted` | reasoning | 0281, 0282 | "Built 2026-10-26" bullets (history); the restart finding: a call goes again only when a kind's `recovered` sends it | DEC 3, CODE 5, DIR 2, OTH 2 | fold 0282: the `recovered` finding goes in its Context; the built notes are history; then delete |
| `app-icon` | reasoning | 0494 | The geometry block (1024 canvas, gaps, corners), the color table with contrast, the 16-px drawing, how it reaches the screen | DEC 1, CODE 1, DIR 2 | fold 0494: geometry and color table go in its Context; then delete |
| `areas` | reasoning | 0356 to 0363, 0368 | The schema sketch and sitting trace; per-principle Linear, Elm and a11y notes; "The build in today's version" (history); evidence is experiment 205 | DEC 10, PLAN 1, CODE 8, DIR 3, OTH 4 | fold 0356: the schema sketch goes in its Context; then delete |
| `ask-desk` | reasoning | 0480 to 0489 | The `asked`/`answered` sketch and sitting trace; "How Linear would build it"; small calls' leans with numbers; evidence is experiment 196 | DEC 10, CODE 6, DIR 8, OTH 6 | fold 0485: the shape sketch goes in its Context; then delete |
| `brain-hands-window-agent` | reasoning | 0051, 0068, 0102, 0285; glossary rows (hands, window, client, host, capabilities) | "Why a browser is a host", "The other answers we weighed", four doubts; 2026-11-08 Cmd-O and "no `FABRIKA_REPO`" lines, only partly in 0285 | AG 1, DEC 5, PLAN 2, DIR 7, OTH 7 | fold 0102: weighed answers and doubts into its Context; then delete |
| `data-first-markdown-is-a-view` | reasoning | 0208, 0209, 0210 | "What Effect Schema asks that zod did not" block; zod move order and history; "Open" list, now answered by 0231 | AG 1, DEC 3, CODE 4, DIR 12, OTH 3 | fold 0209: the Effect-vs-zod block; the rest is history; then delete |
| `design-for-bounded-objects` | reasoning | 0200 to 0206; experiment 225 | "Why" (Cloudflare rules, OTP `max_heap_size`, KIP-405), "The OpenTelemetry clash"; R2 bucket lean, left open in 0202 | DEC 10, PLAN 1, OTH 3 | fold 0200: Why and the OTel clash in its Context; sources stay in experiment 225 |
| `design-language` | reasoning | 0450 to 0455 | §2 sort of 44 notes (outdated by 0130); §3 guideline page shape and doc-tag sketch; §5 accessibility table | DEC 6, PLAN 3, DIR 2 | fold 0450: §3 page shape and §5 table; §2 archived |
| `design-on-claude-design` | reasoning | 0467, 0468 | "The two kinds of artifact"; "Limits found in the first round" table; costs | AG 1, DEC 2, AGT 2, PLAN 1, DIR 2, OTH 1 | fold 0467: limits table in its Context; then delete |
| `fold-not-tabs` | reasoning | 0505, 0506, 0507, 0508, 0266 | "Why" (AeroSpace, i3, Ableton), the worked tree example, three doubts | DEC 5, AGT 1, CODE 3, DIR 8, OTH 4 | fold 0505: Why and the tree example; then delete |
| `hot-reload` | reasoning | 0291, 0292, 0293, 0294, 0295 | "How it is tested": 9 laws. H4's rollback of a throwing step, open (also on Tier 1's P15 row). Memory and swap numbers are in experiment 183 | DEC 7, PLAN 2, DIR 5, OTH 6 | fold 0291: the 9 laws go in its Context; H4 stays open on P15's row; then delete |
| `init-runs-once-per-process` | reasoning | 0253 | The inbox machine code block (init returns Cmds), the ledger entry sketch `process_…/init/0`, the Elm and OTP reading | DEC 1, PLAN 1, OTH 1 | fold 0253: the code block and the entry sketch; then delete |
| `label-guidelines` | reasoning | 0364 to 0371 | "The shape" schema block, the fold's other refusals (unknown number, bad merge, name taken), the "What the ledger records" table | DEC 11, CODE 2, DIR 1, OTH 4 | fold 0366: schema, refusals and ledger table in its Context; then delete |
| `lane-queue-or-scheduled-job` | reasoning | 0108, with 0101, 0105, 0106, 0107 | "The families of work" with five leans marked not ruled on, the `LastRan` sketch | DEC 1, OTH 6 | fold 0108: the families list, leans kept marked; then delete |
| `ledger-behind-a-service` | reasoning | 0231, 0232 | "The pipeline's facts on the tea-host ledger": today's streams, sqlite paths, fold rules. The which-side examples block | AG 1, DEC 2, PLAN 1, CODE 3, DIR 10, OTH 6 | fold 0232: the streams section in its Context, the examples block in 0231's; then delete |
| `make-the-mistake-impossible` | reasoning | 0233, 0234; 0324 cites it | "Where it already shows", six examples; the why (experiment 59, the shell) | DEC 3, PLAN 1, DIR 9, OTH 2 | fold 0233: the example list and why in its Context; then delete |
| `outcome-names` | reasoning | 0396 | "Open, found while building it for ship" (5 items; 0396 keeps only `stuck`); "New names, 2026-10-18" (today's ship and operate names); Why bullets 2 to 4 | AG 1, DEC 1, AGT 1, CODE 5, DIR 5, OTH 5 | fold 0396: the open list into its "not decided"; the new names are code; then delete |
| `pipe-colors` | reasoning | 0477, 0478, 0479, 0452 | "The values" tables (code holds them in `window.css`); "Why six" (OKLab distances) and "Why these hues", 10 lines; doubts list | DEC 4, PLAN 4, CODE 7, DIR 6, OTH 1 | fold 0478: the why-six and hue reasoning; values stay in `window.css`; then delete |
| `program-shape` | reasoning | 0257, 0258, 0259, 0260; experiment 235 holds the probe table | "What it walks back, by name", 8 lines; why shape 3 lost, 3 lines | DEC 8, OTH 5 | fold 0257: the walk-back list and why shape 3 lost; then delete |
| `saved-state` | reasoning | 0225 to 0230 | The 5-step trace of one comment's `seen`; the S3 branch A vs B table; "A tryout in today's version" (not filed); cost table; evidence is exp 190 | DEC 8, PLAN 2, CODE 3, DIR 7, OTH 6 | fold 0225 (the trace) and 0227 (the A vs B table); the rest is exp 190 and history; then delete |
| `schema-classes-not-of-helpers` | reasoning | 0213, 0214, 0215; the Of lint is 0029 | "Why not `Schema.Class`" test table (5 rows); "Doubts": Opaque stays structural, 85%; cost: 18 PRs (history) | AG 1, DEC 3, PLAN 2, CODE 2, DIR 4, OTH 2 | fold 0213: the Class vs Opaque table and the structural doubt go in its Context; then delete |
| `secrets-are-redacted` | reasoning | 0320, 0321 | "How it is held" (lint table and `redacted.test.ts`); Why for path-named edge files; "What it does not cover" list; 85% doubt | DEC 4, PLAN 1, CODE 5, DIR 2, OTH 2 | fold 0320: the lint table and test go in its Context; the "does not cover" gaps list goes to the private archive, since gap lists stay out of the public repo; then delete |
| `sort-answers-yes-or-no` | reasoning | 0369, 0372 to 0376; "owner does not approve the PR" is 0014 here, 0071 and 0082 for the product | "Why" (later needs a wake-up, priority meant "not now"); the bar's Open list (code-seen rules to research, Jev out of no), which 0374 points back to | DEC 6, CODE 6, DIR 11, OTH 7 | fold 0372 (the Why) and 0374 (the open list, since 0374 says "open in the note"); then delete |
| `tea-is-the-engine` | reasoning | 0254 | The "Why" bullets (two durable models break Elm first; cluster cannot sleep, 20 s first call) and the opening turn sketch. Evidence is in experiment 174. | DEC 1, PLAN 2, DIR 1, OTH 6 | fold 0254: the turn sketch and the two "Why" bullets go in its Context. Note 0254 still says cluster returns "in a note", which 0130 ends. |
| `the-desktop-layer` | reasoning | 0274, 0275, 0276, 0277, 0278, 0279, 0280 | The `Desktop` type sketch, the one-example block, experiment 150's 14 ms vs 95 ms echo, WezTerm's bug links. Stale: Miniflare named directly (0042). | DEC 9, PLAN 2, DIR 10, OTH 4 | fold 0274: the type sketch and the example go in its Context; the echo number is experiment 150's. Then delete. |
| `tickets-start-in-our-tracker` | reasoning | 0340, 0341, 0342, 0343, 0344, 0345, 0346, 0347 | "Why" (Rule of Two, prompt-injection sources), about 15 lines. "Still open": the PR watcher lean with its alarm sketch, webhooks through a tunnel, ticket ids as a guess | DEC 9, CODE 2, DIR 11, OTH 3 | fold 0340: the "who writes the ticket is the guard" why; the still-open leans go to archive |
| `top-bar-name` | reasoning | 0495 | "What we saw" shots table (5 rows); the Linear clash and 60% / 55% sureness; "What this cannot tell us", 4 bullets | DEC 1, DIR 5, OTH 2 | fold 0495: the Linear clash and the shots table go in its Context, then delete |
| `typography` | reasoning | 0457, 0458, 0459, 0460 (makers read in experiment 200) | The full `textStyles` map with weights; `DescriptionList` sketch; the traced-value block; the names doubt (vs Material); "A tryout in today's version" list; "Manti ideas" (issue 135 comment) | DEC 4, DIR 4, OTH 3 | fold 0457: the map, the description list sketch and the names doubt; tryout list to docs/plan, Manti ideas to archive |

### Write the missed rules first, then fold and delete (44)

Each holds decided rules that no decision file states. The 0115 writer adds them, as new files or as bullets in the decision named, then the leftover folds and the note goes. Several of these hold most of their rules still: `done-is-per-criterion`, `elm-first`, `keybindings-are-configurable`, `pipeline-guidelines`, `program-guidelines`, `programs-run-in-a-box` and `rethink-do-not-port`.

| Note | Kind | Rules held in | Left that nothing holds | Links in | Move |
|---|---|---|---|---|---|
| `a-browser-is-always-a-client` | reasoning | none in full; 0274 and 0102 say a layer or `hands` must run in a tab; 0016, 0074, 0447 only link | "What was decided" (no protocol needs what a browser lacks, check every design), the text-ping table, "How it is kept" (CI browser suite) | AG 1, DEC 3, PLAN 2, DIR 5, OTH 3 | fold into a new decision (MISSED rules); "What was checked" is experiment 174's evidence; then delete |
| `a-job-record-holds-its-trace` | reasoning | 0207, 0204, 0038 (names) | "The ticket's view, too (ticket 141)": tokens never dollars, colors by state, the three recorded facts and span tags; "Doubts" (Redacted law, JSON Patch); "No search across records in v1" | DEC 3, PLAN 1, CODE 7, DIR 11, OTH 4 | fold 0207: ticket-view rules into 0207 or a new today's-version decision (MISSED), the tally example into 0207's Context; then delete |
| `a-ticket-runs-from-the-app` | history | 0346 (assignee's host runs the lane), 0364 (`delegated` fact kind), 0028 | Two decided calls of 2026-11-06 (filing starts the lane; person is assignee, agent is delegate, whose turn is a fold); the rest is a proposed v1 plan of 2026-10-27, overtaken | DEC 1, CODE 7, DIR 6, OTH 3 | fold into a new decision (two MISSED rules), then archive the v1 plan |
| `a-unit-of-work-is-a-commit` | reasoning | 0098 (chain from merge base), 0053 (exam list per parent), 0014, 0004 | Nearly all its rules: the commit is the unit, test writer's commit first, code signs at fetch, git note on `refs/notes/fabrika`, CI decides by signature not trailer, person signs with git SSH, tree-to-tree links, the field-row table | DEC 4, PLAN 2, CODE 2, DIR 3, OTH 5 | fold into a new decision (MISSED: the signing rules); the why (in-toto, SLSA) is its Context; then delete |
| `agents-behind-one-service` | reasoning | 0325, 0326, 0327, 0026 | "Our Worker never sees a real token" (line 140); the shared-account Consumer Terms reasoning; "Where the code is today" table (history) | DEC 4, CODE 1, DIR 7, OTH 8 | fold 0327: the token rule as a bullet (MISSED), the Consumer Terms reasoning in its Context; then delete |
| `agents-run-on-codex` | reasoning | 0022 (model, effort), 0045 (sockets in a container), 0028, 0064 (no lane driver) | Step agents run on Codex and the lead on Claude; triage on opus until experiment 159; an Electron step runs on a Claude agent; a Codex step commits in its own clone | DEC 3, AGT 1, DIR 2, OTH 2 | fold into a new decision (MISSED); the one-driver-per-ticket part is replaced by 0064 and goes; then delete |
| `backend-as-a-library` | reasoning | 0231 (typed services, no direct `gh`), AGENTS.md | "Today's tool is already half of a state machine" section; run-log numbers (60 and 83 processes, 31 exit codes). MISSED rule, below | AG 1, DEC 3, DIR 6, OTH 3 | fold into a new decision (backend is a library, build the fake first), reasons in its Context; then delete |
| `color-principles` | guide | 0009, 0451, 0452 (focus token, one meaning per token) | The eight principles, steps table, two text steps, "a line or a fill is never text", the waiting-action accent. MISSED rules, below | DEC 1, AGT 1, PLAN 4, DIR 11, OTH 3 | fold into a new decision (color principles), steps table into 0451's Context; "today's code still breaks" archived |
| `control-in-code` | reasoning | AGENTS.md intro; 0074 and 0254 cite it | "Who owns what" (machine, agents, Jev); "Why" (cost from day one, shipper's ten calls). MISSED rules, below | DEC 1, DIR 2, OTH 5 | fold into a new decision (control lives in code), Why in its Context; then delete |
| `done-is-per-criterion` | reasoning | none; 0004 later replaced its "merge, never rebase" line | All rules: open or met, criteria as events, no deviations, stall and wobble rules, merge takes a proof, one PR per plan, stuck task. MISSED, below | DEC 1, PLAN 1, CODE 14, DIR 8, OTH 5 | fold into new decisions (criteria, stall rule, one PR per plan); rebase line stays replaced by 0004 |
| `elm-first` | reasoning | 0037, 0046, 0257 (`refuse`), 0028; AGENTS.md | Core rules and the named-exceptions list; `useMachine` to `useRuntime` history. MISSED, below | AG 2, DEC 1, PAT 3, PLAN 2, CODE 5, DIR 13, OTH 12 | fold into a new decision (Elm first, exceptions named), with tsh lines and the factory as its exceptions |
| `every-machine-has-laws` | reasoning | 0093 (plants), 0226 (sync test), 0046 (pbt) | Dated history of the search checker; experiment 90 numbers. MISSED, below | DEC 1, AGT 1, CODE 1, DIR 4, OTH 2 | fold into a new decision (every machine has laws), history archived |
| `every-update-builds-every-layer` | reasoning | 0068, 0088, 0016; tiers.md | First-pass table; "Why" (5 KB cap, tab key clash); walking skeleton name. MISSED, below | DEC 1, PLAN 2, DIR 1 | fold 0068: the missed rules and Why |
| `five-steps-for-every-check` | reasoning | 0093 (labels, plants, `next/`), 0411 (K20), 0385 (TLA+), 0040 | The five steps; "every law is a property" for both versions. MISSED, below | DEC 3, AGT 5, DIR 6, OTH 3 | fold into a new decision (five steps for every check), Why in its Context |
| `jev-same-answer-cheaper` | reasoning | 0412, 0413, 0414 | Three rules no decision holds: a narrow question may read a wide input, tracing is a typechecker's job, 0.8 as the usual floor | DEC 3, CODE 2, DIR 1, OTH 3 | fold 0413: add the three missed rules; then delete |
| `jidoka-and-andon` | reasoning | in part: 0415, 0488, 0234; 0073 for `next/` comments; 0110 cites it | The 2026-11-01 lane rules (see Missed). The `Stop`, `Judgment`, `PICKS` types, the bounds table, the 69-place table of today's stops | DEC 3, PLAN 2, CODE 4, DIR 5, OTH 5 | fold: a new decision for today's lane's six missed rules; the 69-place table and bounds become an experiment; then delete |
| `keybindings-are-configurable` | reasoning | in part: 0273 (K7), 0496 (K3's A and D), 0497 (clash words), 0092 (live reload), 0069 cites it | Almost all of K1 to K9, the load refusals, keys from programs not packs, the decided-leans table, the keys-that-cannot-be-taken table | DEC 2, AGT 1, PLAN 1, CODE 3, DIR 9, OTH 5 | fold: new decisions for K1 to K9, the pack rules and the leans table; the "cannot be taken away" table goes in one's Context; then delete |
| `local-is-the-cloud` | reasoning | in part: 0042 (the laptop through Alchemy), 0080 | Three decided rules no decision holds (see Missed). The phoenix "one remote piece" why, the move order | DEC 2, PLAN 3, DIR 3, OTH 6 | fold: a new decision for the three missed rules, the why in its Context; then delete |
| `modes` | reasoning | 0267 to 0273 | The `Command` and `Program` type block, one missed rule (a tsh word refused in words), the four today's-app fixes, not filed | DEC 7, PLAN 2, CODE 4, DIR 7, OTH 7 | fold 0267 (type block) and 0269 (the missed rule); then delete |
| `next-is-a-pipeline-pre-run` | reasoning | in part: 0014, 0066, 0087; AGENTS.md prose | The steps rule itself (see Missed). The "Changed" history, the why (ticket 115's 22 gaps) | AG 1, DEC 5, AGT 2, PLAN 4, DIR 3, OTH 3 | fold: a new decision for the steps rule; history and why in its Context; then delete |
| `no-promises` | reasoning | in part: 0041, 0042, 0014, 0061 | The rule itself (see Missed). "Edges the owner has read" table, which 0014 says the lead adds to. The crypto `reason` ruling | AG 1, DEC 8, PAT 2, PLAN 2, CODE 4, DIR 3, OTH 5 | fold: a new decision for the rule and the crypto reason; edge table to pattern `effect-platform-wrapped-once`; rewrite 0014's link; then delete |
| `nobody-grades-their-own-work` | reasoning | in part: 0393 | Two rules (see Missed): the builder never judges; a judge is split into find, quote check, sort, code verdict | DEC 1, CODE 1, DIR 5, OTH 4 | fold: a new decision for the two rules; then delete |
| `nobody-writes-their-own-exam` | reasoning | in part: 0093, 0386, 0474, 0053, 0014 | The core rule and the exam list (see Missed). "What it does not stop", 2 points | AG 1, DEC 5, AGT 4, PLAN 1, CODE 2, DIR 14, OTH 7 | fold: a new decision for the rule and the exam list, "does not stop" in its Context; then delete |
| `object-classes-stay-thin` | reasoning | in part: 0041 (amends it), pattern `effect-services-and-layers` | The rule itself; 0041 says the note has no decision file. The why: mutation cannot reach inside workerd | AG 1, DEC 4, PAT 1, PLAN 2, DIR 2, OTH 2 | fold 0041: add the thin-class rule and its why; then delete |
| `oxlint-and-oxfmt` | study | 0021, 0029, 0039, 0040 (only format and tool-choice parts) | MISSED: six tool rules (oxlint and oxfmt only, stylelint for CSS, shape checks are lint, named ignore, no nested config, warning fails). "Why it can be trusted", "What it costs": the switch's parity read | AG 1, DEC 4, PLAN 1, DIR 2, OTH 1 | experiment `biome-to-oxlint-switch` for the parity read and costs, after a new decision holds the missed rules |
| `patch-upstream-locally` | reasoning | 0054 (read first), 0060 (issue carries patch), 0042 amendment (six Alchemy gaps) | MISSED: the base rule (never wait, `pnpm patch`, issue same day, delete on bump, a patch goes through the steps). Why, cost and "what would change" sections, 20 lines | AG 1, DEC 6, DIR 1 | fold into a new decision: the base rule, with Why and cost as its Context; then delete |
| `picker-guidelines` | guide | 0512, 0513, 0514, 0515, 0516 | MISSED details: 500-row cap, `>` and pipe chip, Up/Down wrap, one row in v1. Per-principle Linear, Elm and a11y reasoning (experiment 219 holds the reading); "Today: breaks"; tryout list; "Where this differs" | DEC 5, PLAN 1, DIR 3, OTH 3 | fold 0512, 0513, 0514: the missed details; reasoning is experiment 219's; then delete |
| `pipeline-guidelines` | guide | 0019 (P6 requirement), 0072 (P4 amendment), 0073 (clash 2 in `next/`), 0234 (P9) | MISSED: P1 to P8, P10 to P12 and the three Linear clashes, all owner-approved. "How a stop routes" table, the `End` sketch; experiment 186 holds the reading | DEC 6, PLAN 3, DIR 4, OTH 5 | fold into new decisions, about 6, one per principle group; the route table opens one; reading is experiment 186's; then delete |
| `popovers` | reasoning | 0509, 0510, 0511, 0460 | MISSED: asks popover keys (section 6) and Enter on an unshown ask. Section 2's Linear and standards reading; section 4 tokens and 5 shape (code holds them); section 8 doubts | DEC 4, CODE 9, DIR 13, OTH 6 | fold 0510 and 0511: section 6 keys and the Enter rule; section 2's reading goes to an experiment; then delete |
| `program-guidelines` | guide | 0103, 0109 (amend G6 only); 0480, 0491 touch the glance | MISSED: G1 to G8, calls 1 to 6, C1 to C11, the count label and the three splits, all decided. Shape sketch, ledger letters, tryout list; experiment 198 holds the reading | DEC 2, PLAN 2, DIR 9, OTH 6 | fold into new decisions, about 12 (G group, calls, C group, splits); reading is experiment 198's; then delete |
| `programs-run-in-a-box` | reasoning | 0026 (harness in the box), 0045, 0019, 0327 (login lent to one box) | MISSED: box around the program, no harness fence, `Sandbox` layers, Cmd wall, tools inside, app decides crossings, no key, boxed code, boxed triage. "Still open" list | DEC 3, CODE 1, DIR 13, OTH 10 | fold into new decisions, about 3; evidence is experiments 127, 128, 137; "Still open" becomes their "not decided"; then delete |
| `project-window` | reasoning | 0092 (keys reader only; cites the note in passing) | MISSED: P1 to P4 (welcome page, name is a switcher, Cmd-O box, frame draws and app opens), smaller calls table. Not built | DEC 1, DIR 1, OTH 2 | fold into a new decision for today's project window; reading is experiment 237's; then delete |
| `property-tests-not-our-own-search` | study | 0040 (existing tools), 0385 (TLA+), 0411 (data from schemas) | MISSED: our search engine fenced, list only shrinks, leaves in stages. Ship-port results (experiments 119 to 121, 139 hold them); "Stopped here" (history); demlik issue table | DEC 1, AGT 1, PLAN 1, CODE 2, DIR 4, OTH 4 | fold into a new decision for the fence; the rest is the experiments' and history; then delete |
| `recovery-key` | reasoning | 0328 to 0339 | "12. The attack stories" (~55 lines); call 4's window key in the same `added`; the refused-sheet-writes-nothing rule; test plan and size (P28 built them); known-way table is exp 216 | DEC 13, PLAN 2, OTH 6 | fold 0333 and 0331: write the two missed rules into 0333, the attack stories into 0331's Context; known way stays in exp 216 and 217; then delete |
| `rethink-do-not-port` | reasoning | none (0007, 0030, 0074, 0432 only cite it; AGENTS.md restates it) | The whole rule set: today's code is a map of jobs, not a shape; reason beside every choice; "The bar"; older issues and Tuval are evidence, not specs | AG 2, DEC 4, AGT 1, DIR 9, OTH 2 | fold into a new decision "rethink, do not port" (rules plus its 6-line Why), then rewrite the 9 direction and 4 decision links, then delete |
| `scheduled-jobs-on-the-host` | reasoning | 0385, 0422, 0423, 0424 | The rule that a job's false alarms are counted before it files tickets; the table of candidate jobs; Why, cost and the 70% doubt | DEC 4, DIR 8, OTH 4 | fold 0422: add the missed false-alarm rule and the jobs table to 0422; then delete |
| `settings` | reasoning | 0086, with 0069, 0079 to 0085 | Key spelling and env-name rule; byte-size spelling; `node/no-process-env` as advice; order A vs B vs C reasons; "Tier 1's choices" table (P38 plan input); TOML tool survey; lost designs | AG 2, DEC 17, PLAN 3, CODE 5, DIR 1, OTH 8 | fold 0086: add the three missed rules, the order reasons and the TOML survey to its Context; the Tier 1 table goes to P38's plan; then delete |
| `sweep-the-core-rebuild-the-pipeline` | history | 0217 (clean slate replaces the sweep); 0006 (dead code check) | "No limit on file size" (still stands, per the 2026-11-01 check); the code-graph 0.11 vs 0.12 count table that AGENTS.md quotes; the public-names gate left for the owner | AG 1, DEC 1, DIR 5 | fold 0006: the code-graph count goes in 0006's Context, the file-size rule into a new decision; the rest is archive |
| `the-plan-stage` | reasoning | 0380, 0381, 0382, 0383, 0384, 0385 | Section 6's name table (decided 2026-10-24): `CodeContext`, `draftPlan`, `PlanInput`, `WithIds`, `Usage`, `session`. No decision or glossary row holds it. The "Where today's code says otherwise" list and open items. | DEC 6, CODE 1, DIR 1, OTH 4 | fold: the name table into a new decision (or glossary rows) beside 0382; the evidence numbers fit 0380's Context. Then delete. |
| `the-test-writer` | reasoning | 0385, 0386, 0387; 0066 retires the mutant answers | The `[test_writer] includes` rule: only new files the list names, never edits a file, list copied at filing, a change asks the owner. Local commit on the base, ledger keeps its hash (0392 holds this only in part). "No login" in the box loses to 0026 and 0028. | DEC 3, CODE 7, DIR 4, OTH 3 | fold: `includes` into a new decision, or into 0386; then delete. Rewrite the 7 code links. |
| `use-the-industrys-names` | reasoning | 0212 (one word per idea); 0038, 0080, 0081, 0373 apply it | The base rule itself (lines 14 to 19), the `kid` to `child` example, the "moves or primitives" clash, the `ps` pick, "Why" 2 bullets | AG 1, DEC 4, PLAN 1, DIR 6, OTH 2 | fold into a new decision "a thing keeps the industry's name"; MISSED below; then delete |
| `we-follow-ddd` | reasoning | 0212 (one meaning per context), 0034, 0043, 0091 (modules) | The whole rule (lines 20 to 37); the inbox example; the path-to-context table; the Evans, Vernon, Fowler quotes | AG 1, DEC 3, PLAN 1, DIR 4, OTH 1 | fold into a new decision "we follow DDD, contexts and map in the glossary"; path table to the glossary; MISSED below |
| `what-a-ticket-shows` | reasoning | 0352 and 0015 (done), 0353 (top line, which replaced section 1), 0347 (lane facts), 0341 (only a person answers), 0390 (`started` and `ended`). No "decided rules" line: 0115 skipped it | Section 3, the live row (decided, no file); section 2's fact table and schema sketch; the Linear, Copilot, Devin reading; "Built so far" (history); section 4 dropped | DEC 2, CODE 3, DIR 7, OTH 2 | fold into a new decision for section 3 (live row, beats, dollars); built-so-far and section 4 to archive; MISSED below |
| `where-each-piece-lives` | history | 0126 (the from-scratch client test), 0095 (platform subpaths in `next/`) | The Ghostty framing, 3 lines; the 2026-10-17 to 10-25 package history; today's "pipeline uses only public names, platforms on subpaths", held only by AGENTS.md and lint | AG 1, DEC 4, PLAN 1, DIR 1, OTH 3 | fold 0126: Ghostty framing; history to archive; today's rule goes to a new decision first (MISSED) |

### Becomes an experiment write-up (6)

A measurement or a reading. `codex-box-home-listing`'s "What is weaker" section and `secrets-are-redacted`'s gap list go to the private archive, since a list of gaps stays out of the public repo.

| Note | Kind | Rules held in | Left that nothing holds | Links in | Move |
|---|---|---|---|---|---|
| `codex-box-home-listing` | study | none; experiment 152 names `homeFence` in one line | Everything: the two-character table, cost table (711 vs 127 lines), size limits table, `fenceTooBig`; "What is weaker" reads as a hole list | CODE 2 | experiment: `NNN-codex-box-closes-home-entries`; "What is weaker" goes to the private archive, not the public repo |
| `effect-fn-for-traced-functions` | study | 0252 | `effectFnOpportunity` count (17 findings, 65% false), Effect docs quotes, `ledger.call` lean (owner to check, 50%) | DEC 1, PAT 3, PLAN 1, DIR 2, OTH 1 | experiment: `NNN-effect-fn-opportunity-count`; then delete |
| `how-we-get-work-done` | reasoning | 0127; evidence in experiment 250 | Each principle's "Linear as the builder" and "Elm or OTP" lines (experiment 250 has none). 0127 links the note's loop and words tables, which match experiment 250 Parts 1 and 8 | DEC 2, OTH 2 | experiment: add the Linear and Elm/OTP lines to experiment 250 Part 7, point 0127's links at Parts 1 and 8, then delete |
| `skills-hold-only-judgment` | study | 0408, 0409, 0410, 0411 | "K6's replay" (20 PRs, 0 of 20 refused) and "K20's census" (6-row table, 0% false hits), plus "What this cannot tell us" | DEC 4, PLAN 1 | experiment: `NN-leak-check-replay-and-schema-arbitrary-census.md`; then the 4 decisions link it and the note is deleted |
| `tile-guidelines` | study | 0499, 0500, 0501, 0502, 0503, 0504 (with 0477, 0492, 0493) | "What Linear does" reading; the two contrast tables; the color-blind simulation; the how-sure table; per-part "Breaks" lists and the cost table, both about code at one old commit | DEC 6, PLAN 4, CODE 6, DIR 8, OTH 7 | experiment: `NN-tile-guidelines-study` takes the Linear reading, contrast and color-blind numbers, how-sure table; Breaks and cost go to archive |
| `ui-on-manti` | study | 0461, 0462; section 6's clashes are answered by 0510 | Section 2 fit table (license, React, types patch, +130 KB bundle, CSS 87 to 281 KB); section 3 reset CSS and dark-first note; section 5 PR split (PR 1 built, 2 and 3 not). 0461's Consequences still call the clashes proposed | AG 1, DEC 2, PLAN 2, CODE 4, DIR 10, OTH 2 | experiment: `NN-manti-fit-reading` takes section 2 and the bundle numbers; the split goes to docs/plan; then delete |

### Becomes a pattern doc (3)

How the code is shaped now. `effect-code-guidelines` and `new-combos` also hold 5 missed rules, written first.

| Note | Kind | Rules held in | Left that nothing holds | Links in | Move |
|---|---|---|---|---|---|
| `effect-code-guidelines` | guide | 0120, 0118, 0119; patterns for E1, E2, E3, E5, E6, E8 | E4 and E7 before/after blocks (no imports-and-ids pattern); "Smaller calls"; fix order; cost table. MISSED, below | DEC 1, OTH 3 | pattern: `effect-imports-and-ids.md` (E7), E4 into `effect-state-and-time`; smaller calls folded into 0120 |
| `new-combos` | shape | none; 0079 answers one open point | The six combos (Rate, Controls, Brief, Poll, ask grown, guarded files grown) and their sketches, built in `packages/pipeline/src/`. Open: ratings before blocking, Poll's clock | DEC 1, CODE 5, DIR 2, OTH 1 | pattern: `pipeline-combos` (today's version); the four missed rules fold into a new decision; then delete |
| `the-frame` | shape | 0490, 0491, 0492, 0493, glossary Frame section | The four part tables: 50 parts, each with industry word, source link and today's `file:line`. "Nobody decides these yet" (12 part words, proposed). Open: is a popover footer pressable; `%3` vs tmux pane ids. | DEC 6, PLAN 1, DIR 5, OTH 1 | pattern: `.patterns/frame-parts.md`, today's app frame mapped to code, diagram first. The 12 proposed words go to the glossary's open clashes. |

### Goes to the private archive (6)

History nothing builds from. Their decided parts, if any, are already in decision files.

| Note | Kind | Rules held in | Left that nothing holds | Links in | Move |
|---|---|---|---|---|---|
| `a-canvas-per-work` | history | none; per-step harness and model as settings is 0325 and 0069 | A vision, not planned: the canvas sketch, "the canvas builds tea machines only", the fixer idea, "Open" list | DIR 2 | archive: a vision nothing builds from; links from `design-language` and `agents-behind-one-service` go |
| `an-input-can-take-anything` | shape | none; built in today's code (`shape.ts`, `check.ts`, trace's `any`), header still says proposed | `anyInput` and the `takes_any` fit rule, its Elm and Unix table | OTH 1 | archive: today's code and its tests hold it, and nothing in `next/` builds from it |
| `clean-slate` | history | 0217, 0218, 0219; 0016 (supervisor carried over) | "What happens to each part" size table, the first order sketch with leans, "wrong, kept as the record" lines | AG 1, DEC 3, DIR 3, OTH 1 | archive: rules in 0217 to 0219; the table and order are history |
| `free-form-plan-to-planner` | history | 0222 | Reading of today's plan step (table), "route not taken", rerun by hand | DEC 1, PLAN 2, OTH 2 | archive: rules in 0222; the reading is history |
| `the-checker-is-a-tea-package` | history | none (dropped 2026-10-23) | Nothing builds from it. The "never sent" check idea (a suite fails when a Msg type is never sent) and experiment 119's numbers; 119 holds the numbers. | DIR 1 | archive: dropped note, replaced by property-tests-not-our-own-search. |
| `the-gui-is-electron-first` | history | 0439, 0442, 0443, 0444, 0445, 0446, 0447 | Build findings already held by experiment 141 (tiles table) and `apps/fabrika/README.md` (socket, NDJSON, run as Node). Left: the replaced terminal-window proposal, ghostty-web costs, "Later" list, the open link-retry and start-race items. | DEC 7, CODE 1, DIR 11, OTH 1 | archive: rules in 0439 and 0442 to 0447, numbers in experiments 141 and 150, shape in the app's README. Rewrite the one code link. |

### Owner, question 1: long reasoning that fits no short decision file (5)

| Note | Kind | Rules held in | Left that nothing holds | Links in | Move |
|---|---|---|---|---|---|
| `a-local-first-sync-engine` | proposed | 0016, 0018 (supervision), 0051 (names), 0322 (T5), 0225, 0204/0038 (spans); OTP differences in `follows/otp.md` | Layer 1 T1-T4, T6-T8; Layer 2 D1-D6; C1-C3; ephemeral lane; "two places for records"; per-object size; "The picture", "The hard part", "Open" (vision); W3C `traceparent` still proposed | AG 1, DEC 8, PLAN 4, CODE 2, DIR 20, OTH 10 | owner: about 25 decided transport, data and coordination rules have no file (MISSED); the vision goes to archive |
| `the-cloud-is-one-more-host` | proposed | 0423 (one alarm), 0083, 0084, 0085 (packs), glossary (brain, hands) | Two decided walks (brain and hands, 2026-10-30; app layer A1 to A5, 2026-10-31) have no decision file and no "Its decided rules" line. Plus the 2026-10-27 host draft and the seven-question table, all proposed. | DEC 5, PLAN 3, DIR 8, OTH 6 | owner: many MISSED rules, some clash (LimitManager vs 0029's plural names; A5's re-ask already overruled). Write them, archive the draft. |
| `themes` | guide | 0009 (imported grays only); 0069 links it | Almost every decided rule: home config, file per theme, TOML, two ways in, `themes` program, `-fabrika` rename, built-ins, text tokens, `theme-fix` nudge, contrast floors, Radix primitives. Proposed points 1 to 3 and the picker's name. | DEC 2, AGT 1, PLAN 4, CODE 9, DIR 10, OTH 6 | owner: about 20 MISSED rules to write; points 1 to 3 still proposed; numbers fit experiment 177. |
| `summon-guidelines` | proposed | 0518, 0289, 0514; 0073 cites R1, R2, R5 but does not hold them | S1 to S7 (proposed); decided but unheld: summon grammar, desk not tile, T1, T6, R1 to R5, no message numbers, fork picker, Ctrl-C and Ctrl-Z keys, A2 to A5 | DEC 2, CODE 3, DIR 2, OTH 5 | owner: write the decided parts as decisions now; the seven principles wait on the Tier 5 walk |
| `talk-where-you-work` | proposed | 0518, 0521, 0517; 0073 cites "no chat program" | Proposed: talk by a presence label, the box keys, accessibility. Decided but unheld: no chat program, spot talk, network allow list, hidden files, harness words, summon in next/, hands order | DEC 1, PLAN 4, CODE 1, DIR 5, OTH 4 | owner: write the decided parts as decisions now; the spot and box rules wait on the Tier 5 walk |

### Owner, question 2: proposals waiting on a tier walk (12)

| Note | Kind | Rules held in | Left that nothing holds | Links in | Move |
|---|---|---|---|---|---|
| `a-review-list-can-only-shrink` | proposed | none; not decided, walked at Tier 6 | The idea, the `stopAt` choice, the four ways in, the Finding sketches; numbers are experiments 54, 57, 58 | DIR 1, OTH 2 | owner: a proposal with open calls; lean to fold it into experiment 58 as its design input |
| `agents-are-programs` | proposed | none; walked at Tier 5 | The whole proposal: `claude` and `codex` programs, `--schema` in and decode at the step, start by name, the `tty` bit; measures are experiment 169's | PLAN 1, DIR 3, OTH 4 | owner: a proposal with a Tier 5 walk; lean to fold it into experiment 169 |
| `customization` | proposed | 0480 (C3, C4, the look in place) | C1 one glance slot (65%), C2 a program never adds itself to the bar (70%), C5 where a tile opens (70%), ledger section | DEC 1, DIR 1, OTH 1 | owner: C1, C2 and C5 are leans |
| `errors-are-diagnostics` | proposed | 0120 E2 and 0119 (typed errors) | `Diagnostic` shape, `Drawing` service, explain pages, snapshot per code, Effect table | PAT 1, DIR 2 | owner: whole design undecided, walked at Tier 2 |
| `every-finding-is-rated` | proposed | 0035 (unrated counts as noise once shipped) | SARIF-shaped finding, closed rule list, matching across rounds, "the click is the route", "Still open" | DEC 1, CODE 1, DIR 6, OTH 5 | owner: shared shape undecided, walked at Tier 6 |
| `packs-are-programs` | proposed | 0068, 0075, 0083 (the decided "where packs live" part, in its current form) | "The idea" (core plus packs, three ways to plug in), the ui-verification pack example, "What would change it"; experiment 89 already holds the first test | DEC 3, PLAN 1, CODE 2, DIR 2, OTH 3 | owner: Tier 7 proposal, undecided |
| `pipeline-strategies` | proposed | none (0071, 0072, 0367 only cite it) | All of it: the four strategies, the undoable or lasting line, three open questions | DEC 3, PLAN 2, DIR 2, OTH 3 | owner: Tier 6 proposal, nothing settled |
| `shared-tiles` | proposed | 0517 to 0521 | "The rules (proposed)", 5 rules whose wording is unsettled; the Accessibility list (4.1.3, 2.3.3, 3.2.x); the walked-back orange hue, history | DEC 6, PLAN 2, DIR 2, OTH 3 | owner: the five rules wait on the Tier 5 walk |
| `tracker-views-are-programs` | proposed | 0350, 0351, 0352, 0353, 0354, 0355 | Sections 1 to 3 (ticket 43, the Linear and GitHub reading, the Elm answer); 4's clash table; 5.2 to 5.6 page parts; 6 hand-run agents post `started`, `link`, `ended`; 8's fold refusals; 9 build order; open questions 2 to 4 | DEC 7, DIR 5, OTH 4 | owner: walk set for Tier 2; lean is to make the undecided rest an experiment |
| `windows-in-next` | proposed | none. 0080 only links it | The decided `verify` and `seal` rename and the OS on the hello (built, no file); the proposed `next-windows` CI job, the stop-by-stdin pipe and agents off on native Windows; the 320-line guess | DEC 1, PLAN 2, DIR 1, OTH 1 | owner: walk set for Tier 4; the rename becomes a decision first (MISSED) |
| `services-and-our-own-ci` | proposed | 0112 holds "CI stays free, own machines deferred"; 0231 holds Ledger vs CodeHost | The decided "every edge is a typed service, even with one Layer" and "`Ci` leaves `CodeHost`"; the whole own-CI design (join, lease, signed results, boxes), a reading of 8 systems | DEC 2, PLAN 1, DIR 3, OTH 2 | owner: write the two missed rules as a decision; the own-CI design becomes an experiment write-up as a deferred reading |
| `one-fabrika-toml-per-repo` | proposed | 0069 (load rules, edge read, run copies settings), 0083, 0084, 0085, 0086, 0132, 0234 | MISSED rules (one spelling, `~/.fabrika` home, old run keeps its rules, empty pick refused); "Proposed, for monorepos" (`extends`, trust); pack "Open" list; "Where the code is" (today's shape) | DEC 8, PLAN 1, CODE 4, DIR 10, OTH 8 | owner: write the missed rules as a new decision; "Where the code is" becomes pattern `settings-file`; the monorepo proposal needs a home |

### Owner, question 3: proposals nobody took up (6)

| Note | Kind | Rules held in | Left that nothing holds | Links in | Move |
|---|---|---|---|---|---|
| `every-wait-is-a-queue` | proposed | glossary (`<pid>/dead`), 0482 (asks in one queue) | Queue as a ledger view, readers per queue, per-stage caps; today's dead-letter pack (2026-10-20) | CODE 1, DIR 3, OTH 3 | owner: retire or keep for Tier 6 |
| `experiments-behind-a-service` | proposed | 0218, 0027 | `Experiments` service sketch, programs table, money combo, gaps list | CODE 2, DIR 1, OTH 1 | owner: archive the proposal |
| `fabsh-grows-into-a-language` | proposed | none | The whole vision: grammar, highlighting, completion from the desk | DIR 2 | owner: a vision walked at Tier 5 |
| `tea-program` | proposed | 0433, 0434, 0435, 0436, 0437, 0438, 0439, 0440, 0441 | The note is still "Proposed" for today's version: pipe acks and outbox, ids down a pipe, `call`, one live copy per id, run as a span, fit widening, the "Why" and "What it costs" lists, the dropped first shape. Today's code is its only other home. | DEC 10, CODE 1, DIR 11, OTH 10 | owner: undecided parts of a today's-version API that `next/` replaced with `Program.make` (0256). |
| `the-ledger-goes-to-cloudflare` | proposed | 0051, 0283, 0284, 0285, 0286, 0287, 0288, 0289, 0290 | Leans never decided but built: door stamps every writer, agent `Grant`, `PersonOnly` kinds (section 2); members facts (4); doorbell tail and away state (5); talk's three rules (10). Cost table (7), the proof branches (1), section 9's split cost. Scope for `next/` unsettled (experiment 271, item 20). | DEC 9, PLAN 2, CODE 3, DIR 13, OTH 9 | owner: settle scope, then archive; cost table and proof study fold into experiment 144. |
| `ship-stage-rules` | reasoning | none; 0049 and 0097 hold only "behind main ships as it is" | All other rules: closed or draft PR is a skip; comment routing by writer; red checks rerun once per head; pending and queue waits have limits | DEC 3, DIR 3, OTH 3 | owner: today's ship is paused and the merge queue (0107, 0110) replaces it, so archive or write as a decision |

### Owner, questions 4 to 17: one real call each (14)

| Note | Kind | Rules held in | Left that nothing holds | Links in | Move |
|---|---|---|---|---|---|
| `agent-hours` | reasoning | 0388, 0389, 0390; evidence in experiment 187 | H4's "over 8, split before the build" (not in 0389); the name table; per-principle OTP and Linear notes; the PR 267 trace | DEC 3, PLAN 5, DIR 6, OTH 7 | owner: the split-over-8 rule may clash with 0099; the rest folds 0388 (name table) and deletes |
| `an-agent-run-keeps-its-content` | proposed | none; 0030 links it as proposed, walked at Tier 5 | The whole proposal: a `content` table beside spans, mask then delete, only a person deletes, 64 KB to `Blobs`; AGENTS.md's "content stays deletable" cites it | AG 1, DEC 1, PLAN 1, CODE 7, DIR 7, OTH 3 | owner: undecided, but AGENTS.md already leans on it |
| `autonomy-is-measured-trust` | proposed | 0014 (merge never waits), 0486 (M5's `needed` mark) | M1 to M4 measures, `MergeRow`/`BrokeRow` sketch, "The known way" (DORA, SRE budgets). MISSED rule, below | DEC 3, AGT 1, PLAN 2, DIR 3, OTH 3 | owner: M1 to M4 undecided; the trust rule needs a decision |
| `code-commits-and-signs-each-step` | proposed | 0098 changed rule 5 only | Rules 1 to 5 with leans; evidence table (21 signing problems); rule 1 walks back a decided line | DEC 1, AGT 1, OTH 1 | owner: rule 1 walks back "each agent signs with its own key" |
| `fast-and-daily-mutation` | proposed | 0066, 0067, 0077, 0106; experiment 181 | `next/` queue (decided 2026-11-01): `Gap` id, ticket per symbol, DO alarm, hands run Stryker, weak-test short path; CI times table. MISSED, below | DEC 4, AGT 2, PLAN 3, DIR 2, OTH 8 | owner: per-symbol tickets clash with 0066's per file |
| `inputs-carry-their-sender` | proposed | 0261, 0262, 0263 | 0261 says still proposed: a client-sent `id` or `by` is refused and recorded; a write with no cause is `own`. Also the "why the cause rides in the data" trace, the two-envelopes name clash | DEC 4, PLAN 3, DIR 4, OTH 6 | owner: the two proposed rules; then fold 0261 (trace block) and delete |
| `keys-editor` | proposed | 0496, 0497, 0498 | E3 record in the row (85% lean), E6's lean part, E7's edge law (3px, 6 per channel), smaller calls 1 to 3 (60% to 75%). Experiment 233 has the study | DEC 3, DIR 3, OTH 2 | owner: are the leans decided? Then fold 0496 and delete |
| `layers` | proposed | 0264, 0265, 0266 | "What the ledger records" (proposed, not walked), call 8 "is a side panel a program?" (open), call 1's build order, the `Frame` sketch | AG 1, DEC 7, PAT 2, PLAN 2, DIR 9, OTH 7 | owner: the ledger facts and call 8; then fold 0264 and delete |
| `one-ask-and-one-meter` | proposed | in part: 0343, 0341, 0418, 0073 | Most decided rules (see Missed). Open: does a subscription run still need a spend yes. The two inventories (5 ask places, 7 money places), the branches block | DEC 3, DIR 6, OTH 11 | owner: the open spend call; then fold new decisions for the missed rules, inventories to an experiment, delete |
| `principles` | reasoning | 0339 (only "for building, not enterprise security"), 0069 (cites principle 5) | MISSED: the five principles (2026-11-08), with each one's "breaks it" test and principle 4's WCAG-twin table. "Other candidates" (proposed) | DEC 5, AGT 1, PLAN 5, DIR 15, OTH 6 | fold into a new decision "fabrika's five principles"; owner rules on "Other candidates"; then delete |
| `smallest-ledger-proof-to-grow` | reasoning | 0216 (shape, ids); 0346 drops the "left out until proven" list for the tracker | The starting list of six; "Nothing is added without proof", which 0216 leaves open against record wide; Why, 2 lines | DEC 2, CODE 2, DIR 5, OTH 2 | owner: is the proof-before-growth rule withdrawn? Then delete |
| `the-host-keeps-terminals-and-jobs` | reasoning | 0448 | "The layout is the app's" (decided 2026-10-28, line 66) is not in 0448, which says layout is not decided. Doubts with leans (close detaches, `jobs` lists all, ended terminal keeps jobs). "A job names its owner" is proposed but built in `apps/fabrika/src/tiles.ts`. | DEC 2, CODE 2, DIR 4 | owner: MISSED rule clashes with 0444 (layout on the host's ledger). Rest can go once that is settled. |
| `ui-verification` | proposed | 0469, 0470, 0471, 0472, 0473, 0474, 0475, 0476 (reading in experiments 191, 192) | "The smaller calls" C1 to C6, with C6 having no lean; the `ui_checked` row's lost-forever list; the tryout list; the cost | DEC 8, DIR 1, OTH 2 | owner: C6 is open; C1 to C5 leans fold into 0470 and 0473 Consequences |
| `one-parent-stages-as-slots` | history | none | MISSED: one parent, steps as its children (2026-10-22). Slot and swap bullets, "Suggested order", open questions: today's paused pipeline | DIR 3, OTH 2 | owner: write "one parent, steps as children" as a decision, then archive the rest |

### `follows/`, kept by 0017 (4)

0130 does not name `follows/`; it only says `docs/direction/` is removed once empty. So it moves the tables only by implication, and 0017's rule (one table per model, one row per behavior, updated in the same pull request) stands. Question 18 asks where they go. The README's counts are stale: it says Kubernetes has 11 rows and 10 differ, and the file has 13 and 12.

| Note | Kind | Rules held in | Left that nothing holds | Links in | Move |
|---|---|---|---|---|---|
| `follows/README` | shape | 0017 (the table rule, the four columns, the not-yet-decided DDD, Linear, tmux and i3 tables) | The index table's row counts, which are stale: it says Kubernetes 11 rows and 10 differ, and the file says 13 and 12 | AG 1, DEC 2, PLAN 0, PAT 0, AGT 1, CODE 0, DIR 1, OTH 1 | owner: lean `.patterns/follows/README.md`, with the counts fixed and 0017's path amended |
| `follows/elm` | shape | 0017 (the shape); each row cites its own decision or `path:line` | The 12-row table itself, a living comparison against code at `5b1171ed` | AG 0, DEC 1, PLAN 0, PAT 0, AGT 0, CODE 0, DIR 1, OTH 0 | pattern: `.patterns/follows/elm.md`, after the owner's yes on the README row |
| `follows/kubernetes` | shape | 0017 | The 13-row table; its "Coming: 0016" line | AG 0, DEC 2, PLAN 0, PAT 0, AGT 0, CODE 0, DIR 1, OTH 0 | pattern: `.patterns/follows/kubernetes.md`, after the owner's yes |
| `follows/otp` | shape | 0017; rows draw on experiment 239 | The 28-row table; its "Coming: 0016" line | AG 0, DEC 6, PLAN 0, PAT 0, AGT 0, CODE 0, DIR 2, OTH 1 | pattern: `.patterns/follows/otp.md`, after the owner's yes |

## The order to remove them in

Nothing starts before the owner has seen this count and the questions (0130). Every pull request
below removes notes and, in the same pull request, rewrites every link to them, removes their rows
from `docs/direction/README.md`, and carries 0130's table: one row per removed note, saying where
each part went. Links are counted in files that link a note; the glossary alone links notes 212
times.

1. **Delete now, 21 notes.** One docs pull request. About 175 linking files, 17 of them code. Each
   link points at the decision that holds the rule. `pin-exact-versions`' link sits in a lint error
   text and must point at 0255.
2. **Fold into existing decisions, 34 notes.** Three docs pull requests, by decision range: data,
   Effect, programs and storage (0200 to 0295); security, the tracker and the pipeline (0320 to
   0424); today's runtime and the UI (0430 to 0521). About 550 linking files, 83 of them code.
3. **The missed rules, 46 notes.** The 0115 move again, for 159 flags, by the same seven subjects
   and number ranges reserved first. Each pull request writes the decision files and removes the
   notes they empty. Start with the ones `next/` builds from every day: `done-is-per-criterion`,
   `elm-first`, `no-promises`, `nobody-writes-their-own-exam`, `next-is-a-pipeline-pre-run`,
   `rethink-do-not-port`, `pipeline-guidelines`, `programs-run-in-a-box`. About 750 linking files, 85
   of them code.
4. **Experiments, patterns and the archive, 15 notes.** One pull request per kind. Archived notes
   leave the repo; a link to one points at the last commit that holds it, as 0027 does for results.
5. **The owner's 37, after his answers.** Question 1's five notes each get their own pull request,
   since each is 400 to 900 lines. Questions 2 and 3 can go as one pull request each. Questions 4 to
   17 ride with the subject pull request of step 3 that their note belongs to.
6. **Last: `follows/`, the README and the folder.** Move `follows/` as question 18 says, delete
   `docs/direction/README.md`, remove AGENTS.md's direction rows and change the adr and guidelines
   skills, as 0130 and 0129 say. Then the folder is gone.

## What this read cannot tell us

- **Whether a held rule is held in the same words.** Readers checked that a decision covers a rule,
  not that every word matches. A row that says "delete" can still lose a nuance. The writer of each
  pull request reads the note once more against its decisions.
- **Whether the missed rules are still true.** 258 flags are what the notes say was decided. Some
  may be moved past by a later decision or by the code; 0115's writer drops those, with the reason.
  Several clash already: `agent-hours` with 0099, `fast-and-daily-mutation` with 0066,
  `the-host-keeps-terminals-and-jobs` with 0444, `a-unit-of-work-is-a-commit` with
  `code-commits-and-signs-each-step`.
- **How link rewrites in code land.** About 240 links sit in code comments, mostly today's
  `packages/pipeline`, `apps/fabrika`, `programs/tracker` and `oxlint-plugins`. Product code keeps
  its pipeline steps. Whether a comment-only link rewrite in product code needs them was not
  settled here.
- **Links to an archived note.** No link checker runs in `pnpm lint` today, so a dead link is
  caught only by hand. A link from an old experiment or a field row to an archived note would need
  a commit link, and that is many files.
- **How many decision files the missed rules become.** The readers' guesses add up to about 100 to
  130 new files, more if the five long notes split finely. A rule the title would hide gets its own
  file (0115), so the number grows with care.
- **Small things the readers found on the way:** `an-input-can-take-anything` still says proposed,
  but `anyInput` is built in today's code. 0254 still says the cluster idea returns "in a note",
  which 0130 ends. 0461's Consequences still call the Manti clashes proposed, but 0510 answers
  them. 0327 lacks "our Worker never sees a real token".
- Agent time only, $0; tokens were not recorded.

## The missed rules

One line per flag, as each reader wrote it, with the note and its line at `67864f7bf`. A flag may
name a group of rules. This is the input to step 3 above, and to the owner's notes once he answers.

- `a-browser-is-always-a-client` line 32: No protocol needs Node, Unix socket, files or WebSocket frames.
- `a-browser-is-always-a-client` line 38: Check every design: could a browser tab be this client?
- `a-browser-is-always-a-client` line 47: Liveness is a text "ping" answered "pong", never ping frames.
- `a-job-record-holds-its-trace` line 247: A step row shows tokens; dollars only per lane, "no list price".
- `a-job-record-holds-its-trace` line 250: The ticket view colors by state, each with its words beside.
- `a-job-record-holds-its-trace` line 255: `asked` names its lane's trace; step spans carry lane, step, outcome tags.
- `a-local-first-sync-engine` line 176: Central first: every client reads from the one ledger.
- `a-local-first-sync-engine` line 222: The ephemeral lane: show it, never save it, never decide with it.
- `a-local-first-sync-engine` line 287: T1, the client always dials the brain, never the reverse.
- `a-local-first-sync-engine` line 290: T2, one WebSocket per client to its own gateway; only visible tiles stream.
- `a-local-first-sync-engine` line 301: T3, every window dials the brain; the brain checks the page's origin.
- `a-local-first-sync-engine` line 320: T4, brain speaks current and previous versions; changes inside are additive only.
- `a-local-first-sync-engine` line 332: T6, text ping every 30 s; presence reads last ping, away after 75 s.
- `a-local-first-sync-engine` line 335: T7, retry once, then jittered backoff capped at 30 s; catch up by rev.
- `a-local-first-sync-engine` line 338: T8, messages are JSON-RPC 2.0; err is `error.data` reason.
- `a-local-first-sync-engine` line 401: D1, the project object referees a claim: compare-and-set plus a lease.
- `a-local-first-sync-engine` line 407: D2, one log per project, with named streams inside it.
- `a-local-first-sync-engine` line 409: D3, each entry kind grows additively; readers skip unknown kinds and keep them.
- `a-local-first-sync-engine` line 414: D4, poke then pull; a lost poke costs nothing.
- `a-local-first-sync-engine` line 424: D6, every table but the log is a view rebuilt from it.
- `a-local-first-sync-engine` line 474: C1, a limit stop writes charge, exit and parent mail in one write.
- `a-local-first-sync-engine` line 478: C2, at-least-once mail; after N crashes, a letter moves to `<pid>/dead`.
- `a-local-first-sync-engine` line 488: C3 in `next/`: 30 s lease renewed every 10 s; renews never in the ledger.
- `a-local-first-sync-engine` line 192: Raw measurements kept about 2 weeks; hourly metrics kept forever.
- `a-local-first-sync-engine` line 210: Each object records its own size about hourly, only when awake.
- `a-ticket-runs-from-the-app` line 9: Filing a ticket starts its lane; no start button; plan approval stops first.
- `a-ticket-runs-from-the-app` line 12: The person is the assignee, their agent the delegate; turn is a fold.
- `a-unit-of-work-is-a-commit` line 44: The unit is the commit; an exam change is its own non-builder commit.
- `a-unit-of-work-is-a-commit` line 46: The test writer's commit comes first on the branch and may touch exam paths.
- `a-unit-of-work-is-a-commit` line 48: Code signs each step's link with that step's key, at the lead's fetch.
- `a-unit-of-work-is-a-commit` line 54: The signature goes in a git note on `refs/notes/fabrika`, not the commit.
- `a-unit-of-work-is-a-commit` line 73: A commit trailer is for people; CI never reads it.
- `a-unit-of-work-is-a-commit` line 86: Step public keys live in an allowed-signers file, itself an exam path.
- `a-unit-of-work-is-a-commit` line 98: A person signs with git's own SSH commit signing, no note.
- `a-unit-of-work-is-a-commit` line 114: Squash merges stay; each step signs a tree-to-tree link instead.
- `a-unit-of-work-is-a-commit` line 146: Links go to the ledger; no transparency-log server.
- `agent-hours` line 184: Over 8 agent hours, the ticket splits before the build (may clash with 0099).
- `agents-behind-one-service` line 140: Our Worker never sees or adds a person's real model token.
- `agents-run-on-codex` line 28: Step agents run on Codex; the main and lead session stay on Claude.
- `agents-run-on-codex` line 33: Today's triage default stays on opus until experiment 159 answers.
- `agents-run-on-codex` line 60: A Codex step commits in its own clone; the lead only fetches from it.
- `agents-run-on-codex` line 71: A step whose laws or shots need Electron runs on a Claude agent.
- `autonomy-is-measured-trust` line 37: trust is earned by measured checks, never a feeling or setting.
- `autonomy-is-measured-trust` line 40: each break names the step that missed it; that step is fixed next.
- `backend-as-a-library` line 52: build the fake first; every outside service has a scripted version first.
- `color-principles` line 18: the eight color principles (quiet, one meaning, never alone, Radix steps...).
- `color-principles` line 70: text uses only step 12 and one low step, never a third gray.
- `color-principles` line 86: a border or fill token is never a text color.
- `color-principles` line 109: accent on at most one control per view, only while waiting.
- `control-in-code` line 11: code holds the loop; an agent does one bounded job inside it.
- `control-in-code` line 62: test a rule against real agent moves before settling it (AGENTS.md only).
- `done-is-per-criterion` line 7: a criterion is open or met; met means a review saw it at head.
- `done-is-per-criterion` line 12: criteria change only as ticket events; a reworded one reopens.
- `done-is-per-criterion` line 21: no deviations; a declared limit never turns an unmet criterion into a pass.
- `done-is-per-criterion` line 27: no round cap; stall rule plus wobble rule ask the owner.
- `done-is-per-criterion` line 44: a merge takes only a ReadyToMerge proof per criterion at head.
- `done-is-per-criterion` line 82: a plan with several tasks ends in one PR, reviewed per task.
- `done-is-per-criterion` line 112: a stuck task leaves a plan only when the owner removes it.
- `effect-code-guidelines` line 471: two lint rules give way to Effect's; nine shipped checks stay off.
- `elm-first` line 8: name Elm's answer first; anything bigger needs a written reason.
- `elm-first` line 14: parents are written by hand; no pipeline language inside tea.
- `elm-first` line 28: no late-bound dispatch; an agent run inside a machine is a Sub.
- `elm-first` line 44: an exception to Elm is allowed only when named with its reason.
- `elm-first` line 59: the factory is one thin coordinator program, never a tsh line.
- `elm-first` line 70: every piece of window state lives in a tea machine, never `useState` (AGENTS.md only).
- `every-machine-has-laws` line 50: a machine with no laws fails the test suite.
- `every-update-builds-every-layer` line 41: a pass is done only when it runs in a tab, Electron, laptop and Cloudflare.
- `every-update-builds-every-layer` line 55: only styling, Markdown drawing and MCP tools are copied, naming source and commit.
- `fast-and-daily-mutation` line 212: a gap's id hashes file, symbol, mutator and text, never a line.
- `fast-and-daily-mutation` line 244: a weak-test ticket takes a short path with no builder.
- `five-steps-for-every-check` line 21: every check follows five steps, ending in a fingerprinted coverage record.
- `five-steps-for-every-check` line 55: every law is a property in both versions, fixed tests only under four labels.
- `five-steps-for-every-check` line 91: the plan names each law's generator or label; review checks it fits.
- `jev-same-answer-cheaper` line 51: 0.8 is the usual floor, not one floor for all.
- `jev-same-answer-cheaper` line 59: a narrow Jev question may read a wide input; code ranks.
- `jev-same-answer-cheaper` line 62: tracing what must change is a typechecker's job, not Jev's.
- `jidoka-and-andon` line 47: the pipeline asks a person only for a judgment, else self-fixes.
- `jidoka-and-andon` line 53: a stuck lane restarts from the broken step, keeping finished steps.
- `jidoka-and-andon` line 59: a person's stop is a saved pause; only close or not-yours ends.
- `jidoka-and-andon` line 62: a person steers by ticket comment, read next turn, with `during`.
- `jidoka-and-andon` line 179: code runs checks after every build; done only on green checks.
- `jidoka-and-andon` line 185: red goes back to the builder by default; `send_back` setting.
- `jidoka-and-andon` line 212: typing the same pipeline line again restarts a stuck lane.
- `keybindings-are-configurable` line 46: every binding is data; person's rows lay over defaults.
- `keybindings-are-configurable` line 56: keys live in `~/.fabrika/keybindings.toml`, TOML, not in fabrika.toml.
- `keybindings-are-configurable` line 71: fabrika ships a built-in key editor program named `keys`.
- `keybindings-are-configurable` line 106: Tier 1 reads the key file; the keys program is Tier 2.
- `keybindings-are-configurable` line 115: the prefix is a setting; bindings write `<prefix>` for it.
- `keybindings-are-configurable` line 128: one flat list, command to key, a tryout; empty list unbinds.
- `keybindings-are-configurable` line 157: the load refuses six named cases, each with a plain reason.
- `keybindings-are-configurable` line 236: a mode section is `[mode.<program>.<mode>]`; no built-in short form.
- `keybindings-are-configurable` line 261: every command is `<program>.<word>`; prefix, mode, ignore are reserved.
- `keybindings-are-configurable` line 340: keys and modes come from programs; tile keys scoped by focus.
- `keybindings-are-configurable` line 353: a pack never takes an app key, the prefix or F6.
- `keybindings-are-configurable` line 357: two packs on one global key both lose it, named.
- `keybindings-are-configurable` line 490: the eleven decided leans (spelling, ignore, clash, bad file, matching, and more).
- `keybindings-are-configurable` line 539: a key a backend cannot have is off in that window only.
- `local-is-the-cloud` line 6: a cloud piece lands with its local twin in the same pull request.
- `local-is-the-cloud` line 10: design from the local runtime first; never `Alchemy.remote()`.
- `local-is-the-cloud` line 61: lint fails on a stack resource with no local provider.
- `modes` line 186: a mode's tsh word typed outside its mode is refused in words.
- `new-combos` line 22: no new move; six combos named and built now, before stages.
- `new-combos` line 51: a rating counts only when a user wrote its ledger row.
- `new-combos` line 57: each rule says what an unrated finding means, with no default.
- `new-combos` line 134: Poll writes a fact only when the read changed.
- `next-is-a-pipeline-pre-run` line 7: every pull request goes through plan, tests, build, one review, each its own agent.
- `next-is-a-pipeline-pre-run` line 11: `next/` does not wait on the pipeline; today's pipeline programs are paused.
- `next-is-a-pipeline-pre-run` line 46: no builder starts before an approved plan and tests that exist.
- `next-is-a-pipeline-pre-run` line 50: each gap in the hand-run steps goes to `field/` the same day.
- `no-promises` line 16: `next/` is Effect all the way; a Promise only at a one-line edge.
- `no-promises` line 33: lint refuses Promises outside tests except a line marked as an edge.
- `no-promises` line 53: a crypto failure is `Effect.tryPromise` with its own reason, `crypto`.
- `nobody-grades-their-own-work` line 16: the builder never judges; review is a different agent run.
- `nobody-grades-their-own-work` line 18: a judge only finds; code checks quotes and decides pass or fail.
- `nobody-writes-their-own-exam` line 22: an agent writing code never changes what that code is checked against.
- `nobody-writes-their-own-exam` line 24: the exam is laws, the checker, criteria, CI, lint and layer-rules.
- `nobody-writes-their-own-exam` line 44: one list in one file says which paths are the exam.
- `object-classes-stay-thin` line 35: an object class holds only platform handles and a one-line handoff.
- `one-ask-and-one-meter` line 35: every ask is one `asked`/`answered` shape, with the hash of `shows`.
- `one-ask-and-one-meter` line 102: silence is never a yes; a wait ends `withdrawn`, which is a no.
- `one-ask-and-one-meter` line 296: a dollar limit must point at a person's yes; `hold` answers `no_limit` without one.
- `one-ask-and-one-meter` line 224: a chat answer is kept, marked `via: chat` with its session.
- `one-ask-and-one-meter` line 341: every container job records its run seconds and who started it.
- `one-ask-and-one-meter` line 401: agents run on subscriptions; list-price dollars are for comparison only.
- `one-ask-and-one-meter` line 412: every agent run records billing, env, quotas, turn tags and `waited`.
- `one-ask-and-one-meter` line 456: a key in the environment never blocks a run; it is only recorded.
- `one-fabrika-toml-per-repo` line 55: repo file is `.fabrika/fabrika.toml`, one spelling, root file refused.
- `one-fabrika-toml-per-repo` line 67: `~/.fabrika` is the one home, replacing userData, `~/.tsh`, `ledger.json`.
- `one-fabrika-toml-per-repo` line 218: old saved run keeps its rules, never today's default.
- `one-fabrika-toml-per-repo` line 340: a setting pick that checks nothing is refused at load.
- `one-parent-stages-as-slots` line 3: the pipeline is one parent, steps are its children.
- `oxlint-and-oxfmt` line 36: oxlint lints, oxfmt formats, Biome is removed everywhere.
- `oxlint-and-oxfmt` line 6: stylelint lints CSS only, beside oxlint (2026-11-07).
- `oxlint-and-oxfmt` line 43: a check on code shape is a lint rule, not a test (only in AGENTS.md prose).
- `oxlint-and-oxfmt` line 47: an ignore comment names its rules and a reason.
- `oxlint-and-oxfmt` line 53: no nested config or ignore file takes a folder out.
- `oxlint-and-oxfmt` line 57: any warning fails `pnpm lint`, except two advice rules.
- `patch-upstream-locally` line 17: never wait upstream: `pnpm patch`, issue same day, delete on bump.
- `patch-upstream-locally` line 31: an upstream patch goes through the pipeline steps like code.
- `picker-guidelines` line 155: a narrowed picker box shows at most 500 rows.
- `picker-guidelines` line 256: `>` makes a fabsh line; `|` turns rows into a chip.
- `picker-guidelines` line 282: if the selected row leaves, select the next; Up/Down wrap.
- `picker-guidelines` line 340: pick sends exactly one row in v1.
- `pipeline-guidelines` line 140: P1, a person is asked only for a judgment.
- `pipeline-guidelines` line 162: P2, red after build goes back to builder, on by default.
- `pipeline-guidelines` line 181: P3, prevent, then fix, then stop (approved lean).
- `pipeline-guidelines` line 202: P4, a stuck lane resumes; only two cases cannot restart.
- `pipeline-guidelines` line 227: P5, after an answer, resume at the pick's step.
- `pipeline-guidelines` line 249: P6, every stop saves its resume point and evidence first.
- `pipeline-guidelines` line 276: P7, a step is idempotent, keyed by a hash of inputs.
- `pipeline-guidelines` line 338: P8, three retry kinds, each bounded, at one level.
- `pipeline-guidelines` line 384: P10, an ask names its picks, each with a resume.
- `pipeline-guidelines` line 407: P11, count cost and attention; at most two nudges.
- `pipeline-guidelines` line 440: P12, the lane's own laws are exam files too.
- `pipeline-guidelines` line 117: a person's stop is a saved pause; comments steer; red-back setting.
- `pipeline-guidelines` line 429: record wide (2026-11-01), held only in AGENTS.md prose.
- `popovers` line 362: asks popover keys: J/K, letter jump, H later, Enter folds Later.
- `popovers` line 20: Enter on an unshown ask turns the tracker, never opens a tile.
- `principles` line 29: fabrika's five principles, each with its "breaks it" test.
- `program-guidelines` line 140: G1 to G8, one job, location, open or focus, way back.
- `program-guidelines` line 479: calls 1 to 6: focus history, reuse, landing, open forms, leave, glance.
- `program-guidelines` line 631: C1 to C11, composing rules: one row type, filters, folds.
- `program-guidelines` line 816: the count's label and the audit's three splits.
- `programs-run-in-a-box` line 29: the box goes around a fabrika program, not a harness.
- `programs-run-in-a-box` line 34: no fence lives inside a harness; the box is the fence.
- `programs-run-in-a-box` line 41: the box is a `Sandbox` service: docker, os, or none.
- `programs-run-in-a-box` line 61: a key-needing Cmd is passed out; the app does it.
- `programs-run-in-a-box` line 73: tools are served inside the box, never over a port.
- `programs-run-in-a-box` line 81: the app decides which Cmds cross, and counts each box.
- `programs-run-in-a-box` line 88: no real key in a box except the model login.
- `programs-run-in-a-box` line 99: code that comes out of a box runs only in a box.
- `programs-run-in-a-box` line 105: triage runs in an empty box with no login.
- `project-window` line 44: today's first run is a welcome page with recent projects.
- `project-window` line 59: the project's name in the top bar is a switcher button.
- `project-window` line 72: Cmd-O opens one box for switching and opening folders.
- `property-tests-not-our-own-search` line 52: our search engine is fenced, its import list only shrinks.
- `rethink-do-not-port` line 11: today's fabrika maps which jobs exist, never how each is built.
- `rethink-do-not-port` line 36: write the reason beside every choice, copied ones included.
- `rethink-do-not-port` line 43: stays an experiment until better, faster and cheaper than today's.
- `rethink-do-not-port` line 54: older issues are sources of cases, never specs to match.
- `rethink-do-not-port` line 58: Tuval shows what a host needs, never a compatibility target.
- `recovery-key` line 315: new device's window key rides in the same `added`, admitted without grant.
- `recovery-key` line 155: a refused sheet writes nothing to the ledger, only a count.
- `scheduled-jobs-on-the-host` line 60: a job counts its false alarms first; until under 10%, only reports.
- `services-and-our-own-ci` line 49: every edge fabrika crosses is a typed service, even with one Layer.
- `services-and-our-own-ci` line 52: `Ci` is its own service, out of `CodeHost`, keyed by commit.
- `settings` line 662: keys are one short word or kebab-case; env name is FABRIKA_ plus constant case.
- `settings` line 668: a byte size is one string with its unit; a bare number is refused.
- `settings` line 656: oxlint's `node/no-process-env` runs in `next/` as advice until measured.
- `ship-stage-rules` line 8: a closed or draft pull request is never shipped; it ends a skip.
- `ship-stage-rules` line 10: a person's open comment asks that person; a bot's goes to the builder.
- `ship-stage-rules` line 16: red checks rerun once per head before the builder is called.
- `ship-stage-rules` line 22: pending checks and the queue wait each have a limit, then stuck.
- `summon-guidelines` line 19: `summon <agent> [model] [effort] as <name>` starts an agent; `@` only talks.
- `summon-guidelines` line 23: a summoned agent lives on the desk; `dismiss` ends it; top bar counts.
- `summon-guidelines` line 389: summon keeps the agent running between turns and writes it on the ledger.
- `summon-guidelines` line 457: every act that changes something is a readable, scriptable verb line.
- `summon-guidelines` line 494: a room is a place with members; a DM is a room of two.
- `summon-guidelines` line 516: every room is readable by everyone on the project; no private rooms.
- `summon-guidelines` line 535: fork takes words after `at`, never message numbers; origin is a fact.
- `summon-guidelines` line 580: joining never moves the tile; a line to a room starts with `#room`.
- `summon-guidelines` line 298: Ctrl-C cancels the turn not the agent; Ctrl-Z holds it at the next ask.
- `summon-guidelines` line 732: `fg %name` waits on a turn; `jobs` lists turns, bash job control.
- `summon-guidelines` line 740: every `@` line lands in the name's mailbox; busy agents queue it.
- `summon-guidelines` line 750: the first `@name` answers; every later `@name` is a target handle.
- `summon-guidelines` line 772: every `@name` is a mailbox address; people, agents, connectors share one name list.
- `talk-where-you-work` line 6: no chat program; tsh is the chat, and every talk has a spot or tile.
- `talk-where-you-work` line 8: a spot's reply stays at the spot, never copied into tsh.
- `talk-where-you-work` line 39: the started agent works in the person's repo and has no `answer` tool.
- `talk-where-you-work` line 42: the agent's network is an allow list from the repo file it cannot write.
- `talk-where-you-work` line 46: paths the agent cannot read are a list, `.env` and `.env.*` hidden by default.
- `talk-where-you-work` line 61: each harness's own permission words pass through, never a shared set of ours.
- `talk-where-you-work` line 84: spot talk is a box for 1 or 2 turns, then one reused thread tile.
- `talk-where-you-work` line 94: a spot is a program's location plus its version, maybe several rows.
- `talk-where-you-work` line 168: in `next/`, the brain keeps the alias and session; a turn runs on hands.
- `talk-where-you-work` line 199: a turn goes to the person's ordered hands list; `on <hands>` pins one.
- `sweep-the-core-rebuild-the-pipeline` line 43: no limit on file size; no line count shows a defect jump.
- `the-cloud-is-one-more-host` line 327: a program's process is one Durable Object.
- `the-cloud-is-one-more-host` line 331: all machine work is a Cmd the hands do.
- `the-cloud-is-one-more-host` line 338: the brain is workerd everywhere; Node runs only the hands (the glossary has the word, no decision has the rule).
- `the-cloud-is-one-more-host` line 348: single-purpose objects plus one project object holding claims, inboxes and the process tree.
- `the-cloud-is-one-more-host` line 415: hands take Cmds from a leased queue matched by `has` and `needs`.
- `the-cloud-is-one-more-host` line 438: limits are one primitive up the process tree, with soft and hard lines.
- `the-cloud-is-one-more-host` line 462: no separate alerting; a crossed line fires once, as an ask or a mail.
- `the-cloud-is-one-more-host` line 470: a window gets a whole copy at a rev, then JSON patches.
- `the-cloud-is-one-more-host` line 499: three homes for state: the log, the object's storage, the window's machine.
- `the-cloud-is-one-more-host` line 514: a program never holds the log; each layer uses only the one below.
- `the-cloud-is-one-more-host` line 557: no marketplace; a pack's name is its repo address.
- `the-cloud-is-one-more-host` line 563: pack code loads through Worker Loader, one sandbox per process.
- `the-cloud-is-one-more-host` line 570: a repo's own programs load from the default branch, with trust on first open.
- `the-cloud-is-one-more-host` line 580: the builder's blocked answer is a closed list, plus a looser pipe fit and a scout.
- `the-host-keeps-terminals-and-jobs` line 66: the layout is the app's; the host knows no layout (clashes with 0444).
- `the-plan-stage` line 197: plan step renames: `CodeContext`, `draftPlan`, `PlanInput`, `WithIds`, `Usage`, `session`.
- `the-test-writer` line 84: the test writer adds only new files `includes` names, never edits one.
- `themes` line 23: a theme is the person's own config in `~/.fabrika/`, never a repo's.
- `themes` line 25: one TOML file per theme; the pick is one `theme = "<name>"` line.
- `themes` line 33: a theme is a full set of named colors, never derived at run time.
- `themes` line 35: two ways in, a Radix pick or a shared theme file, ending in one shape.
- `themes` line 38: fabrika ships a `themes` program, a picker with live preview and import.
- `themes` line 44: a theme that import repairs is renamed `<name>-fabrika`.
- `themes` line 64: today's app takes the `fabrika` and `fabrika-light` Radix values, following the system's look.
- `themes` line 73: a line or fill token is never a text color.
- `themes` line 81: text uses only Radix's two text steps, slate 12 and a11.
- `themes` line 400: the `theme-fix` setting, `nudge` by default or `off`, with the nudge rules (lightness only, capped, never rewrites the file).
- `themes` line 470: in forced colors mode, the person's theme is dropped.
- `themes` line 522: a Radix pick is only a choice of gray and accent.
- `themes` line 543: the terminal and cursor fall under the same switch; the floor is a setting.
- `themes` line 606: contrast math uses two floors, both always.
- `themes` line 636: Radix is the primitive layer only.
- `themes` line 662: a repaired cursor gets its own `[repaired]` row.
- `use-the-industrys-names` line 14: a thing with an industry name keeps it, looked up first. Lines 18 to 19: an obscure industry name stays, with a plain gloss.
- `use-the-industrys-names` line 63: in `next/` the process list tool is `ps`, never `runs`.
- `we-follow-ddd` lines 20 to 37: follow DDD. Contexts and the context map live in the glossary. "Today's version says" is its last section. Inbox keeps both meanings.
- `what-a-ticket-shows` lines 179 to 194: a live run is one row updated in place. Tool calls go in the agent's log, never on the timeline.
- `what-a-ticket-shows` line 187: the live row shows dollars so far at list price. An unknown price reads "unknown", never $0.00.
- `what-a-ticket-shows` lines 195 and 250 to 258: beats sit on the run's own record, and the ticket's fold never reads them.
- `where-each-piece-lives` lines 79 to 92 and 114 to 128: today's pipeline imports only fabrika's public names, and each platform sits on a subpath. AGENTS.md and lint hold this, but no decision file does.
- `windows-in-next` lines 24 to 30: capabilities are `verify` and `seal`, never `touch-id` or `keychain`, and the hello records the OS. Decided 2026-11-02 and built.
